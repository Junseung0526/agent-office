/**
 * 에이전트 오피스 (Agent Office) - 보안 모듈 (lib/security.js)
 * 민감정보(비밀값/토큰/패스워드) 마스킹, DNS 리바인딩 방어, 정적 파일 경로 탈출 방어
 */

const fs = require('fs');
const path = require('path');

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

function isValidHost(hostHeader, host, port) {
  const lower = (hostHeader || '').toLowerCase();
  const allowed = new Set([
    `${host}:${port}`,
    `localhost:${port}`,
    host,
    'localhost'
  ]);
  return allowed.has(lower);
}

function setSecurityHeaders(res) {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:;");
}

function resolveSafeStaticPath(publicDir, decodedPath, allowedExts) {
  const targetRel = (decodedPath === '/' || decodedPath === '') ? 'index.html' : decodedPath.replace(/^\/+/, '');
  const resolvedPath = path.resolve(publicDir, targetRel);

  // 1. public 디렉터리 경로 탈출 검사
  if (resolvedPath !== publicDir && !resolvedPath.startsWith(publicDir + path.sep)) {
    return { status: 403, error: '403 Forbidden' };
  }

  // 2. 파일 존재 여부 검사
  if (!fs.existsSync(resolvedPath)) {
    return { status: 404, error: '404 Not Found' };
  }

  // 3. 심볼릭 링크 탈출 검사 (realpathSync)
  let realPath;
  try {
    realPath = fs.realpathSync(resolvedPath);
    if (realPath !== publicDir && !realPath.startsWith(publicDir + path.sep)) {
      return { status: 403, error: '403 Forbidden' };
    }
  } catch (err) {
    return { status: 404, error: '404 Not Found' };
  }

  // 4. 디렉터리 요청 차단
  try {
    const stat = fs.statSync(realPath);
    if (stat.isDirectory()) {
      return { status: 403, error: '403 Forbidden' };
    }
  } catch (err) {
    return { status: 404, error: '404 Not Found' };
  }

  // 5. 확장자 화이트리스트 검사
  const ext = path.extname(realPath).toLowerCase();
  if (!allowedExts.has(ext)) {
    return { status: 403, error: '403 Forbidden: Disallowed extension' };
  }

  return { status: 200, realPath, ext };
}

module.exports = {
  SENSITIVE_KEY_REGEX,
  SENSITIVE_CLI_FLAG_REGEX,
  isMetricOrNonSensitiveKey,
  maskSecrets,
  isValidHost,
  setSecurityHeaders,
  resolveSafeStaticPath
};
