/**
 * 에이전트 오피스 (Agent Office) - 로그 증분 파일 리더 및 토큰 처리 모듈 (lib/tail.js)
 * 1MB 청크 버퍼 스트림, UTF-8 0x0A 바이트 기준 줄분리, 토큰 캐시 관리
 */

const fs = require('fs');
const path = require('path');
const { CACHE_DIR, TOKEN_CACHE_FILE } = require('./config');

let tokenCache = {};
let tokenCacheLoaded = false;
let tokenCacheDirty = false;

function loadTokenCache() {
  if (tokenCacheLoaded) return;
  tokenCacheLoaded = true;
  try {
    if (fs.existsSync(TOKEN_CACHE_FILE)) {
      const data = fs.readFileSync(TOKEN_CACHE_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      tokenCache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
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
    // 삭제된 세션 파일 항목 정리 (캐시 무한 증가 방지)
    for (const filePath of Object.keys(tokenCache)) {
      if (!fs.existsSync(filePath)) delete tokenCache[filePath];
    }
    // 임시 파일에 쓰고 rename: 쓰는 도중 종료돼도 캐시가 깨지지 않음
    const tmp = `${TOKEN_CACHE_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(tokenCache), 'utf-8');
    fs.renameSync(tmp, TOKEN_CACHE_FILE);
    tokenCacheDirty = false;
  } catch (e) {}
}

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

// 한 번의 폴링에서 읽는 최대 바이트 (대용량 증분/개행 없는 거대 줄로 인한 메모리 폭주 방지)
const MAX_READ_BYTES = 4 * 1024 * 1024;

// 완결된 줄(개행으로 끝나는)만 반환하고, lastOffset은 마지막 개행 직후로만 전진한다.
// 바이트 단위로 자르므로 청크 경계에서 UTF-8 멀티바이트 문자가 깨지지 않는다.
function readNewLines(state) {
  try {
    let stat;
    try {
      stat = fs.statSync(state.filePath);
    } catch (e) {
      return []; // 삭제/이동됨: scanSessions가 3회 미탐색 후 정리
    }

    // inode 변경 또는 파일 크기 축소 (로그 로테이션 / truncate) 감지
    if ((state.ino && stat.ino !== state.ino) || stat.size < state.lastOffset) {
      state.lastOffset = 0;
      state.skipPartialLine = false;
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

    const bytesToRead = Math.min(stat.size - state.lastOffset, MAX_READ_BYTES);
    const buffer = Buffer.alloc(bytesToRead);
    const fd = fs.openSync(state.filePath, 'r');
    let bytesRead = 0;
    try {
      bytesRead = fs.readSync(fd, buffer, 0, bytesToRead, state.lastOffset);
    } finally {
      fs.closeSync(fd);
    }
    if (bytesRead <= 0) return [];

    const end = buffer.subarray(0, bytesRead).lastIndexOf(0x0A);
    if (end === -1) {
      // shortcut: a single line longer than MAX_READ_BYTES is skipped, not parsed; raise the cap if such lines matter
      if (bytesRead === MAX_READ_BYTES) {
        state.lastOffset += bytesRead;
        state.skipPartialLine = true;
      }
      return [];
    }
    state.lastOffset += end + 1;

    const lines = buffer.toString('utf-8', 0, end).split('\n');
    if (state.skipPartialLine) {
      lines.shift(); // 건너뛴 거대 줄의 꼬리
      state.skipPartialLine = false;
    }
    return lines.filter(l => l.trim().length > 0);
  } catch (err) {
    return [];
  }
}

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
        // 개행 없는 거대 줄은 버린다 (Buffer.concat 반복으로 인한 메모리/CPU 폭주 방지)
        if (leftoverBuf.length > MAX_READ_BYTES) leftoverBuf = Buffer.alloc(0);

        currentOffset += bytesRead;

        // 청크 사이에 이벤트 루프에 양보 (setImmediate)하여 서버 프리징 방지
        await new Promise(resolve => setImmediate(resolve));
      }
    } finally {
      try { fs.closeSync(fd); } catch (e) {}
    }

    state.lastOffset = lastProcessedNewlineOffset;
    state.skipPartialLine = false;

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

module.exports = {
  loadTokenCache,
  saveTokenCache,
  recordSeenTokenId,
  accumulateTokenUsage,
  readNewLines,
  streamProcessSessionTokens
};
