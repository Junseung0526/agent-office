/**
 * 에이전트 오피스 (Agent Office) - SSE(Server-Sent Events) 모듈 (lib/sse.js)
 * 실시간 이벤트 브로드캐스트, 500개 링 버퍼, Last-Event-ID 복원 및 30개 replay 지원
 */

const { EVENT_RING_BUFFER_SIZE } = require('./config');
const { createLogger } = require('./logger');

const log = createLogger('sse');
const { maskSecrets } = require('./security');

const sseClients = new Set();
let eventSeq = 0;
const eventRingBuffer = [];
const sessionRecentEvents = new Map(); // sessionId -> array of recent events (max 30), LRU 순서
const MAX_REPLAY_SESSIONS = 200;               // replay 대상 세션 수 상한 (장기 가동 시 메모리 제한)
const MAX_CLIENT_BUFFER_BYTES = 8 * 1024 * 1024; // 이보다 밀린 느린 클라이언트는 끊는다 (재연결 시 Last-Event-ID로 복원)
const HEARTBEAT_MS = 25000;

// 끊긴/종료된/정체된 클라이언트에 쓰지 않는다 (write-after-end 'error'로 인한 프로세스 종료 방지)
function send(res, payload) {
  if (res.destroyed || res.writableEnded) {
    sseClients.delete(res);
    return;
  }
  if (res.writableLength > MAX_CLIENT_BUFFER_BYTES) {
    sseClients.delete(res);
    res.destroy();
    return;
  }
  res.write(payload);
}

// 주기적 주석 핑: 프록시/OS의 유휴 연결 정리를 막고 죽은 소켓을 빨리 감지
const heartbeat = setInterval(() => {
  for (const client of sseClients) send(client, ': ping\n\n');
}, HEARTBEAT_MS);
heartbeat.unref();

function getSseClientCount() {
  return sseClients.size;
}

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
      const sEvents = sessionRecentEvents.get(sanitized.sessionId) || [];
      sessionRecentEvents.delete(sanitized.sessionId); // 재삽입으로 최근 사용 순서 유지
      sessionRecentEvents.set(sanitized.sessionId, sEvents);
      sEvents.push(sanitized);
      if (sEvents.length > 30) sEvents.shift();
      if (sessionRecentEvents.size > MAX_REPLAY_SESSIONS) {
        sessionRecentEvents.delete(sessionRecentEvents.keys().next().value);
      }
    }
  }

  if (sseClients.size === 0) return;
  const idLine = sanitized.seq ? `id: ${sanitized.seq}\n` : '';
  const payload = `${idLine}event: ${eventName}\ndata: ${JSON.stringify(sanitized)}\n\n`;
  for (const client of sseClients) {
    try {
      send(client, payload);
    } catch (err) {
      sseClients.delete(client);
    }
  }
}

function handleSseConnection(req, res, hooks = {}) {
  const { onConnect, onDisconnect, broadcastSessions } = hooks;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive'
  });
  res.write('retry: 1000\n\n');

  res.on('error', () => sseClients.delete(res));
  sseClients.add(res);
  log.info('Client connected', { clients: sseClients.size, resume: req.headers['last-event-id'] || undefined });
  if (typeof onConnect === 'function') {
    onConnect(true);
  }

  req.on('close', () => {
    sseClients.delete(res);
    log.info('Client disconnected', { clients: sseClients.size });
    if (typeof onDisconnect === 'function') {
      onDisconnect(sseClients.size);
    }
  });

  // Last-Event-ID 또는 URL 쿼리(lastEventId) 확인
  let lastSeq = null;
  const lastEventIdHeader = req.headers['last-event-id'];
  if (lastEventIdHeader) {
    const parsed = parseInt(lastEventIdHeader, 10);
    if (!isNaN(parsed)) lastSeq = parsed;
  }
  if (lastSeq === null && req.url && req.url.includes('lastEventId=')) {
    const m = req.url.match(/lastEventId=(\d+)/);
    if (m) lastSeq = parseInt(m[1], 10);
  }

  if (lastSeq !== null) {
    // 재연결 클라이언트: 링 버퍼에서 놓친 이벤트만 전송
    const missed = eventRingBuffer.filter(ev => ev.seq > lastSeq);
    for (const ev of missed) {
      send(res, `id: ${ev.seq}\nevent: agent_event\ndata: ${JSON.stringify(ev)}\n\n`);
    }
  } else {
    // 신규 클라이언트: 세션별 최근 최대 30개 이벤트를 replay: true로 전송하여 상태 즉시 복원
    for (const [_, events] of sessionRecentEvents.entries()) {
      for (const ev of events) {
        const replayEv = { ...ev, replay: true };
        send(res, `id: ${ev.seq || ''}\nevent: agent_event\ndata: ${JSON.stringify(replayEv)}\n\n`);
      }
    }
  }

  setTimeout(() => {
    if (typeof broadcastSessions === 'function') {
      broadcastSessions();
    }
  }, 100);
}

function closeAllSseClients() {
  for (const client of sseClients) {
    try {
      client.write('event: server_shutdown\ndata: {"status":"shutdown"}\n\n');
      client.end();
    } catch (e) {}
  }
  sseClients.clear();
}

module.exports = {
  getSseClientCount,
  broadcastEvent,
  handleSseConnection,
  closeAllSseClients
};
