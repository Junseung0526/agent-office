/**
 * 에이전트 오피스 (Agent Office) - 로컬 백엔드 서버
 * 순수 Node.js 표준 라이브러리 (http, fs, path, os)만 사용 (의존성 0개)
 * 127.0.0.1에만 바인딩
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ==========================================
// 1. 도구 이름 -> 방 매핑 설정 (단일 객체)
// ==========================================
const TOOL_ROOM_MAP = {
  // 자료실 (파일 읽기, 검색)
  'Read': 'archive',
  'view_file': 'archive',
  'read_resource': 'archive',
  'list_resources': 'archive',
  'Grep': 'archive',
  'Glob': 'archive',
  'LS': 'archive',
  'FileSearch': 'archive',
  'codebase_search': 'archive',

  // 개발실 (코드 수정, 파일 생성)
  'Edit': 'dev',
  'Write': 'dev',
  'MultiEdit': 'dev',
  'write_to_file': 'dev',
  'replace_file_content': 'dev',
  'apply_diff': 'dev',

  // 서버실 (명령 실행, Git)
  'Bash': 'server',
  'run_command': 'server',
  'terminal': 'server',
  'execute_command': 'server',
  'git': 'server',

  // 회의실 (계획 수립, 태스크 관리)
  'TodoWrite': 'meeting',
  'TodoRead': 'meeting',
  'plan': 'meeting',
  'manage_task': 'meeting',
  'schedule': 'meeting',
  'task': 'meeting',

  // 내 자리 (사용자 질문, 권한 확인)
  'AskUserQuestion': 'user_desk',
  'ask_question': 'user_desk',
  'permission': 'user_desk',

  // 서브에이전트 위임
  'invoke_subagent': 'elevator',
  'Agent': 'elevator',
  'Task': 'elevator',
  'send_message': 'elevator',
  'manage_subagents': 'elevator'
};

const DEFAULT_ROOM = 'research'; // 매핑에 없는 도구의 기본 방: "정보검색실"

function getRoomForTool(toolName) {
  if (!toolName) return DEFAULT_ROOM;
  return TOOL_ROOM_MAP[toolName] || DEFAULT_ROOM;
}

// ==========================================
// 2. 서버 설정
// ==========================================
const PORT = process.env.PORT || 3456;
const HOST = '127.0.0.1'; // 절대 제약: 외부 접근 차단
const POLL_INTERVAL_MS = 250; // 0.25초 (250ms) 주기

const HOME_DIR = os.homedir();
let CLAUDE_PROJECTS_DIR = path.join(HOME_DIR, '.claude', 'projects');
let ANTIGRAVITY_BRAIN_DIR = path.join(HOME_DIR, '.gemini', 'antigravity-cli', 'brain');

// 테스트 및 커스텀 로그 루트 지원 (기본값은 기존 경로 유지)
if (process.env.AGENT_OFFICE_LOG_ROOTS) {
  try {
    const custom = JSON.parse(process.env.AGENT_OFFICE_LOG_ROOTS);
    if (custom.claude) CLAUDE_PROJECTS_DIR = custom.claude;
    if (custom.antigravity) ANTIGRAVITY_BRAIN_DIR = custom.antigravity;
  } catch (e) {
    const parts = process.env.AGENT_OFFICE_LOG_ROOTS.split(',');
    for (const p of parts) {
      const [k, v] = p.split('=');
      if (k && k.trim() === 'claude' && v) CLAUDE_PROJECTS_DIR = v.trim();
      if (k && k.trim() === 'antigravity' && v) ANTIGRAVITY_BRAIN_DIR = v.trim();
    }
  }
}

// ==========================================
// 3. 인메모리 세션 및 프로젝트 층 관리
// ==========================================
const fileStates = new Map();
const sseClients = new Set();

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

// ==========================================
// 3-1. 서버 측 민감정보(비밀값/토큰/패스워드) 마스킹
// ==========================================
const SENSITIVE_KEY_REGEX = /token|secret|passw(or)?d|api[_-]?key|auth|credential|private[_-]?key/i;
const SENSITIVE_CLI_FLAG_REGEX = /^--(?:token|secret|password|passwd|api[_-]?key|auth|credential)$/i;

function isMetricOrNonSensitiveKey(k) {
  // 토큰 집계용 메트릭 필드 및 author 등 일반 단어 오탐 방지
  if (k === 'author') return true;
  if (/token(?:s|_?tokens?|_?usage|_?count|_?total|_?input|_?output|_?cache|_?seen|_?price|_?limit)/i.test(k)) return true;
  if (/(?:input|output|cache|total)tokens/i.test(k)) return true;
  return false;
}

function maskSecrets(val, depth = 0) {
  if (val === null || val === undefined) return val;
  if (depth > 12) return '***';

  if (typeof val === 'string') {
    let s = val;
    // 1) PEM Private Key 블록
    s = s.replace(/-----BEGIN [A-Z0-9_ -]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9_ -]*PRIVATE KEY-----/g, '***');
    // 2) Authorization / Bearer 토큰
    s = s.replace(/(Authorization:\s*(?:Bearer\s+)?)[^\r\n\s]+/gi, '$1***');
    s = s.replace(/(Bearer\s+)[A-Za-z0-9_\-\.]{8,}/gi, '$1***');
    // 3) CLI 플래그: --token x, --password x 등
    s = s.replace(/((?:--)(?:token|secret|password|passwd|api[_-]?key|auth|credential)\s+)([^\s&|;'"]+)/gi, '$1***');
    // 4) KEY=, TOKEN=, SECRET=, PASSWORD=, PASSWD=, AUTH=, CREDENTIAL=, PRIVATE= 등
    s = s.replace(/(\b[A-Z0-9_-]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE)[A-Z0-9_-]*\s*[:=]\s*|\bAUTH(?:_[A-Z0-9_-]+)?\s*[:=]\s*)([^\s&|;'"]+)/gi, '$1***');
    // 5) JWT (eyJ...)
    s = s.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '***');
    // 6) 대표적인 API 키/토큰 접두사 (ghp_, gho_, sk-, xoxb-, xoxp-, AKIA[0-9A-Z]{16})
    s = s.replace(/\b(gh[pousr]_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]+|AKIA[0-9A-Z]{16})\b/g, '***');
    // 7) URL 내 사용자명:비밀번호@ (scheme://user:pass@host)
    s = s.replace(/(\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\/\s:@]+:)[^\/\s:@]+(@)/gi, '$1***$2');
    return s;
  }

  if (Array.isArray(val)) {
    const res = [];
    for (let i = 0; i < val.length; i++) {
      if (typeof val[i] === 'string' && SENSITIVE_CLI_FLAG_REGEX.test(val[i]) && i + 1 < val.length) {
        res.push(val[i]);
        res.push('***');
        i++;
      } else {
        res.push(maskSecrets(val[i], depth + 1));
      }
    }
    return res;
  }

  if (typeof val === 'object') {
    const res = {};
    for (const k of Object.keys(val)) {
      if (SENSITIVE_KEY_REGEX.test(k) && !isMetricOrNonSensitiveKey(k)) {
        res[k] = '***';
      } else {
        res[k] = maskSecrets(val[k], depth + 1);
      }
    }
    return res;
  }

  return val;
}

// SSE 브로드캐스트 및 링 버퍼/상태 복원 저장소
let eventSeq = 0;
const EVENT_RING_BUFFER_SIZE = 500;
const eventRingBuffer = [];
const sessionRecentEvents = new Map(); // sessionId -> array of recent events (max 30)

function broadcastEvent(eventName, data) {
  const sanitized = maskSecrets(data);

  if (eventName === 'agent_event') {
    eventSeq++;
    sanitized.seq = eventSeq;
    sanitized.id = sanitized.id || `ev_${eventSeq}`;

    eventRingBuffer.push(sanitized);
    if (eventRingBuffer.length > EVENT_RING_BUFFER_SIZE) {
      eventRingBuffer.shift();
    }

    if (sanitized.sessionId) {
      if (!sessionRecentEvents.has(sanitized.sessionId)) {
        sessionRecentEvents.set(sanitized.sessionId, []);
      }
      const sEvents = sessionRecentEvents.get(sanitized.sessionId);
      sEvents.push(sanitized);
      if (sEvents.length > 30) sEvents.shift();
    }
  }

  if (sseClients.size === 0) return;
  const idLine = sanitized.seq ? `id: ${sanitized.seq}\n` : '';
  const payload = `${idLine}event: ${eventName}\ndata: ${JSON.stringify(sanitized)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (err) {
      sseClients.delete(client);
    }
  }
}

// ==========================================
// 4. 로그 증분 파서 (새로 추가된 바이트만 읽기)
// ==========================================
function readNewLines(state) {
  try {
    if (!fs.existsSync(state.filePath)) return [];
    const stat = fs.statSync(state.filePath);

    // inode 변경 또는 파일 크기 축소 (로그 로테이션 / truncate) 감지
    if ((state.ino && stat.ino !== state.ino) || stat.size < state.lastOffset) {
      state.lastOffset = 0;
      state.partialBuffer = '';
      state.ino = stat.ino;
      state.seenTokenIds.clear();
      state.tokenUsage = {
        hasData: false,
        inputTokens: 0,
        outputTokens: 0,
        cacheTokens: 0,
        totalTokens: 0,
        model: null
      };
    }
    if (!state.ino) {
      state.ino = stat.ino;
    }

    if (stat.size <= state.lastOffset) return [];

    const bytesToRead = stat.size - state.lastOffset;
    const buffer = Buffer.alloc(bytesToRead);
    const fd = fs.openSync(state.filePath, 'r');
    let bytesRead = 0;
    try {
      bytesRead = fs.readSync(fd, buffer, 0, bytesToRead, state.lastOffset);
      state.lastOffset += bytesRead;
    } finally {
      fs.closeSync(fd);
    }

    const chunk = state.partialBuffer + buffer.toString('utf-8');
    const lines = chunk.split('\n');
    state.partialBuffer = lines.pop() || '';
    return lines.filter(l => l.trim().length > 0);
  } catch (err) {
    return [];
  }
}

// ==========================================
// 5. Antigravity 로그 이벤트 변환기
// ==========================================
function parseAntigravityLine(line, state) {
  try {
    const obj = JSON.parse(line);
    const events = [];
    const now = Date.parse(obj.created_at) || Date.now();

    // 1) USER_INPUT
    if (obj.type === 'USER_INPUT') {
      events.push({
        id: `ag_${state.sessionId}_${obj.step_index}_user`,
        sessionId: state.sessionId,
        projectName: state.projectName,
        cwd: state.cwd,
        floor: state.floorNumber,
        agentType: 'antigravity',
        agentId: 'main',
        timestamp: now,
        action: 'user_input',
        room: 'user_desk',
        userPrompt: typeof obj.content === 'string' ? obj.content.slice(0, 150) : '사용자 입력'
      });
      return events;
    }

    // 2) PLANNER_RESPONSE
    if (obj.type === 'PLANNER_RESPONSE') {
      if (obj.thinking && typeof obj.thinking === 'string' && obj.thinking.trim()) {
        events.push({
          id: `ag_${state.sessionId}_${obj.step_index}_think`,
          sessionId: state.sessionId,
          projectName: state.projectName,
          cwd: state.cwd,
          floor: state.floorNumber,
          agentType: 'antigravity',
          agentId: 'main',
          timestamp: now,
          action: 'thinking',
          room: 'meeting',
          thinkingText: obj.thinking.trim()
        });
      }

      if (obj.tool_calls && Array.isArray(obj.tool_calls) && obj.tool_calls.length > 0) {
        for (let i = 0; i < obj.tool_calls.length; i++) {
          const tc = obj.tool_calls[i];
          const toolName = tc.name || (tc.function && tc.function.name) || 'unknown';
          const room = getRoomForTool(toolName);
          const toolSummary = (tc.args && (tc.args.toolSummary || tc.args.toolAction)) || toolName;

          if (toolName === 'invoke_subagent') {
            const subagents = (tc.args && tc.args.Subagents) || [{ Role: '서브에이전트' }];
            for (let sIdx = 0; sIdx < subagents.length; sIdx++) {
              const sub = subagents[sIdx];
              const subId = `sub_${sIdx + 1}`;
              state.subagents.add(subId);
              if (state.subagents.size > 100) {
                const oldest = state.subagents.values().next().value;
                state.subagents.delete(oldest);
              }
              events.push({
                id: `ag_${state.sessionId}_${obj.step_index}_sub_${sIdx}`,
                sessionId: state.sessionId,
                projectName: state.projectName,
                cwd: state.cwd,
                floor: state.floorNumber,
                agentType: 'antigravity',
                agentId: subId,
                timestamp: now,
                action: 'subagent_spawn',
                room: 'elevator',
                subagentName: sub.TypeName || sub.Role || 'Subagent',
                subagentRole: sub.Role || '작업 지원'
              });
            }
          } else if (toolName === 'ask_question') {
            let questionText = '사용자 의견을 확인하고 있습니다.';
            if (tc.args && tc.args.questions && tc.args.questions[0]) {
              questionText = tc.args.questions[0].question || questionText;
            }
            events.push({
              id: `ag_${state.sessionId}_${obj.step_index}_ask_${i}`,
              sessionId: state.sessionId,
              projectName: state.projectName,
              cwd: state.cwd,
              floor: state.floorNumber,
              agentType: 'antigravity',
              agentId: 'main',
              timestamp: now,
              action: 'ask_user',
              room: 'user_desk',
              questionText: questionText.slice(0, 150)
            });
          } else {
            state.currentRoom = room;
            events.push({
              id: `ag_${state.sessionId}_${obj.step_index}_tool_${i}`,
              sessionId: state.sessionId,
              projectName: state.projectName,
              cwd: state.cwd,
              floor: state.floorNumber,
              agentType: 'antigravity',
              agentId: 'main',
              timestamp: now,
              action: 'tool_start',
              room: room,
              toolName: toolName,
              toolSummary: toolSummary,
              toolArgs: tc.args || {}
            });
          }
        }
      } else if (obj.content && !obj.tool_calls) {
        events.push({
          id: `ag_${state.sessionId}_${obj.step_index}_done`,
          sessionId: state.sessionId,
          projectName: state.projectName,
          cwd: state.cwd,
          floor: state.floorNumber,
          agentType: 'antigravity',
          agentId: 'main',
          timestamp: now,
          action: 'turn_finish',
          room: 'user_desk',
          resultSummary: typeof obj.content === 'string' ? obj.content.slice(0, 150) : '작업 완료'
        });
      }
      return events;
    }

    // 3) GENERIC
    if (obj.type === 'GENERIC') {
      const isError = obj.status === 'ERROR' || (typeof obj.content === 'string' && /error|failed/i.test(obj.content));
      events.push({
        id: `ag_${state.sessionId}_${obj.step_index}_res`,
        sessionId: state.sessionId,
        projectName: state.projectName,
        cwd: state.cwd,
        floor: state.floorNumber,
        agentType: 'antigravity',
        agentId: 'main',
        timestamp: now,
        action: 'tool_end',
        room: state.currentRoom || 'dev',
        isError: isError,
        errorSummary: isError ? (typeof obj.content === 'string' ? obj.content.slice(0, 120) : '도구 실패') : null,
        resultSummary: typeof obj.content === 'string' ? obj.content.slice(0, 100) : '결과 수신'
      });
      return events;
    }

    return events;
  } catch (err) {
    return [];
  }
}

// ==========================================
// 6. Claude Code 로그 이벤트 변환기
// ==========================================
function parseClaudeLine(line, state) {
  try {
    const obj = JSON.parse(line);
    const events = [];
    const now = Date.parse(obj.timestamp) || Date.now();

    if (obj.type === 'user') {
      let prompt = '사용자 질문';
      if (obj.message && obj.message.content) {
        if (typeof obj.message.content === 'string') prompt = obj.message.content;
        else if (Array.isArray(obj.message.content)) {
          const t = obj.message.content.find(c => c.type === 'text');
          if (t && t.text) prompt = t.text;
          for (const c of obj.message.content) {
            if (c.type === 'tool_result') {
              events.push({
                id: `claude_${state.sessionId}_${c.tool_use_id || Date.now()}_res`,
                sessionId: state.sessionId,
                projectName: state.projectName,
                cwd: state.cwd,
                floor: state.floorNumber,
                agentType: 'claude',
                agentId: 'main',
                timestamp: now,
                action: 'tool_end',
                room: state.currentRoom || 'dev',
                isError: Boolean(c.is_error),
                errorSummary: c.is_error ? (typeof c.content === 'string' ? c.content.slice(0, 120) : '에러') : null,
                resultSummary: typeof c.content === 'string' ? c.content.slice(0, 100) : '결과 수신'
              });
            }
          }
        }
      }
      if (events.length === 0) {
        events.push({
          id: `claude_${state.sessionId}_${Date.now()}_user`,
          sessionId: state.sessionId,
          projectName: state.projectName,
          cwd: state.cwd,
          floor: state.floorNumber,
          agentType: 'claude',
          agentId: 'main',
          timestamp: now,
          action: 'user_input',
          room: 'user_desk',
          userPrompt: prompt.slice(0, 150)
        });
      }
      return events;
    }

    if (obj.type === 'assistant' && obj.message) {
      const msg = obj.message;
      if (Array.isArray(msg.content)) {
        for (let i = 0; i < msg.content.length; i++) {
          const item = msg.content[i];
          if (item.type === 'thinking' && item.thinking && item.thinking.trim()) {
            events.push({
              id: `claude_${state.sessionId}_${Date.now()}_think_${i}`,
              sessionId: state.sessionId,
              projectName: state.projectName,
              cwd: state.cwd,
              floor: state.floorNumber,
              agentType: 'claude',
              agentId: 'main',
              timestamp: now,
              action: 'thinking',
              room: 'meeting',
              thinkingText: item.thinking.trim()
            });
          } else if (item.type === 'tool_use') {
            const toolName = item.name;
            const room = getRoomForTool(toolName);
            state.currentRoom = room;

            if (toolName === 'Agent' || toolName === 'Task') {
              const subId = `sub_${Date.now() % 1000}`;
              state.subagents.add(subId);
              if (state.subagents.size > 100) {
                const oldest = state.subagents.values().next().value;
                state.subagents.delete(oldest);
              }
              events.push({
                id: `claude_${state.sessionId}_${item.id || i}_sub`,
                sessionId: state.sessionId,
                projectName: state.projectName,
                cwd: state.cwd,
                floor: state.floorNumber,
                agentType: 'claude',
                agentId: subId,
                timestamp: now,
                action: 'subagent_spawn',
                room: 'elevator',
                subagentName: item.input && item.input.name ? item.input.name : 'Subagent',
                subagentRole: '작업 위임'
              });
            } else if (toolName === 'AskUserQuestion') {
              events.push({
                id: `claude_${state.sessionId}_${item.id || i}_ask`,
                sessionId: state.sessionId,
                projectName: state.projectName,
                cwd: state.cwd,
                floor: state.floorNumber,
                agentType: 'claude',
                agentId: 'main',
                timestamp: now,
                action: 'ask_user',
                room: 'user_desk',
                questionText: (item.input && item.input.question) || '사용자에게 질문'
              });
            } else {
              events.push({
                id: `claude_${state.sessionId}_${item.id || i}_tool`,
                sessionId: state.sessionId,
                projectName: state.projectName,
                cwd: state.cwd,
                floor: state.floorNumber,
                agentType: 'claude',
                agentId: 'main',
                timestamp: now,
                action: 'tool_start',
                room: room,
                toolName: toolName,
                toolSummary: JSON.stringify(item.input || {}).slice(0, 100),
                toolArgs: item.input || {}
              });
            }
          }
        }
      }

      if (msg.stop_reason === 'end_turn') {
        events.push({
          id: `claude_${state.sessionId}_${Date.now()}_end`,
          sessionId: state.sessionId,
          projectName: state.projectName,
          cwd: state.cwd,
          floor: state.floorNumber,
          agentType: 'claude',
          agentId: 'main',
          timestamp: now,
          action: 'turn_finish',
          room: 'user_desk',
          resultSummary: '턴 종료 및 결과 보고'
        });
      }
      return events;
    }

    return events;
  } catch (err) {
    return [];
  }
}

// ==========================================
// 7. 세션 디렉터리 스캐너 & 층 계산
// ==========================================
function discoverAllSessionFiles() {
  const discovered = [];

  // A. Antigravity 세션 스캔
  if (fs.existsSync(ANTIGRAVITY_BRAIN_DIR)) {
    try {
      const convs = fs.readdirSync(ANTIGRAVITY_BRAIN_DIR);
      for (const convId of convs) {
        const transcriptPath = path.join(ANTIGRAVITY_BRAIN_DIR, convId, '.system_generated', 'logs', 'transcript.jsonl');
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
  if (fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    try {
      const projectDirs = fs.readdirSync(CLAUDE_PROJECTS_DIR);
      for (const pDir of projectDirs) {
        const fullPDir = path.join(CLAUDE_PROJECTS_DIR, pDir);
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

// ==========================================
// 6-1. 토큰 사용량(Token Usage) 집계 및 중복 방지
// ==========================================
// ==========================================
// 6-1. 토큰 사용량(Token Usage) 집계 및 중복 방지 (FIFO 최대 5000개)
// ==========================================
function recordSeenTokenId(state, key) {
  if (!state.seenTokenIds.has(key)) {
    state.seenTokenIds.add(key);
    if (state.seenTokenIds.size > 5000) {
      const oldest = state.seenTokenIds.values().next().value;
      state.seenTokenIds.delete(oldest);
    }
    return true;
  }
  return false;
}

function accumulateTokenUsage(state, line) {
  try {
    if (!line || !line.trim()) return false;
    const obj = JSON.parse(line);

    // 1. Antigravity: obj.input_tokens / obj.output_tokens / obj.cache_read_tokens
    if (state.engine === 'antigravity') {
      if (obj.input_tokens !== undefined || obj.output_tokens !== undefined) {
        const key = `ag_${obj.step_index}`;
        if (recordSeenTokenId(state, key)) {
          const inp = Number(obj.input_tokens) || 0;
          const out = Number(obj.output_tokens) || 0;
          const cache = Number(obj.cache_read_tokens) || 0;
          state.tokenUsage.hasData = true;
          state.tokenUsage.inputTokens += inp;
          state.tokenUsage.outputTokens += out;
          state.tokenUsage.cacheTokens += cache;
          state.tokenUsage.totalTokens += (inp + out + cache);
          return true;
        }
      }
    }
    // 2. Claude Code: obj.type === 'assistant' && obj.message && obj.message.usage
    else if (state.engine === 'claude') {
      if (obj.type === 'assistant' && obj.message && obj.message.usage) {
        const key = obj.message.id || obj.uuid;
        if (key && recordSeenTokenId(state, key)) {
          const u = obj.message.usage;
          const inp = Number(u.input_tokens) || 0;
          const out = Number(u.output_tokens) || 0;
          const cache = (Number(u.cache_read_input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0);
          state.tokenUsage.hasData = true;
          state.tokenUsage.inputTokens += inp;
          state.tokenUsage.outputTokens += out;
          state.tokenUsage.cacheTokens += cache;
          state.tokenUsage.totalTokens += (inp + out + cache);
          if (obj.message.model && !state.tokenUsage.model) {
            state.tokenUsage.model = obj.message.model;
          }
          return true;
        }
      }
    }
  } catch (e) {}
  return false;
}

// ==========================================
// 6-2. 토큰 집계 디스크 캐시 (.cache/token-index.json)
// agent-office 폴더 밖에는 절대 쓰지 않음
// ==========================================
const CACHE_DIR = path.join(__dirname, '.cache');
const TOKEN_CACHE_FILE = path.join(CACHE_DIR, 'token-index.json');
let tokenCache = {};
let tokenCacheLoaded = false;
let tokenCacheDirty = false;

function loadTokenCache() {
  if (tokenCacheLoaded) return;
  tokenCacheLoaded = true;
  try {
    if (fs.existsSync(TOKEN_CACHE_FILE)) {
      const data = fs.readFileSync(TOKEN_CACHE_FILE, 'utf-8');
      tokenCache = JSON.parse(data) || {};
    }
  } catch (e) {
    tokenCache = {};
  }
}

function saveTokenCache() {
  if (!tokenCacheDirty) return;
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(TOKEN_CACHE_FILE, JSON.stringify(tokenCache, null, 2), 'utf-8');
    tokenCacheDirty = false;
  } catch (e) {}
}

// ==========================================
// 6-3. 비동기 1MB 청크 스트림 파서 (Buffer 0x0A 개행 기준, 이벤트 루프 양보)
// ==========================================
async function streamProcessSessionTokens(state) {
  loadTokenCache();

  try {
    if (!fs.existsSync(state.filePath)) return;
    const stat = fs.statSync(state.filePath);
    const totalSize = stat.size;
    state.ino = stat.ino;

    if (totalSize === 0) {
      state.lastOffset = 0;
      return;
    }

    // 1. 캐시 완전 일치 검사 (size & mtime 동일)
    const cached = tokenCache[state.filePath];
    if (cached && cached.size === totalSize && cached.mtime === stat.mtimeMs) {
      state.tokenUsage = { ...cached.tokenUsage };
      state.lastOffset = cached.lastOffset;
      state.seenTokenIds = new Set(cached.seenTokenIds || []);
      return;
    }

    // 2. 캐시 부분 일치 검사 (파일이 커진 경우 저장된 lastOffset부터 이어 읽기)
    let startOffset = 0;
    if (cached && totalSize > cached.size && stat.mtimeMs >= cached.mtime && cached.lastOffset < totalSize) {
      state.tokenUsage = { ...cached.tokenUsage };
      state.seenTokenIds = new Set(cached.seenTokenIds || []);
      startOffset = cached.lastOffset;
    }

    if (startOffset >= totalSize) {
      state.lastOffset = totalSize;
      return;
    }

    let fd;
    try {
      fd = fs.openSync(state.filePath, 'r');
    } catch (err) {
      return;
    }

    const CHUNK_SIZE = 1024 * 1024; // 1MB
    let currentOffset = startOffset;
    let leftoverBuf = Buffer.alloc(0);
    let lastProcessedNewlineOffset = startOffset;

    try {
      while (currentOffset < totalSize) {
        const bytesToRead = Math.min(CHUNK_SIZE, totalSize - currentOffset);
        const readBuf = Buffer.alloc(bytesToRead);
        const bytesRead = fs.readSync(fd, readBuf, 0, bytesToRead, currentOffset);
        if (bytesRead <= 0) break;

        const chunk = leftoverBuf.length > 0
          ? Buffer.concat([leftoverBuf, readBuf.subarray(0, bytesRead)])
          : readBuf.subarray(0, bytesRead);

        let lineStart = 0;
        let lastNewlineIdxInChunk = -1;

        for (let i = 0; i < chunk.length; i++) {
          if (chunk[i] === 0x0A) { // 개행 바이트 (0x0A, '\n')
            const lineBuf = chunk.subarray(lineStart, i);
            lineStart = i + 1;
            lastNewlineIdxInChunk = i;
            if (lineBuf.length > 0) {
              const lineStr = lineBuf.toString('utf-8');
              accumulateTokenUsage(state, lineStr);
            }
          }
        }

        const chunkFileBase = currentOffset - leftoverBuf.length;
        if (lastNewlineIdxInChunk !== -1) {
          lastProcessedNewlineOffset = chunkFileBase + lastNewlineIdxInChunk + 1;
          leftoverBuf = chunk.subarray(lineStart);
        } else {
          leftoverBuf = chunk;
        }

        currentOffset += bytesRead;

        // 청크 사이에 이벤트 루프에 양보 (setImmediate)하여 서버 프리징 방지
        await new Promise(resolve => setImmediate(resolve));
      }
    } finally {
      try { fs.closeSync(fd); } catch (e) {}
    }

    state.lastOffset = lastProcessedNewlineOffset;
    state.partialBuffer = '';

    // 캐시 갱신
    tokenCache[state.filePath] = {
      size: totalSize,
      mtime: stat.mtimeMs,
      lastOffset: state.lastOffset,
      tokenUsage: { ...state.tokenUsage },
      seenTokenIds: Array.from(state.seenTokenIds).slice(-5000)
    };
    tokenCacheDirty = true;
  } catch (err) {}
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

// ==========================================
// 7. 세션 탐색 및 파일 등록 (3회 미탐색 세션 제거)
// ==========================================
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

// ==========================================
// 8. 0.25초 (250ms) 주기 폴링 루프
// ==========================================
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

// 가변 폴링 주기 스케줄러 (클라이언트 접속 중: 0.25초, 대기 중: 2초)
const POLL_INTERVAL_ACTIVE_MS = 250;
const POLL_INTERVAL_IDLE_MS = 2000;
let pollTimer = null;

function scheduleNextPoll(immediate = false) {
  if (pollTimer) clearTimeout(pollTimer);
  const interval = sseClients.size > 0 ? POLL_INTERVAL_ACTIVE_MS : POLL_INTERVAL_IDLE_MS;
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

// ==========================================
// 9. HTTP 서버 생성 (127.0.0.1 바인딩 & 보안 강화)
// ==========================================
const APP_NAME = 'agent-office';
const APP_VERSION = '2.1.0';

const server = http.createServer((req, res) => {
  // 1) Host 헤더 검사 (DNS 리바인딩 방어)
  const hostHeader = (req.headers.host || '').toLowerCase();
  const allowedHosts = new Set([
    `${HOST}:${PORT}`,
    `localhost:${PORT}`,
    HOST,
    'localhost'
  ]);
  if (!allowedHosts.has(hostHeader)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden: Invalid Host');
    return;
  }

  // 2) 보안 헤더 설정 (Access-Control-Allow-Origin 제거, Content-Security-Policy 추가)
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:;");

  // 3) URI 디코딩 및 Null 바이트(%00) 검사
  const rawPath = req.url.split('?')[0];
  if (rawPath.includes('%00') || rawPath.includes('\0')) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('400 Bad Request');
    return;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(rawPath);
    if (decodedPath.includes('\0')) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('400 Bad Request');
      return;
    }
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('400 Bad Request: Malformed URI');
    return;
  }

  // 4) API 라우팅
  if (decodedPath === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      app: APP_NAME,
      version: APP_VERSION,
      pid: process.pid,
      uptime: Math.round(process.uptime())
    }));
    return;
  }

  if (decodedPath === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive'
    });
    res.write('retry: 1000\n\n');

    sseClients.add(res);
    scheduleNextPoll(true);

    req.on('close', () => {
      sseClients.delete(res);
      if (sseClients.size === 0) {
        scheduleNextPoll();
      }
    });

    // Last-Event-ID 또는 URL 쿼리(lastEventId) 확인
    let lastSeq = null;
    const lastEventIdHeader = req.headers['last-event-id'];
    if (lastEventIdHeader) {
      const parsed = parseInt(lastEventIdHeader, 10);
      if (!isNaN(parsed)) lastSeq = parsed;
    }
    if (lastSeq === null && req.url.includes('lastEventId=')) {
      const m = req.url.match(/lastEventId=(\d+)/);
      if (m) lastSeq = parseInt(m[1], 10);
    }

    if (lastSeq !== null) {
      // 재연결 클라이언트: 링 버퍼에서 놓친 이벤트만 전송
      const missed = eventRingBuffer.filter(ev => ev.seq > lastSeq);
      for (const ev of missed) {
        res.write(`id: ${ev.seq}\nevent: agent_event\ndata: ${JSON.stringify(ev)}\n\n`);
      }
    } else {
      // 신규 클라이언트: 세션별 최근 최대 30개 이벤트를 replay: true로 전송하여 상태 즉시 복원
      for (const [_, events] of sessionRecentEvents.entries()) {
        for (const ev of events) {
          const replayEv = { ...ev, replay: true };
          res.write(`id: ${ev.seq || ''}\nevent: agent_event\ndata: ${JSON.stringify(replayEv)}\n\n`);
        }
      }
    }

    setTimeout(() => {
      broadcastSessionsList();
    }, 100);
    return;
  }

  if (decodedPath === '/api/projects' || decodedPath === '/api/sessions') {
    const projectsList = buildProjectsList();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(maskSecrets(projectsList)));
    return;
  }

  // 5) 정적 파일 경로 탈출 방지 및 안전 서빙
  const PUBLIC_DIR = path.resolve(__dirname, 'public');
  const ALLOWED_EXTS = new Set(['.html', '.js', '.css', '.png', '.svg', '.ico']);
  const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };

  // 루트 요청 '/' -> 'index.html' 매핑, 그 외는 지정된 경로 그대로 사용
  const targetRel = (decodedPath === '/' || decodedPath === '') ? 'index.html' : decodedPath.replace(/^\/+/, '');
  const resolvedPath = path.resolve(PUBLIC_DIR, targetRel);

  // public 디렉터리 경로 탈출 검사
  if (resolvedPath !== PUBLIC_DIR && !resolvedPath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  // 파일 존재 여부 검사 (존재하지 않으면 404)
  if (!fs.existsSync(resolvedPath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  // 심볼릭 링크 탈출 검사 (realpathSync)
  let realPath;
  try {
    realPath = fs.realpathSync(resolvedPath);
    if (realPath !== PUBLIC_DIR && !realPath.startsWith(PUBLIC_DIR + path.sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden');
      return;
    }
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  // 디렉터리 요청 차단
  try {
    const stat = fs.statSync(realPath);
    if (stat.isDirectory()) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden');
      return;
    }
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  // 확장자 화이트리스트 검사
  const ext = path.extname(realPath).toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden: Disallowed extension');
    return;
  }

  // 파일 서빙
  try {
    const content = fs.readFileSync(realPath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('500 Internal Server Error');
  }
});

// 안전한 종료 (SIGINT / SIGTERM)
function gracefulShutdown(signal) {
  console.log(`\n🛑 [에이전트 오피스] ${signal} 수신: 서버를 안전하게 종료합니다...`);
  saveTokenCache();
  for (const client of sseClients) {
    try {
      client.write('event: server_shutdown\ndata: {"status":"shutdown"}\n\n');
      client.end();
    } catch (e) {}
  }
  sseClients.clear();
  server.close(() => {
    console.log('✅ [에이전트 오피스] 서버가 완전히 종료되었습니다.');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1500);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

scanSessions();
scheduleNextPoll();

// 포트 충돌 처리 및 중복 기동 방지
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    const checkReq = http.get(`http://${HOST}:${PORT}/api/health`, {
      headers: { Host: `${HOST}:${PORT}` },
      timeout: 2000
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.app === APP_NAME) {
            console.log(`🏢 [에이전트 오피스] 서버가 이미 백그라운드에서 실행 중입니다 (PID: ${data.pid}, http://${HOST}:${PORT}).`);
            process.exit(0);
          }
        } catch (e) {}
        console.error(`❌ [에이전트 오피스] 포트 ${PORT}가 다른 프로그램에 의해 이미 사용 중입니다.`);
        console.error(`   👉 PORT 환경변수로 다른 포트를 지정하세요: PORT=${Number(PORT) + 1} ./office.sh start`);
        process.exit(1);
      });
    });
    checkReq.on('error', () => {
      console.error(`❌ [에이전트 오피스] 포트 ${PORT}가 다른 프로그램에 의해 이미 사용 중입니다.`);
      console.error(`   👉 PORT 환경변수로 다른 포트를 지정하세요: PORT=${Number(PORT) + 1} ./office.sh start`);
      process.exit(1);
    });
    checkReq.on('timeout', () => {
      checkReq.destroy();
      console.error(`❌ [에이전트 오피스] 포트 ${PORT}가 다른 프로그램에 의해 이미 사용 중입니다.`);
      process.exit(1);
    });
  } else {
    console.error(`❌ 서버 오류 발생:`, err);
    process.exit(1);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`====================================================`);
  console.log(`  🏢 [에이전트 오피스 / Agent Office] v${APP_VERSION} 서버 기동!`);
  console.log(`  🔗 웹페이지: http://${HOST}:${PORT}`);
  console.log(`  🔒 로컬 전용 바인딩: ${HOST}`);
  console.log(`  ⏱️  감시 주기: 가변 (활성 ${POLL_INTERVAL_ACTIVE_MS}ms / 대기 ${POLL_INTERVAL_IDLE_MS}ms)`);
  console.log(`====================================================`);
});
