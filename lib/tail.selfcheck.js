// Self-check for readNewLines: node lib/tail.selfcheck.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { readNewLines } = require('./tail');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-tail-'));
const f = path.join(dir, 'a.jsonl');
const st = { filePath: f, lastOffset: 0, seenTokenIds: new Set(), tokenUsage: {} };
const line = JSON.stringify({ t: '한글'.repeat(3) });
const bytes = Buffer.from(line + '\n');

// multibyte char split across two writes, incomplete line held back
fs.writeFileSync(f, bytes.subarray(0, 5));
assert.deepStrictEqual(readNewLines(st), []);
fs.appendFileSync(f, bytes.subarray(5));
assert.deepStrictEqual(readNewLines(st), [line]);

// a line over the read cap is skipped, the next line still parses
fs.appendFileSync(f, 'x'.repeat(5 * 1024 * 1024) + '\n{"ok":1}\n');
assert.deepStrictEqual(readNewLines(st), []);
assert.deepStrictEqual(readNewLines(st), ['{"ok":1}']);

// truncate/rotate restarts from the top; deletion is quiet
fs.writeFileSync(f, '{"z":1}\n');
assert.deepStrictEqual(readNewLines(st), ['{"z":1}']);
fs.rmSync(dir, { recursive: true });
assert.deepStrictEqual(readNewLines(st), []);

console.log('tail selfcheck ok');
