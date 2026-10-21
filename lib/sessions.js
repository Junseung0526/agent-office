/**
 * 에이전트 오피스 (Agent Office) - 세션 및 프로젝트 관리 모듈 (lib/sessions.js)
 * 세션 탐색, CWD 추출, 층(Floor) 번호 계산, 토큰 초기화 큐, 폴링 루프 관리
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { readNewLines, accumulateTokenUsage, streamProcessSessionTokens, saveTokenCache } = require('./tail');
const { parseAntigravityLine } = require('./parsers/antigravity');
const { parseClaudeLine } = require('./parsers/claude');
const { broadcastEvent, getSseClientCount } = require('./sse');
const { createLogger } = require('./logger');

const log = createLogger('sessions');

// 전역 가변 상태: fileStates 맵을 lib/sessions.js가 단독 소유
const fileStates = new Map();

/**
 * 프로젝트 CWD 정밀 추출 함수
 */
function extractCwdFromSession(filePath, engine) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size === 0) return '';

    // 앞부분 16KB 읽기
    const fd = fs.openSync(filePath, 'r');
    const readSize = Math.min(stat.size, 16384);
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, 0);

    // 뒷부분 16KB 읽기 (필요 시)
    let tailBuf = null;
    if (stat.size > 16384) {
      const tailPos = Math.max(0, stat.size - 16384);
      tailBuf = Buffer.alloc(stat.size - tailPos);
      fs.readSync(fd, tailBuf, 0, tailBuf.length, tailPos);
    }
    fs.closeSync(fd);

    const fullSample = buf.toString('utf-8') + (tailBuf ? '\n' + tailBuf.toString('utf-8') : '');
    const lines = fullSample.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);

        // Claude CWD
        if (obj.cwd && typeof obj.cwd === 'string' && obj.cwd.startsWith('/')) {
          return obj.cwd;
        }

        // Antigravity Step 0 - 프롬프트 내 CWD
        if (obj.content && typeof obj.content === 'string') {
          const m1 = obj.content.match(/Active Workspaces:\s*\n-\s*([^\n\r]+)/);
          if (m1 && m1[1].trim().startsWith('/')) return m1[1].trim().replace(/^["']|["']$/g, '');

          const m2 = obj.content.match(/Command Working Directory:\s*([^\n\r]+)/);
          if (m2 && m2[1].trim().startsWith('/')) return m2[1].trim().replace(/^["']|["']$/g, '');
        }

        // tool_calls args
        if (obj.tool_calls && Array.isArray(obj.tool_calls)) {
          for (const tc of obj.tool_calls) {
            if (tc.args) {
              if (tc.args.Cwd && typeof tc.args.Cwd === 'string') {
                const c = tc.args.Cwd.replace(/^["']|["']$/g, '');
                if (c.startsWith('/')) return c;
              }
              if (tc.args.TargetFile && typeof tc.args.TargetFile === 'string') {
                const tf = tc.args.TargetFile.replace(/^["']|["']$/g, '');
                if (tf.startsWith('/')) return path.dirname(tf);
              }
              if (tc.args.AbsolutePath && typeof tc.args.AbsolutePath === 'string') {
                const ap = tc.args.AbsolutePath.replace(/^["']|["']$/g, '');
                if (ap.startsWith('/')) return path.dirname(ap);
              }
            }
          }
        }
      } catch (e) {}
    }
  } catch (err) {}
  return '';
}

function getProjectKeyAndName(cwd, fallbackId) {
  if (cwd && cwd.startsWith('/')) {
    const base = path.basename(cwd);
    return {
      key: cwd,
      cwd: cwd,
      name: base || 'Project-Root'
    };
  }
  // fallback
  const shortId = (fallbackId || 'default').slice(0, 8);
  return {
    key: `session_${shortId}`,
    cwd: `/Workspace/${shortId}`,
    name: `Workspace-${shortId}`
  };
}

// 층 번호 동적 재계산 함수
// 가장 최근 활동이 있는 프로젝트가 최고층(맨 위), 가장 오래된 것이 1F
function recalculateProjectFloors() {
  const projectMap = new Map();

  for (const [_, state] of fileStates.entries()) {
    const pKey = state.projectKey || state.cwd || 'default';
    if (!projectMap.has(pKey)) {
      projectMap.set(pKey, {
        projectKey: pKey,
        projectName: state.projectName,
        cwd: state.cwd,
        lastActiveTime: state.lastActiveTime || 0,
        sessions: []
      });
    }
    const p = projectMap.get(pKey);
    p.lastActiveTime = Math.max(p.lastActiveTime, state.lastActiveTime || 0);
    p.sessions.push(state);
  }

  // lastActiveTime 오름차순 정렬: 오래된 것(1F) -> 최근 것(최고층 NF)
  const sortedProjects = Array.from(projectMap.values()).sort((a, b) => a.lastActiveTime - b.lastActiveTime);

  // 층 번호 할당 (1F부터 최고층 N F까지)
  for (let i = 0; i < sortedProjects.length; i++) {
    const floorNum = i + 1;
    sortedProjects[i].floorNumber = floorNum;
    for (const sessionState of sortedProjects[i].sessions) {
      sessionState.floorNumber = floorNum;
    }
  }
}

// Claude Code 서브에이전트 트랜스크립트: <projectDir>/<sessionId>/subagents/agent-<agentId>.jsonl
// 같은 위치의 agent-<agentId>.meta.json에 agentType / description / toolUseId가 기록된다.
function discoverClaudeSubagents(projectDirPath, parentSessionId, projectFolder) {
  const subDir = path.join(projectDirPath, parentSessionId, 'subagents');
  const found = [];
  let files;
  try {
    files = fs.readdirSync(subDir);
  } catch (e) {
    return found;
  }
  for (const file of files) {
    const m = file.match(/^agent-(.+)\.jsonl$/);
    if (!m) continue;
    try {
      const filePath = path.join(subDir, file);
      const stat = fs.statSync(filePath);
      found.push({
        filePath,
        engine: 'claude',
        sessionId: `${parentSessionId}:${m[1]}`,
        parentSessionId,
        agentId: m[1],
        metaPath: path.join(subDir, `agent-${m[1]}.meta.json`),
        projectFolder,
        mtime: stat.mtimeMs,
        size: stat.size
      });
    } catch (e) {}
  }
  return found;
}

function readSubagentMeta(metaPath) {
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    return {
      agentType: typeof meta.agentType === 'string' ? meta.agentType : null,
      description: typeof meta.description === 'string' ? meta.description : null,
      toolUseId: typeof meta.toolUseId === 'string' ? meta.toolUseId : null
    };
  } catch (e) {
    return { agentType: null, description: null, toolUseId: null };
  }
}

function discoverAllSessionFiles() {
  const discovered = [];

  // A. Antigravity 세션 스캔
  if (fs.existsSync(config.ANTIGRAVITY_BRAIN_DIR)) {
    try {
      const convs = fs.readdirSync(config.ANTIGRAVITY_BRAIN_DIR);
      for (const convId of convs) {
        const transcriptPath = path.join(config.ANTIGRAVITY_BRAIN_DIR, convId, '.system_generated', 'logs', 'transcript.jsonl');
        if (fs.existsSync(transcriptPath)) {
          const stat = fs.statSync(transcriptPath);
          discovered.push({
            filePath: transcriptPath,
            engine: 'antigravity',
            sessionId: convId,
            mtime: stat.mtimeMs,
            size: stat.size
          });
        }
      }
    } catch (e) {}
  }

  // B. Claude Code 세션 스캔
  if (fs.existsSync(config.CLAUDE_PROJECTS_DIR)) {
    try {
      const projectDirs = fs.readdirSync(config.CLAUDE_PROJECTS_DIR);
      for (const pDir of projectDirs) {
        const fullPDir = path.join(config.CLAUDE_PROJECTS_DIR, pDir);
        if (!fs.statSync(fullPDir).isDirectory()) continue;
        const files = fs.readdirSync(fullPDir);
        for (const file of files) {
          if (file.endsWith('.jsonl')) {
            const filePath = path.join(fullPDir, file);
            const stat = fs.statSync(filePath);
            discovered.push({
              filePath: filePath,
              engine: 'claude',
              sessionId: path.basename(file, '.jsonl'),
              projectFolder: pDir,
              mtime: stat.mtimeMs,
              size: stat.size
            });
            discovered.push(...discoverClaudeSubagents(fullPDir, path.basename(file, '.jsonl'), pDir));
          }
        }
      }
    } catch (e) {}
  }
  return discovered;
}

// 동시 2개 제한 비동기 초기화 큐
const tokenInitQueue = [];
let isTokenInitRunning = false;
let totalToInit = 0;
let completedInit = 0;

function queueSessionTokenInit(stateList) {
  // 최근 수정된 세션부터 처리
  stateList.sort((a, b) => b.lastActiveTime - a.lastActiveTime);
  for (const s of stateList) {
    if (!tokenInitQueue.some(x => x.filePath === s.filePath)) {
      tokenInitQueue.push(s);
      totalToInit++;
    }
  }
  if (!isTokenInitRunning) {
    runTokenInitQueue();
  }
}

async function runTokenInitQueue() {
  if (isTokenInitRunning) return;
  isTokenInitRunning = true;
  const CONCURRENCY = 2;

  async function worker() {
    while (tokenInitQueue.length > 0) {
      const state = tokenInitQueue.shift();
      if (!state) break;
      await streamProcessSessionTokens(state);
      // 서버 기동 이후 새로 생긴 작은 세션은 처음부터 이벤트를 재생 (토큰은 seenTokenIds로 중복 방지)
      if (state.replayFromStart) {
        state.lastOffset = 0;
        state.partialBuffer = '';
      }
      state.tokenInitDone = true;
      completedInit++;

      broadcastEvent('token_init_progress', {
        current: completedInit,
        total: Math.max(totalToInit, completedInit),
        text: `토큰 집계 중 ${completedInit}/${Math.max(totalToInit, completedInit)}`
      });

      if (completedInit % 2 === 0 || tokenInitQueue.length === 0) {
        saveTokenCache();
        recalculateProjectFloors();
        broadcastSessionsList();
      }
    }
  }

  const workers = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  saveTokenCache();
  recalculateProjectFloors();
  broadcastSessionsList();
  log.info('Token usage indexed', { sessions: completedInit });
  isTokenInitRunning = false;
  if (tokenInitQueue.length === 0) {
    totalToInit = 0;
    completedInit = 0;
  }
}

function aggregateProjectTokens(sessions) {
  let hasData = false;
  let input = 0, output = 0, cache = 0, total = 0;
  let model = null;
  for (const s of sessions) {
    if (s.tokenUsage && s.tokenUsage.hasData) {
      hasData = true;
      input += s.tokenUsage.inputTokens;
      output += s.tokenUsage.outputTokens;
      cache += s.tokenUsage.cacheTokens;
      total += s.tokenUsage.totalTokens;
      if (s.tokenUsage.model && !model) model = s.tokenUsage.model;
    }
  }
  return { hasData, inputTokens: input, outputTokens: output, cacheTokens: cache, totalTokens: total, model };
}

// 층(프로젝트) 단위 토큰 합계: 메인 세션 + 서브에이전트 세션 전체
function getProjectTokenUsage(projectKey) {
  const states = [];
  for (const state of fileStates.values()) {
    if (state.projectKey === projectKey) states.push(state);
  }
  return aggregateProjectTokens(states);
}

function buildProjectsList() {
  recalculateProjectFloors();
  const projectMap = new Map();
  const now = Date.now();

  const subagentStates = [];
  for (const [_, state] of fileStates.entries()) {
    if (state.isSubagent) {
      subagentStates.push(state);
      continue;
    }
    const key = state.projectKey;
    if (!projectMap.has(key)) {
      projectMap.set(key, {
        projectKey: key,
        projectName: state.projectName,
        cwd: state.cwd,
        floor: state.floorNumber,
        engine: state.engine,
        lastActiveTime: state.lastActiveTime,
        isActive: (now - state.lastActiveTime) < 15000,
        isAwaitingUser: Boolean(state.isAwaitingUser),
        sessions: []
      });
    }
    const p = projectMap.get(key);
    // 층의 엔진은 가장 최근에 활동한 세션을 따른다 (같은 폴더에서 Antigravity → Claude 전환 시 반영)
    if (state.lastActiveTime > p.lastActiveTime) p.engine = state.engine;
    p.lastActiveTime = Math.max(p.lastActiveTime, state.lastActiveTime);
    p.isActive = p.isActive || (now - state.lastActiveTime) < 15000;
    p.isAwaitingUser = p.isAwaitingUser || Boolean(state.isAwaitingUser);
    p.sessions.push({
      sessionId: state.sessionId,
      lastActiveTime: state.lastActiveTime,
      engine: state.engine,
      tokenUsage: state.tokenUsage
    });
  }

  for (const p of projectMap.values()) {
    p.activeSubagents = 0;
    p.subagentTokenSources = [];
  }
  for (const sub of subagentStates) {
    const p = projectMap.get(sub.projectKey);
    if (!p) continue;
    p.subagentTokenSources.push(sub);
    if (!sub.subagentFinished && (now - sub.lastActiveTime) < 120000) p.activeSubagents++;
  }

  for (const p of projectMap.values()) {
    p.tokenUsage = aggregateProjectTokens(p.sessions.concat(p.subagentTokenSources));
    delete p.subagentTokenSources;
  }

  return Array.from(projectMap.values()).sort((a, b) => b.floor - a.floor);
}

function broadcastSessionsList() {
  const projectsList = buildProjectsList();
  broadcastEvent('projects_update', projectsList);
}

function findSessionState(sessionId) {
  for (const state of fileStates.values()) {
    if (state.sessionId === sessionId) return state;
  }
  return null;
}

let initialScanDone = false;

// 7. 세션 탐색 및 파일 등록 (3회 미탐색 세션 제거)
function scanSessions() {
  const discovered = discoverAllSessionFiles();
  const foundPaths = new Set(discovered.map(d => d.filePath));
  let stateChanged = false;

  // 1. 파일 삭제 확인 (3회 연속 스캔에서 없으면 제거)
  for (const [filePath, state] of fileStates.entries()) {
    if (!foundPaths.has(filePath) || !fs.existsSync(filePath)) {
      state.missingCount = (state.missingCount || 0) + 1;
      if (state.missingCount >= 3) {
        fileStates.delete(filePath);
        stateChanged = true;
      }
    } else {
      state.missingCount = 0;
    }
  }

  // 2. 신규 파일 등록 (서브에이전트는 부모 세션보다 뒤에 등록되도록 정렬)
  discovered.sort((a, b) => (a.parentSessionId ? 1 : 0) - (b.parentSessionId ? 1 : 0));
  const newStates = [];
  const spawnEvents = [];
  for (const disc of discovered) {
    if (!fileStates.has(disc.filePath)) {
      stateChanged = true;
      const parentState = disc.parentSessionId ? findSessionState(disc.parentSessionId) : null;

      let pInfo;
      if (parentState) {
        // 서브에이전트는 부모 세션과 같은 층(프로젝트)에 배치
        pInfo = { key: parentState.projectKey, name: parentState.projectName, cwd: parentState.cwd };
      } else {
        let cwd = extractCwdFromSession(disc.filePath, disc.engine);
        if (!cwd && disc.projectFolder && disc.projectFolder.startsWith('-')) {
          cwd = '/' + disc.projectFolder.slice(1).replace(/-/g, '/');
        }
        pInfo = getProjectKeyAndName(cwd, disc.parentSessionId || disc.sessionId);
      }

      const state = {
        filePath: disc.filePath,
        engine: disc.engine,
        sessionId: disc.sessionId,
        projectKey: pInfo.key,
        projectName: pInfo.name,
        cwd: pInfo.cwd,
        floorNumber: 1,
        lastOffset: 0,
        partialBuffer: '',
        lastActiveTime: disc.mtime,
        subagents: new Set(),
        currentRoom: 'meeting',
        seenTokenIds: new Set(),
        tokenUsage: {
          hasData: false,
          inputTokens: 0,
          outputTokens: 0,
          cacheTokens: 0,
          totalTokens: 0,
          model: null
        },
        ino: null,
        missingCount: 0,
        tokenInitDone: false,
        replayFromStart: initialScanDone && disc.size <= config.MAX_REPLAY_FROM_START_BYTES
      };

      if (disc.parentSessionId) {
        const meta = readSubagentMeta(disc.metaPath);
        state.isSubagent = true;
        state.parentSessionId = disc.parentSessionId;
        state.agentId = disc.agentId;
        state.agentType = meta.agentType;
        state.description = meta.description;
        state.parentToolUseId = meta.toolUseId;
        // 기동 시점에 이미 존재하던 서브에이전트는 과거 작업으로 간주 (출근 연출 없음)
        state.subagentFinished = !initialScanDone;
        if (initialScanDone) spawnEvents.push(state);
      }

      fileStates.set(disc.filePath, state);
      newStates.push(state);
    }
  }
  const wasInitialScan = !initialScanDone;
  initialScanDone = true;

  if (stateChanged) {
    recalculateProjectFloors();
    broadcastSessionsList();
  }

  for (const sub of spawnEvents) {
    broadcastEvent('agent_event', {
      id: `claude_${sub.sessionId}_spawn`,
      sessionId: sub.parentSessionId,
      projectName: sub.projectName,
      projectKey: sub.projectKey,
      cwd: sub.cwd,
      floor: sub.floorNumber,
      agentType: 'claude',
      agentId: `sub_${sub.agentId}`,
      timestamp: Date.now(),
      action: 'subagent_spawn',
      room: 'elevator',
      subagentName: sub.description || 'Subagent',
      subagentRole: sub.agentType || '서브에이전트',
      parentToolUseId: sub.parentToolUseId,
      tokenUsage: getProjectTokenUsage(sub.projectKey)
    });
  }

  if (newStates.length > 0) {
    const subs = newStates.filter(st => st.isSubagent).length;
    log.info(wasInitialScan ? 'Initial session scan complete' : 'New sessions detected', {
      claude: newStates.filter(st => st.engine === 'claude' && !st.isSubagent).length,
      antigravity: newStates.filter(st => st.engine === 'antigravity').length,
      subagents: subs || undefined
    });
    queueSessionTokenInit(newStates);
  }
}

// 8. 0.25초 (250ms) 주기 폴링 루프
let pollCount = 0;
let projectsBroadcastPending = false;
function pollCycle() {
  pollCount++;

  if (pollCount % 4 === 0) {
    scanSessions();
  }

  const now = Date.now();
  let hasActiveEvents = false;

  for (const [_, state] of fileStates.entries()) {
    // 토큰 초기 집계가 끝나기 전에는 읽지 않음 (과거 이력 전체가 실시간 이벤트로 쏟아지는 경쟁 조건 방지)
    if (!state.tokenInitDone) continue;
    const newLines = readNewLines(state);
    if (newLines.length > 0) {
      state.lastActiveTime = now;
      hasActiveEvents = true;
      let tokensChanged = false;
      let projectTokens = null;

      for (const line of newLines) {
        if (accumulateTokenUsage(state, line)) {
          tokensChanged = true;
          projectTokens = null;
        }
        if (!projectTokens) projectTokens = getProjectTokenUsage(state.projectKey);

        let events = [];
        if (state.engine === 'antigravity') {
          events = parseAntigravityLine(line, state);
        } else if (state.engine === 'claude') {
          events = parseClaudeLine(line, state);
        }

        for (const ev of events) {
          ev.floor = state.floorNumber;
          ev.projectKey = state.projectKey;
          ev.tokenUsage = projectTokens;
          if (state.isSubagent) {
            if (ev.action === 'subagent_finish') state.subagentFinished = true;
            else state.subagentFinished = false;
          } else if (ev.action === 'ask_user' || ev.action === 'turn_finish') {
            state.isAwaitingUser = true;
          } else if (ev.action === 'user_input' || ev.action === 'tool_start') {
            state.isAwaitingUser = false;
          }
          broadcastEvent('agent_event', ev);
        }
      }

      if (tokensChanged) {
        broadcastEvent('token_usage_update', {
          sessionId: state.sessionId,
          projectKey: state.projectKey,
          tokenUsage: getProjectTokenUsage(state.projectKey)
        });
      }
    }
  }

  // 활동이 있었던 주기는 다음 4번째 주기에 반드시 층 목록을 갱신 (마지막 이벤트 묶음 누락 방지)
  if (hasActiveEvents) projectsBroadcastPending = true;
  if (projectsBroadcastPending && pollCount % 4 === 0) {
    projectsBroadcastPending = false;
    recalculateProjectFloors();
    broadcastSessionsList();
  }
}

let pollTimer = null;

function scheduleNextPoll(immediate = false) {
  if (pollTimer) clearTimeout(pollTimer);
  const interval = getSseClientCount() > 0 ? config.POLL_INTERVAL_ACTIVE_MS : config.POLL_INTERVAL_IDLE_MS;
  if (immediate) {
    pollCycle();
    pollTimer = setTimeout(scheduleNextPoll, interval);
  } else {
    pollTimer = setTimeout(() => {
      pollCycle();
      scheduleNextPoll();
    }, interval);
  }
}

function stopPoll() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

module.exports = {
  extractCwdFromSession,
  getProjectKeyAndName,
  recalculateProjectFloors,
  discoverAllSessionFiles,
  aggregateProjectTokens,
  buildProjectsList,
  broadcastSessionsList,
  scanSessions,
  pollCycle,
  scheduleNextPoll,
  stopPoll
};
