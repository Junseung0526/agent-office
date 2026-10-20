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

function buildProjectsList() {
  recalculateProjectFloors();
  const projectMap = new Map();
  const now = Date.now();

  for (const [_, state] of fileStates.entries()) {
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
        sessions: []
      });
    }
    const p = projectMap.get(key);
    p.lastActiveTime = Math.max(p.lastActiveTime, state.lastActiveTime);
    p.isActive = p.isActive || (now - state.lastActiveTime) < 15000;
    p.sessions.push({
      sessionId: state.sessionId,
      lastActiveTime: state.lastActiveTime,
      engine: state.engine,
      tokenUsage: state.tokenUsage
    });
  }

  for (const p of projectMap.values()) {
    p.tokenUsage = aggregateProjectTokens(p.sessions);
  }

  return Array.from(projectMap.values()).sort((a, b) => b.floor - a.floor);
}

function broadcastSessionsList() {
  const projectsList = buildProjectsList();
  broadcastEvent('projects_update', projectsList);
}

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

  // 2. 신규 파일 등록
  const newStates = [];
  for (const disc of discovered) {
    if (!fileStates.has(disc.filePath)) {
      stateChanged = true;
      let cwd = extractCwdFromSession(disc.filePath, disc.engine);
      if (!cwd && disc.projectFolder && disc.projectFolder.startsWith('-')) {
        cwd = '/' + disc.projectFolder.slice(1).replace(/-/g, '/');
      }

      const pInfo = getProjectKeyAndName(cwd, disc.sessionId);

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
        missingCount: 0
      };

      fileStates.set(disc.filePath, state);
      newStates.push(state);
    }
  }

  if (stateChanged) {
    recalculateProjectFloors();
    broadcastSessionsList();
  }

  if (newStates.length > 0) {
    queueSessionTokenInit(newStates);
  }
}

// 8. 0.25초 (250ms) 주기 폴링 루프
let pollCount = 0;
function pollCycle() {
  pollCount++;

  if (pollCount % 4 === 0) {
    scanSessions();
  }

  const now = Date.now();
  let hasActiveEvents = false;

  for (const [_, state] of fileStates.entries()) {
    const newLines = readNewLines(state);
    if (newLines.length > 0) {
      state.lastActiveTime = now;
      hasActiveEvents = true;
      let tokensChanged = false;

      for (const line of newLines) {
        if (accumulateTokenUsage(state, line)) {
          tokensChanged = true;
        }

        let events = [];
        if (state.engine === 'antigravity') {
          events = parseAntigravityLine(line, state);
        } else if (state.engine === 'claude') {
          events = parseClaudeLine(line, state);
        }

        for (const ev of events) {
          ev.floor = state.floorNumber;
          ev.projectKey = state.projectKey;
          ev.tokenUsage = state.tokenUsage;
          broadcastEvent('agent_event', ev);
        }
      }

      if (tokensChanged) {
        broadcastEvent('token_usage_update', {
          sessionId: state.sessionId,
          projectKey: state.projectKey,
          tokenUsage: state.tokenUsage
        });
      }
    }
  }

  if (hasActiveEvents && pollCount % 4 === 0) {
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
