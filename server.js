/**
 * 에이전트 오피스 (Agent Office) - 로컬 백엔드 서버 (server.js)
 * 순수 Node.js 표준 라이브러리만 사용 (의존성 0개)
 * 127.0.0.1에만 바인딩 (외부 접근 불가)
 */

const http = require('http');
const fs = require('fs');
const config = require('./lib/config');
const { isValidHost, setSecurityHeaders, resolveSafeStaticPath, maskSecrets } = require('./lib/security');
const { handleSseConnection, closeAllSseClients } = require('./lib/sse');
const { scanSessions, scheduleNextPoll, buildProjectsList, broadcastSessionsList, stopPoll } = require('./lib/sessions');
const { saveTokenCache } = require('./lib/tail');
const { createLogger } = require('./lib/logger');

const log = createLogger('server');

// HTTP 서버 인스턴스 생성
const server = http.createServer((req, res) => {
  // 1) Host 헤더 검사 (DNS 리바인딩 방어)
  if (!isValidHost(req.headers.host, config.HOST, config.PORT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden: Invalid Host');
    return;
  }

  // 2) 보안 헤더 설정
  setSecurityHeaders(res);

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
  if (decodedPath === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (decodedPath === '/api/health') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.end(JSON.stringify({
      app: config.APP_NAME,
      version: config.APP_VERSION,
      pid: process.pid,
      uptime: Math.round(process.uptime())
    }));
    return;
  }

  if (decodedPath === '/api/events') {
    handleSseConnection(req, res, {
      onConnect: (immediate) => scheduleNextPoll(immediate),
      onDisconnect: (clientCount) => {
        if (clientCount === 0) scheduleNextPoll();
      },
      broadcastSessions: () => broadcastSessionsList()
    });
    return;
  }

  if (decodedPath === '/api/projects' || decodedPath === '/api/sessions') {
    const projectsList = buildProjectsList();
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.end(JSON.stringify(maskSecrets(projectsList)));
    return;
  }

  // 5) 정적 파일 경로 탈출 방지 및 안전 서빙
  const safeResult = resolveSafeStaticPath(config.PUBLIC_DIR, decodedPath, config.ALLOWED_EXTS);
  if (safeResult.status !== 200) {
    res.writeHead(safeResult.status, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(safeResult.error || `${safeResult.status}`);
    return;
  }

  try {
    const content = fs.readFileSync(safeResult.realPath);
    const contentType = config.MIME_TYPES[safeResult.ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('500 Internal Server Error');
  }
});

// 안전한 종료 (SIGINT / SIGTERM)
function gracefulShutdown(signal) {
  log.info('Shutting down', { signal });
  stopPoll();
  saveTokenCache();
  closeAllSseClients();
  server.close(() => {
    log.info('Server stopped');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1500);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// 세션 초기 스캔 및 폴링 시작
scanSessions();
scheduleNextPoll();

function exitPortInUse() {
  log.error('Port is already in use by another process', { port: config.PORT, hint: `PORT=${Number(config.PORT) + 1} ./office.sh start` });
  process.exit(1);
}

// 포트 충돌 처리 및 중복 기동 방지
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    const checkReq = http.get(`http://${config.HOST}:${config.PORT}/api/health`, {
      headers: { Host: `${config.HOST}:${config.PORT}` },
      timeout: 2000
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.app === config.APP_NAME) {
            log.info('Another Agent Office instance is already running', { pid: data.pid, url: `http://${config.HOST}:${config.PORT}` });
            process.exit(0);
          }
        } catch (e) {}
        exitPortInUse();
      });
    });
    checkReq.on('error', () => {
      exitPortInUse();
    });
    checkReq.on('timeout', () => {
      checkReq.destroy();
      exitPortInUse();
    });
  } else {
    log.error('Server error', { code: err.code, err });
    process.exit(1);
  }
});

server.listen(config.PORT, config.HOST, () => {
  log.info(`Agent Office v${config.APP_VERSION} listening`, {
    url: `http://${config.HOST}:${config.PORT}`,
    pid: process.pid,
    node: process.version
  });
  log.info('Session watcher started', {
    pollActiveMs: config.POLL_INTERVAL_ACTIVE_MS,
    pollIdleMs: config.POLL_INTERVAL_IDLE_MS
  });
});
