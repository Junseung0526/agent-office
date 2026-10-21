/**
 * 에이전트 오피스 (Agent Office) - 구조화 로거 (lib/logger.js)
 *
 * 출력 형식: 2026-10-21 09:41:02.123  INFO   server   메시지  key=value ...
 * TTY 출력일 때만 ANSI 색상을 적용하며, NO_COLOR 환경변수가 있으면 색상을 끈다.
 */

const LEVELS = {
  debug: { label: 'DEBUG', color: '\x1b[90m', rank: 10 },
  info:  { label: 'INFO ', color: '\x1b[36m', rank: 20 },
  warn:  { label: 'WARN ', color: '\x1b[33m', rank: 30 },
  error: { label: 'ERROR', color: '\x1b[31m', rank: 40 }
};

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';

const minRank = (LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] || LEVELS.info).rank;
const useColor = (stream) => Boolean(stream.isTTY) && !process.env.NO_COLOR;

function pad2(n) { return String(n).padStart(2, '0'); }

function timestamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function formatValue(v) {
  if (v instanceof Error) return JSON.stringify(v.message);
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return /[\s"=]/.test(s) ? JSON.stringify(s) : s;
}

function write(level, scope, message, fields) {
  const def = LEVELS[level];
  if (def.rank < minRank) return;
  const stream = def.rank >= LEVELS.warn.rank ? process.stderr : process.stdout;
  const color = useColor(stream);

  const kv = fields
    ? Object.entries(fields)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => (color ? `${DIM}${k}=${RESET}` : `${k}=`) + formatValue(v))
        .join(' ')
    : '';

  const ts = color ? `${DIM}${timestamp()}${RESET}` : timestamp();
  const lv = color ? `${def.color}${BOLD}${def.label}${RESET}` : def.label;
  const sc = (color ? `${DIM}${scope.padEnd(8)}${RESET}` : scope.padEnd(8));
  stream.write(`${ts}  ${lv}  ${sc} ${message}${kv ? '  ' + kv : ''}\n`);

  if (fields && fields.err instanceof Error && fields.err.stack && def.rank >= LEVELS.error.rank) {
    stream.write(fields.err.stack.split('\n').slice(1).join('\n') + '\n');
  }
}

function createLogger(scope) {
  return {
    debug: (msg, fields) => write('debug', scope, msg, fields),
    info: (msg, fields) => write('info', scope, msg, fields),
    warn: (msg, fields) => write('warn', scope, msg, fields),
    error: (msg, fields) => write('error', scope, msg, fields)
  };
}

module.exports = { createLogger };
