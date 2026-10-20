/**
 * 에이전트 오피스 (Agent Office) - 설정 모듈 (lib/config.js)
 * 모든 환경변수, 디렉터리 경로, 도구 매핑, 주기 및 화이트리스트 설정
 */

const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3456;
const HOST = '127.0.0.1'; // 절대 제약: 외부 접근 차단
const APP_NAME = 'agent-office';
const APP_VERSION = '2.1.0';

// 폴링 주기 설정 (가변: 활성 250ms, 대기 2000ms)
const POLL_INTERVAL_ACTIVE_MS = 250;
const POLL_INTERVAL_IDLE_MS = 2000;
const POLL_INTERVAL_MS = 250;

// 로그 소스 디렉터리
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

// 토큰 인덱스 캐시 경로 (agent-office/.cache/token-index.json)
const CACHE_DIR = path.resolve(__dirname, '..', '.cache');
const TOKEN_CACHE_FILE = path.join(CACHE_DIR, 'token-index.json');

// 정적 파일 서빙 경로 및 MIME 타입
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const ALLOWED_EXTS = new Set(['.html', '.js', '.css', '.png', '.svg', '.ico']);
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// 도구 이름 -> 방 매핑 설정
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

const DEFAULT_ROOM = 'research'; // 매핑에 없는 도구 기본 방

function getRoomForTool(toolName) {
  if (!toolName) return DEFAULT_ROOM;
  return TOOL_ROOM_MAP[toolName] || DEFAULT_ROOM;
}

const EVENT_RING_BUFFER_SIZE = 500;
const MAX_SUBAGENTS = 100;
const MAX_SEEN_TOKEN_IDS = 5000;

module.exports = {
  PORT,
  HOST,
  APP_NAME,
  APP_VERSION,
  POLL_INTERVAL_ACTIVE_MS,
  POLL_INTERVAL_IDLE_MS,
  POLL_INTERVAL_MS,
  HOME_DIR,
  get CLAUDE_PROJECTS_DIR() { return CLAUDE_PROJECTS_DIR; },
  get ANTIGRAVITY_BRAIN_DIR() { return ANTIGRAVITY_BRAIN_DIR; },
  CACHE_DIR,
  TOKEN_CACHE_FILE,
  PUBLIC_DIR,
  ALLOWED_EXTS,
  MIME_TYPES,
  TOOL_ROOM_MAP,
  DEFAULT_ROOM,
  getRoomForTool,
  EVENT_RING_BUFFER_SIZE,
  MAX_SUBAGENTS,
  MAX_SEEN_TOKEN_IDS
};
