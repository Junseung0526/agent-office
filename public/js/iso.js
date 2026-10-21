/**
 * 에이전트 오피스 (Agent Office) - 아이소메트릭 사무실 렌더러 (public/js/iso.js)
 * 평면도(타일 좌표)를 비스듬히 내려다본 3D 사무실로 그린다.
 * - 정적 레이어(오프스크린 캐시): 섬(잔디/흙) → 기단 → 바닥 무늬 → 벽 그림자(AO) → 가구 접촉 그림자 → 뒷벽
 * - 매 프레임: 방 조명 → 엘리베이터 문 → 깊이 정렬된 칸막이/가구/캐릭터
 * - 오버레이 패스: 방 이름표, 작업 라벨, 캐릭터 이름표/말풍선 (화면 좌표에서 선명하게)
 * - 카메라: 화면 맞춤, 확대/축소(휠·버튼), 드래그 이동, 낮/밤 모드
 */

(function(window) {
  'use strict';

  const Office = window.Office = window.Office || {};
  const { ROOM_DEFS, WORLD, getRoomAt } = Office;
  const T = Office.ISO_THEME;

  const TW = 64;  // 타일 가로(px, 배율 1)
  const TH = 32;  // 타일 세로
  const ZH = 34;  // 높이 1 단위(px)

  const BACK_WALL_H = 2.7;
  const LOW_WALL_H = 1.0;
  const WALL_T = 0.22;
  const GRASS_Z = -0.18; // 잔디는 건물 기단보다 살짝 낮게

  function iso(x, y, z = 0) {
    return [(x - y) * (TW / 2), (x + y) * (TH / 2) - z * ZH];
  }

  // ----------------------------------------------------
  // 색상 유틸 (낮/밤 변환 캐시)
  // ----------------------------------------------------
  const NIGHT_TINT = [40, 46, 110];
  const colorCache = new Map();
  let isNight = false;

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // k: 밝기 배율 (면 음영), 밤에는 남색으로 섞고 어둡게
  // 주의: k/alpha 는 고정 상수만 넘길 것 (연속값을 넘기면 캐시가 계속 커짐)
  function col(hex, k = 1, alpha = 1) {
    const key = `${hex}|${k}|${alpha}|${isNight ? 1 : 0}`;
    let v = colorCache.get(key);
    if (v) return v;
    let [r, g, b] = hexToRgb(hex);
    r *= k; g *= k; b *= k;
    if (isNight) {
      r = r * 0.56 + NIGHT_TINT[0] * 0.24;
      g = g * 0.58 + NIGHT_TINT[1] * 0.24;
      b = b * 0.64 + NIGHT_TINT[2] * 0.32;
    }
    r = Math.max(0, Math.min(255, Math.round(r)));
    g = Math.max(0, Math.min(255, Math.round(g)));
    b = Math.max(0, Math.min(255, Math.round(b)));
    v = alpha < 1 ? `rgba(${r},${g},${b},${alpha})` : `rgb(${r},${g},${b})`;
    colorCache.set(key, v);
    return v;
  }

  function hexA(hex, a) {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  }

  // ----------------------------------------------------
  // 그리기 기본 도형 (월드 좌표)
  // ----------------------------------------------------
  let ctx = null;

  // 항목별 화면 영역(배율 1 아이소 좌표) 측정용: buildScene 직후 한 번만 켬
  let measureBox = null;
  function grow(x, y, r = 0) {
    const b = measureBox;
    if (x - r < b[0]) b[0] = x - r;
    if (y - r < b[1]) b[1] = y - r;
    if (x + r > b[2]) b[2] = x + r;
    if (y + r > b[3]) b[3] = y + r;
  }

  function poly(points, fill) {
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const [sx, sy] = iso(points[i][0], points[i][1], points[i][2] || 0);
      if (measureBox) grow(sx, sy);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function floorRect(x0, y0, x1, y1, z, fill) {
    poly([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], fill);
  }

  // 평면 좌표계로 전환: 이 안에서는 월드 단위로 fillRect/그라디언트를 그대로 쓸 수 있다
  function planeFloor(z) { ctx.transform(TW / 2, TH / 2, -TW / 2, TH / 2, 0, -z * ZH); }           // (x, y)
  function planeWallY(y) { ctx.transform(TW / 2, TH / 2, 0, -ZH, -y * TW / 2, y * TH / 2); }       // y=const 면의 (x, z)
  function planeWallX(x) { ctx.transform(-TW / 2, TH / 2, 0, -ZH, x * TW / 2, x * TH / 2); }      // x=const 면의 (y, z)

  // 상자: 윗면 + 왼쪽 앞면(y 최대) + 오른쪽 앞면(x 최대), 윗면 앞 모서리에 가는 하이라이트
  function box(x, y, w, d, h, base, z0 = 0, opts = {}) {
    const z1 = z0 + h;
    poly([[x + w, y, z0], [x + w, y + d, z0], [x + w, y + d, z1], [x + w, y, z1]], col(opts.right || base, opts.right ? 1 : 0.76));
    poly([[x, y + d, z0], [x + w, y + d, z0], [x + w, y + d, z1], [x, y + d, z1]], col(opts.left || base, opts.left ? 1 : 0.9));
    poly([[x, y, z1], [x + w, y, z1], [x + w, y + d, z1], [x, y + d, z1]], col(opts.top || base, opts.top ? 1 : 1.05));
    if (opts.edge !== false && w > 0.15 && d > 0.15) {
      ctx.strokeStyle = col(opts.top || base, 1.2, 0.85);
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      const a = iso(x, y + d, z1), b = iso(x + w, y + d, z1), c = iso(x + w, y, z1);
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]);
      ctx.stroke();
    }
  }

  // y = const 면 위의 사각형 (왼쪽 앞면 장식용)
  function faceY(x0, x1, y, z0, z1, fill) {
    poly([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], fill);
  }
  // x = const 면 위의 사각형 (오른쪽 앞면 장식용)
  function faceX(x, y0, y1, z0, z1, fill) {
    poly([[x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1]], fill);
  }

  function blob(x, y, z, rPx, fill) {
    const [sx, sy] = iso(x, y, z);
    if (measureBox) grow(sx, sy, rPx);
    ctx.beginPath();
    ctx.arc(sx, sy, rPx, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  // ----------------------------------------------------
  // 정적 장면 구성 (깊이 정렬 대상)
  // ----------------------------------------------------
  // { key, draw, dyn, bb } — buildScene 후 key 순으로 정렬해 둠
  // dyn=false 인 항목은 오프스크린 '가구 레이어'에 구워 두고, 캐릭터·동적 항목을 가리는 것만 매 프레임 다시 그림
  const sceneItems = [];
  const dynItems = [];
  const footShadows = []; // [x, y, w, d, k] 가구 접촉 그림자 (정적 바닥 레이어에 구움)
  const treeSpots = [];   // [x, y, size] 나무 그림자

  function add(key, draw, dyn = false) {
    sceneItems.push({ key, draw, dyn, bb: null, mark: 0 });
  }
  function foot(x, y, w, d, k = 1) {
    footShadows.push([x, y, w, d, k]);
  }

  // 반복 가능한 의사난수 (책 색 등 매 프레임 동일하게)
  function hash(n) {
    const s = Math.sin(n * 127.1) * 43758.5453;
    return s - Math.floor(s);
  }

  function now() { return performance.now() / 1000; }

  // --- 칸막이 벽 ---
  function addWallSegmentsX(y, x0, x1, h, gaps) {
    // y = const 를 따라 x 방향으로 뻗은 벽 (보이는 면: +y)
    for (let x = x0; x < x1; x += 1) {
      const b = Math.min(x + 1, x1);
      for (const [g0, g1] of splitByGaps(x, b, gaps)) {
        add(g0 + 0.5 + y + 0.01, () => {
          faceY(g0, g1, y, 0, h, col(T.wall.partition, 0.92));
          faceY(g0, g1, y + 0.001, 0, 0.1, col(T.wall.skirt, 0.95));
          poly([[g0, y - WALL_T, h], [g1, y - WALL_T, h], [g1, y, h], [g0, y, h]], col(T.wall.partitionCap));
          if (gaps.some(([s]) => Math.abs(g1 - s) < 0.001)) faceX(g1, y - WALL_T, y, 0, h, col(T.wall.partition, 0.76));
        });
      }
    }
  }

  function addWallSegmentsY(x, y0, y1, h, gaps) {
    // x = const 를 따라 y 방향으로 뻗은 벽 (보이는 면: +x)
    for (let y = y0; y < y1; y += 1) {
      const b = Math.min(y + 1, y1);
      for (const [g0, g1] of splitByGaps(y, b, gaps)) {
        add(x + g0 + 0.5 + 0.01, () => {
          faceX(x, g0, g1, 0, h, col(T.wall.partition, 0.8));
          faceX(x + 0.001, g0, g1, 0, 0.1, col(T.wall.skirt, 0.82));
          poly([[x - WALL_T, g0, h], [x, g0, h], [x, g1, h], [x - WALL_T, g1, h]], col(T.wall.partitionCap));
          if (Math.abs(g1 - y1) < 0.001) faceY(x - WALL_T, x, g1, 0, h, col(T.wall.partition, 0.92));
        });
      }
    }
  }

  function splitByGaps(a, b, gaps) {
    let parts = [[a, b]];
    for (const [s, e] of gaps) {
      const next = [];
      for (const [p0, p1] of parts) {
        if (e <= p0 || s >= p1) { next.push([p0, p1]); continue; }
        if (s > p0) next.push([p0, s]);
        if (e < p1) next.push([e, p1]);
      }
      parts = next;
    }
    return parts.filter(([p0, p1]) => p1 - p0 > 0.02);
  }

  // --- 소품 ---
  function addPlant(x, y, size = 1) {
    const p = 0.22 * size;
    foot(x - p, y - p, p * 2, p * 2, 0.8);
    add(x + y, () => {
      box(x - p, y - p, p * 2, p * 2, 0.34 * size, T.pot, 0, { edge: false });
      box(x - p - 0.03, y - p - 0.03, p * 2 + 0.06, p * 2 + 0.06, 0.06, T.pot, 0.32 * size, { edge: false });
      poly([[x - p + 0.02, y - p + 0.02, 0.385 * size], [x + p - 0.02, y - p + 0.02, 0.385 * size], [x + p - 0.02, y + p - 0.02, 0.385 * size], [x - p + 0.02, y + p - 0.02, 0.385 * size]], col('#5b3a26'));
      blob(x + 0.1, y - 0.12, 0.72 * size, 10 * size, col(T.leaf[0]));
      blob(x - 0.16, y + 0.08, 0.66 * size, 9 * size, col(T.leaf[1]));
      blob(x + 0.06, y + 0.12, 0.98 * size, 8.5 * size, col(T.leaf[1]));
      blob(x - 0.06, y - 0.04, 1.12 * size, 7 * size, col(T.leaf[2]));
      blob(x - 0.1, y - 0.1, 1.24 * size, 3.2 * size, col(T.leaf[3]));
    });
  }

  function addTree(x, y, size = 1) {
    treeSpots.push([x, y, size]);
    add(x + y, () => {
      box(x - 0.1, y - 0.1, 0.2, 0.2, 1.0 * size - GRASS_Z, '#7a4e2d', GRASS_Z, { edge: false });
      blob(x + 0.2, y + 0.2, 1.25 * size, 21 * size, col(T.leaf[0], 0.82));
      blob(x, y, 1.45 * size, 22 * size, col(T.leaf[0]));
      blob(x - 0.3, y + 0.25, 1.2 * size, 15 * size, col(T.leaf[1]));
      blob(x + 0.2, y - 0.2, 1.85 * size, 14 * size, col(T.leaf[2]));
      blob(x - 0.15, y - 0.3, 2.0 * size, 6 * size, col(T.leaf[3]));
    });
  }

  function addBush(x, y, size = 1) {
    treeSpots.push([x, y, size * 0.5]);
    add(x + y, () => {
      blob(x + 0.1, y + 0.1, 0.25 * size, 11 * size, col(T.leaf[0]));
      blob(x - 0.15, y, 0.32 * size, 10 * size, col(T.leaf[1]));
      blob(x - 0.05, y - 0.1, 0.45 * size, 6 * size, col(T.leaf[2]));
    });
  }

  // 사무용 의자: back 'n' = 등받이가 y 작은 쪽(앉은 사람이 +y를 봄), 's' = y 큰 쪽
  function addChair(x, y, color, back = 's') {
    foot(x + 0.04, y + 0.04, 0.42, 0.42, 0.7);
    add(x + y + 0.3, () => {
      box(x + 0.1, y + 0.1, 0.3, 0.3, 0.04, T.metal.mid, 0.02, { edge: false });
      box(x + 0.21, y + 0.21, 0.08, 0.08, 0.3, T.metal.dark, 0.04, { edge: false });
      if (back === 'n') box(x + 0.04, y - 0.01, 0.42, 0.09, 0.42, color, 0.42);
      box(x + 0.02, y + 0.02, 0.46, 0.46, 0.1, color, 0.32);
      if (back === 's') box(x + 0.04, y + 0.42, 0.42, 0.09, 0.42, color, 0.42);
    });
  }

  // 판 다리 책상: 양옆 판 + 뒤 가림판 + 상판
  function addDesk(x, y, w, d, top, key, leg = T.metal.light) {
    foot(x, y, w, d, 1);
    add(key, () => {
      box(x + 0.08, y + 0.04, w - 0.16, 0.05, 0.3, leg, 0.12, { edge: false });
      box(x + 0.02, y + 0.02, 0.07, d - 0.04, 0.44, leg, 0, { edge: false });
      box(x + w - 0.09, y + 0.02, 0.07, d - 0.04, 0.44, leg, 0, { edge: false });
      box(x, y, w, d, 0.06, top, 0.44);
    });
  }

  // 모니터: 방에 일이 있으면 화면이 켜지고 코드 줄이 흐름
  function addMonitor(x, y, room, glow) {
    add(x + y + 0.45, () => {
      box(x + 0.26, y + 0.02, 0.28, 0.16, 0.02, T.metal.dark, 0.5, { edge: false });
      box(x + 0.36, y + 0.06, 0.08, 0.06, 0.22, T.metal.dark, 0.5, { edge: false });
      box(x, y, 0.8, 0.07, 0.5, T.screen.frame, 0.68, { edge: false });
      faceY(x + 0.05, x + 0.75, y + 0.071, 0.72, 1.14, col(T.screen.off));
      const lv = roomLight[room] || 0;
      if (lv < 0.03) return;
      ctx.save();
      ctx.globalAlpha = lv;
      // 켜진 화면은 밤에도 색을 유지 (발광체)
      faceY(x + 0.05, x + 0.75, y + 0.072, 0.72, 1.14, glow);
      const t = now();
      const sh = Math.floor(t * 2.2 + x * 3) % 6;
      for (let i = 0; i < 4; i++) {
        const len = 0.18 + hash(i + sh + Math.floor(x * 7)) * 0.4;
        const z = 1.06 - i * 0.085;
        const ind = (i + sh) % 3 === 0 ? 0.08 : 0;
        faceY(x + 0.1 + ind, x + 0.1 + ind + len, y + 0.073, z - 0.03, z, 'rgba(255,255,255,0.75)');
      }
      ctx.restore();
    }, true);
  }

  function addBookshelf(sx, sy, i) {
    foot(sx, sy, 2.2, 0.62, 1.2);
    add(sx + 0.15 + 1.2, () => {
      box(sx, sy, 2.2, 0.62, 2.2, T.wood.mid);
      const fy = sy + 0.62;
      for (let shelf = 0; shelf < 4; shelf++) {
        const z0 = 0.14 + shelf * 0.52;
        faceY(sx + 0.08, sx + 2.12, fy, z0, z0 + 0.44, col(T.wood.dark, 0.72));
        faceY(sx + 0.08, sx + 2.12, fy + 0.0005, z0 + 0.38, z0 + 0.44, col(T.wood.dark, 0.55));
        let bx = sx + 0.12;
        let n = i * 50 + shelf * 13;
        while (bx < sx + 2.02) {
          const w = 0.09 + hash(n) * 0.08;
          const hgt = 0.26 + hash(n + 7) * 0.12;
          const c = T.books[Math.floor(hash(n + 3) * T.books.length)];
          const x1 = Math.min(bx + w, sx + 2.06);
          faceY(bx, x1, fy + 0.001, z0, z0 + hgt, col(c));
          faceY(bx, x1, fy + 0.0015, z0 + hgt * 0.62, z0 + hgt * 0.7, col(c, 1.25));
          bx += w + 0.012;
          n++;
          if (hash(n + 11) > 0.86) bx += 0.18; // 군데군데 빈칸
        }
      }
    });
  }

  function buildScene() {
    sceneItems.length = 0;
    footShadows.length = 0;
    treeSpots.length = 0;
    const W = WORLD.w;
    const D = WORLD.d;
    const hall0 = WORLD.hallY0;
    const hall1 = WORLD.hallY1;

    // 칸막이 벽 (방 사이)
    addWallSegmentsY(8, 0, hall0, LOW_WALL_H, []);
    addWallSegmentsY(17, 0, hall0, LOW_WALL_H, []);
    addWallSegmentsY(4, hall1, D, LOW_WALL_H, []);
    addWallSegmentsY(11, hall1, D, LOW_WALL_H, []);
    addWallSegmentsY(19, hall1, D, LOW_WALL_H, []);

    // 복도 벽 (문 자리 비움)
    addWallSegmentsX(hall0, 0, W, LOW_WALL_H, doorGaps('back'));
    addWallSegmentsX(hall1, 0, W, LOW_WALL_H, doorGaps('front'));

    // --- 자료실 ---
    for (let i = 0; i < 3; i++) addBookshelf(0.5 + i * 2.45, 0.15, i);
    foot(2.3, 3.4, 3.4, 1.3);
    add(2.4 + 3.6 + 1, () => {
      for (const [lx, ly] of [[2.4, 3.5], [5.5, 3.5], [2.4, 4.5], [5.5, 4.5]]) box(lx, ly, 0.1, 0.1, 0.44, T.wood.dark, 0, { edge: false });
      box(2.3, 3.4, 3.4, 1.3, 0.07, T.wood.top, 0.44);
      // 펼친 책과 책 더미
      box(3.0, 3.8, 0.5, 0.36, 0.02, '#f8f4ea', 0.51, { edge: false });
      box(4.6, 3.7, 0.4, 0.3, 0.06, '#3f6fb5', 0.51, { edge: false });
      box(4.62, 3.72, 0.36, 0.28, 0.05, '#c0504d', 0.57, { edge: false });
    });
    addChair(2.8, 2.75, '#b5734a', 'n');
    addChair(4.5, 2.75, '#b5734a', 'n');
    addPlant(7.3, 0.7);
    addPlant(0.6, 6.3, 0.9);

    // --- 개발실 ---
    for (const dx of [9, 13.3]) {
      addDesk(dx, 1.0, 3.1, 1.1, '#f1f4f9', dx + 1.0 + 1.6);
      addMonitor(dx + 0.35, 1.1, 'dev', Math.sin(dx) > 0 ? '#3b82f6' : '#2563eb');
      addMonitor(dx + 1.55, 1.1, 'dev', '#0ea5a4');
      add(dx + 2.0 + 1.6, () => {
        box(dx + 0.5, 1.75, 0.6, 0.18, 0.02, '#cbd2de', 0.5, { edge: false });
        box(dx + 1.7, 1.75, 0.6, 0.18, 0.02, '#cbd2de', 0.5, { edge: false });
        box(dx + 2.6, 1.3, 0.12, 0.12, 0.12, '#f8fafc', 0.5, { edge: false }); // 머그컵
      });
      addChair(dx + 0.55, 2.45, '#4f6bed');
      addChair(dx + 1.85, 2.45, '#4f6bed');
    }
    addPlant(16.4, 6.3, 0.9);
    addPlant(8.6, 6.3, 0.8);

    // --- 서버실 ---
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 5; i++) {
        const rx = 17.7 + i * 1.25;
        const ry = row === 0 ? 0.35 : 4.6;
        foot(rx, ry, 1.05, 1.0, 1.2);
        add(rx + ry + 1.0, () => {
          box(rx, ry, 1.05, 1.0, 2.1, '#2b3142');
          const fy = ry + 1.0;
          faceY(rx + 0.05, rx + 1.0, fy + 0.0005, 0.08, 2.04, col('#353c50'));
          const t = now();
          const busy = (roomLight.server || 0) > 0.3;
          for (let u = 0; u < 7; u++) {
            const z = 0.22 + u * 0.26;
            faceY(rx + 0.1, rx + 0.95, fy + 0.001, z, z + 0.18, col('#1b2030'));
            faceY(rx + 0.45, rx + 0.9, fy + 0.0015, z + 0.07, z + 0.1, col('#2c3448'));
            const on = hash(i * 31 + u * 7 + row * 97 + Math.floor(t * (busy ? 6 : 1.5))) > 0.45;
            const led = on ? (u % 3 === 0 ? '#fbbf24' : (busy && u % 4 === 1 ? '#38bdf8' : '#4ade80')) : '#14532d';
            faceY(rx + 0.15, rx + 0.24, fy + 0.002, z + 0.06, z + 0.12, on ? led : col(led));
            faceY(rx + 0.28, rx + 0.37, fy + 0.002, z + 0.06, z + 0.12, on && u % 2 ? '#4ade80' : col('#14532d'));
          }
        }, true);
      }
    }
    foot(24.6, 5.4, 0.95, 0.8);
    add(24.6 + 5.4 + 0.5, () => {
      box(24.6, 5.4, 0.95, 0.8, 1.55, '#d64545');
      faceY(24.7, 25.35, 6.201, 0.7, 1.4, isNight ? '#fde7c4' : col('#f8d7a8'));
      faceY(25.4, 25.5, 6.201, 0.8, 1.2, col('#1f2937'));
      faceY(24.7, 25.35, 6.202, 0.2, 0.4, col('#7f1d1d'));
    });

    // --- 엘리베이터 로비 (문은 drawElevator) ---
    addPlant(3.4, 17.3, 0.9);
    foot(2.4, 14.6, 1.2, 0.45);
    add(2.6 + 15.2, () => {
      box(2.45, 14.65, 0.08, 0.35, 0.3, T.metal.mid, 0, { edge: false });
      box(3.47, 14.65, 0.08, 0.35, 0.3, T.metal.mid, 0, { edge: false });
      box(2.4, 14.6, 1.2, 0.45, 0.08, T.wood.light, 0.3);
    });

    // --- 정보검색실 ---
    addDesk(5, 10.4, 4.4, 1.1, '#eef7f2', 5 + 10.4 + 2.5);
    addMonitor(5.4, 10.5, 'research', '#10b981');
    addMonitor(6.7, 10.5, 'research', '#8b5cf6');
    addMonitor(8.0, 10.5, 'research', '#3b82f6');
    addChair(6.1, 11.8, '#2f9e7a');
    addChair(7.8, 11.8, '#2f9e7a');
    foot(9.7, 10.3, 0.6, 0.6);
    add(10 + 10.6, () => {
      box(9.7, 10.3, 0.6, 0.6, 0.3, T.wood.mid);
      box(9.96, 10.56, 0.08, 0.08, 0.5, '#94a3b8', 0.3, { edge: false });
      const t = now();
      blob(10.0, 10.6, 1.12, 10, col('#3b82f6'));
      const [sx, sy] = iso(10.0, 10.6, 1.12);
      ctx.fillStyle = col('#4ade80');
      ctx.beginPath();
      ctx.ellipse(sx + Math.sin(t) * 3, sy - 2, 4, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.arc(sx - 3.5, sy - 4, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }, true);
    addPlant(4.7, 17.2, 0.9);
    addPlant(10.4, 17.2, 0.8);

    // --- 회의실 ---
    foot(12.6, 12.0, 4.8, 1.6, 1.1);
    add(12.6 + 12.0 + 3.2, () => {
      box(13.4, 12.6, 0.3, 0.3, 0.44, T.metal.mid, 0, { edge: false });
      box(16.3, 12.6, 0.3, 0.3, 0.44, T.metal.mid, 0, { edge: false });
      box(12.6, 12.0, 4.8, 1.6, 0.07, '#fbfaff', 0.44);
      box(13.2, 12.4, 0.55, 0.38, 0.02, '#cbd5e1', 0.51, { edge: false });   // 노트북
      box(14.6, 12.9, 0.4, 0.3, 0.01, '#ffffff', 0.51, { edge: false });    // 서류
      box(16.0, 12.3, 0.12, 0.12, 0.12, '#f59e0b', 0.51, { edge: false });  // 컵
    });
    for (const cx of [13.0, 14.5, 16.0]) {
      addChair(cx, 11.25, '#7c5cdb', 'n');
      addChair(cx, 13.85, '#7c5cdb', 's');
    }
    add(18.5 + 11.5 + 0.1, () => {
      box(18.45, 10.2, 0.14, 2.8, 1.75, '#f8fafc', 0.15);
      faceX(18.591, 10.25, 12.95, 0.15, 0.22, col('#cbd5e1'));
      const lines = [['#ef4444', 0.6, 11.4], ['#3b82f6', 0.95, 12.2], ['#10b981', 1.3, 11.0]];
      for (const [c, z, e] of lines) faceX(18.592, 10.5, e, z + 0.15, z + 0.2, col(c));
      faceX(18.592, 12.0, 12.6, 1.2, 1.6, col('#fde68a'));
    });
    addPlant(11.6, 17.3, 0.9);

    // --- 내 자리 ---
    addDesk(20.5, 10.3, 3.2, 1.1, T.wood.top, 20.5 + 10.3 + 2.2, T.wood.mid);
    addMonitor(21.3, 10.4, 'user_desk', '#f59e0b');
    add(23.2 + 10.5 + 0.6, () => {
      box(23.1, 10.4, 0.22, 0.22, 0.03, '#334155', 0.5, { edge: false });
      box(23.17, 10.47, 0.08, 0.08, 0.55, '#334155', 0.5, { edge: false });
      box(22.95, 10.35, 0.5, 0.35, 0.2, '#f59e0b', 1.0);
      if (isNight || (roomLight.user_desk || 0) > 0.1) {
        const [lx, ly] = iso(23.2, 10.55, 0.98);
        ctx.fillStyle = 'rgba(255, 214, 140, 0.9)';
        ctx.beginPath();
        ctx.ellipse(lx, ly, 6, 2.6, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }, true);
    addChair(21.6, 11.55, '#e8853a');
    foot(22.8, 15.45, 2.5, 1.1);
    add(22.8 + 15.45 + 1.4, () => {
      box(22.8, 15.45, 2.5, 0.3, 0.9, '#d9677a');
      box(22.8, 15.7, 2.5, 0.85, 0.4, '#e98c9b');
      box(22.85, 15.75, 1.18, 0.7, 0.1, '#f2a5b1', 0.4, { edge: false });
      box(24.07, 15.75, 1.18, 0.7, 0.1, '#f2a5b1', 0.4, { edge: false });
      box(22.65, 15.45, 0.18, 1.1, 0.62, '#cf5d70');
      box(25.3, 15.45, 0.18, 1.1, 0.62, '#cf5d70');
      box(23.1, 15.5, 0.45, 0.16, 0.35, '#fde68a', 0.5, { edge: false }); // 쿠션
    });
    foot(23.3, 14.0, 1.5, 0.75);
    add(23.3 + 14.0 + 1, () => {
      box(23.35, 14.05, 0.08, 0.08, 0.3, T.wood.dark, 0, { edge: false });
      box(24.67, 14.62, 0.08, 0.08, 0.3, T.wood.dark, 0, { edge: false });
      box(23.3, 14.0, 1.5, 0.75, 0.06, T.wood.light, 0.3);
      box(23.6, 14.2, 0.14, 0.14, 0.12, '#ffffff', 0.36, { edge: false });
    });
    addPlant(25.4, 9.7, 1);
    addPlant(19.6, 17.3, 0.85);

    // --- 복도 화분 ---
    addPlant(0.6, 8.0, 0.8);
    addPlant(25.4, 8.0, 0.8);

    // --- 바깥 나무/덤불 ---
    addTree(27.6, 2.2, 1.0);
    addTree(27.8, 9.8, 0.85);
    addTree(27.4, 15.8, 1.1);
    addTree(6.2, 19.8, 0.95);
    addTree(14.5, 19.6, 0.8);
    addTree(21.8, 19.9, 1.05);
    addTree(-0.6, 19.6, 0.8);
    addBush(27.3, 6.0, 1);
    addBush(27.5, 12.6, 0.9);
    addBush(10.2, 19.3, 1);
    addBush(18.0, 19.4, 0.9);
    addBush(2.8, 19.4, 0.8);
    addBush(25.6, 19.3, 0.9);

    sceneItems.sort((a, b) => a.key - b.key);
    // 각 항목의 화면 영역을 한 번 측정 (가림 판정용)
    const main = ctx;
    ctx = document.createElement('canvas').getContext('2d');
    dynItems.length = 0;
    for (const it of sceneItems) {
      measureBox = [Infinity, Infinity, -Infinity, -Infinity];
      it.draw();
      it.bb = measureBox;
      if (it.dyn) dynItems.push(it);
    }
    measureBox = null;
    ctx = main;
  }

  function doorGaps(row) {
    const ids = row === 'back' ? ['archive', 'dev', 'server'] : ['elevator', 'research', 'meeting', 'user_desk'];
    return ids.map(id => [ROOM_DEFS[id].doorX - 0.95, ROOM_DEFS[id].doorX + 0.95]);
  }

  // ----------------------------------------------------
  // 정적 바닥 레이어 (오프스크린에 구워 두고 매 프레임 복사)
  // ----------------------------------------------------
  const ISLAND_M = 1.8;
  const ISLAND_DEPTH = 1.25;

  function drawIsland() {
    const m = ISLAND_M;
    const x0 = -m, y0 = -m, x1 = WORLD.w + m, y1 = WORLD.d + m;
    const z = GRASS_Z;
    const zb = z - ISLAND_DEPTH;

    // 건물 아래 고이는 인디고/시안 빛 (안에서 빛나며 떠 있는 느낌)
    ctx.save();
    planeFloor(zb - 0.6);
    const cx = (x0 + x1) / 2 + 0.8, cy = (y0 + y1) / 2 + 0.8;
    const rad = (x1 - x0) * 0.78;
    ctx.translate(cx, cy);
    ctx.scale(1, (y1 - y0) / (x1 - x0));
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
    g.addColorStop(0, T.backdrop.poolA);
    g.addColorStop(0.45, T.backdrop.poolB);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.fillRect(-rad, -rad, rad * 2, rad * 2);
    ctx.restore();

    // 옆면: 잔디 띠 → 흙 층
    ctx.save();
    planeWallX(x1);
    ctx.fillStyle = col(T.soil.a, 0.8); ctx.fillRect(y0, zb, y1 - y0, ISLAND_DEPTH);
    ctx.fillStyle = col(T.soil.b, 0.8); ctx.fillRect(y0, zb, y1 - y0, ISLAND_DEPTH * 0.45);
    ctx.fillStyle = col(T.soil.strata, 0.8); ctx.fillRect(y0, zb + ISLAND_DEPTH * 0.55, y1 - y0, 0.05);
    ctx.fillStyle = col(T.soil.c, 0.8); ctx.fillRect(y0, zb, y1 - y0, 0.12);
    ctx.fillStyle = col(T.grass.sideR); ctx.fillRect(y0, z - 0.24, y1 - y0, 0.24);
    ctx.restore();
    ctx.save();
    planeWallY(y1);
    ctx.fillStyle = col(T.soil.a); ctx.fillRect(x0, zb, x1 - x0, ISLAND_DEPTH);
    ctx.fillStyle = col(T.soil.b); ctx.fillRect(x0, zb, x1 - x0, ISLAND_DEPTH * 0.45);
    ctx.fillStyle = col(T.soil.strata); ctx.fillRect(x0, zb + ISLAND_DEPTH * 0.55, x1 - x0, 0.05);
    ctx.fillStyle = col(T.soil.c); ctx.fillRect(x0, zb, x1 - x0, 0.12);
    ctx.fillStyle = col(T.grass.side); ctx.fillRect(x0, z - 0.24, x1 - x0, 0.24);
    // 잔디가 흙 위로 늘어진 자국
    for (let i = 0; i < 46; i++) {
      const px = x0 + (i + hash(i + 900) * 0.6) * (x1 - x0) / 46;
      ctx.fillRect(px, z - 0.24 - 0.1 * hash(i + 950), 0.22, 0.1);
    }
    ctx.restore();

    // 윗면
    ctx.save();
    planeFloor(z);
    ctx.fillStyle = col(T.grass.top);
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.fillStyle = col(T.grass.rim);
    ctx.fillRect(x0, y1 - 0.1, x1 - x0, 0.1);
    ctx.fillRect(x1 - 0.1, y0, 0.1, y1 - y0);
    // 잔디 얼룩 + 꽃
    for (let i = 0; i < 90; i++) {
      const px = x0 + hash(i + 1200) * (x1 - x0);
      const py = y0 + hash(i + 1300) * (y1 - y0);
      if (px > -0.4 && px < WORLD.w + 0.4 && py > -0.4 && py < WORLD.d + 0.4) continue;
      if (i % 3 === 0) {
        ctx.fillStyle = col(T.grass.flower[i % T.grass.flower.length]);
        ctx.fillRect(px, py, 0.09, 0.09);
      } else {
        ctx.fillStyle = col(T.grass.dot);
        ctx.beginPath();
        ctx.ellipse(px, py, 0.32, 0.22, 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // 나무 그림자 (빛이 왼쪽 위 → 오른쪽 아래로)
    ctx.fillStyle = 'rgba(20, 50, 30, 0.18)';
    for (const [tx, ty, s] of treeSpots) {
      ctx.beginPath();
      ctx.ellipse(tx + 0.35 * s, ty + 0.2 * s, 0.85 * s, 0.6 * s, 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    // 건물 바깥 접지 그림자
    const p = 0.25;
    ctx.fillStyle = 'rgba(20, 40, 30, 0.16)';
    ctx.fillRect(-p, WORLD.d + p, WORLD.w + p * 2 + 0.25, 0.35);
    ctx.fillRect(WORLD.w + p, -p, 0.35, WORLD.d + p * 2);
    ctx.restore();

    // 건물 기단 (잔디보다 살짝 높은 판)
    const bx0 = -0.25, by0 = -0.25, bx1 = WORLD.w + 0.25, by1 = WORLD.d + 0.25;
    poly([[bx1, by0, z], [bx1, by1, z], [bx1, by1, 0], [bx1, by0, 0]], col(T.plinth.sideR));
    poly([[bx0, by1, z], [bx1, by1, z], [bx1, by1, 0], [bx0, by1, 0]], col(T.plinth.side));
    floorRect(bx0, by0, bx1, by1, 0, col(T.plinth.top));

    // 섬 가장자리 림 라이트 (윗면 외곽 + 아래 모서리)
    const rim = (pts, style, lw) => {
      ctx.strokeStyle = style;
      ctx.lineWidth = lw;
      ctx.beginPath();
      pts.forEach((p, i) => { const q = iso(p[0], p[1], p[2]); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
      ctx.stroke();
    };
    rim([[x0, y1, z], [x0, y0, z], [x1, y0, z]], T.backdrop.rimSoft, 2.5);
    rim([[x0, y1, z], [x1, y1, z], [x1, y0, z]], T.backdrop.rim, 1.4);
    rim([[x0, y1, zb], [x1, y1, zb], [x1, y0, zb]], T.backdrop.rimSoft, 2);
    rim([[x1, y1, z], [x1, y1, zb]], T.backdrop.rimSoft, 1.5);
  }

  // 바닥 무늬: 원목 마루 / 카펫 타일 / 이중 바닥(서버실) / 석재
  function drawPattern(r, th) {
    const w = r.x1 - r.x0, d = r.y1 - r.y0;
    ctx.fillStyle = col(th.floor);
    ctx.fillRect(r.x0, r.y0, w, d);
    if (th.pattern === 'wood') {
      for (let row = 0, y = r.y0; y < r.y1 - 0.01; row++, y += 0.5) {
        let x = r.x0 - hash(row + r.x0 * 3) * 1.6;
        let n = 0;
        while (x < r.x1) {
          const len = 1.4 + hash(row * 17 + n + r.x0) * 1.2;
          const xa = Math.max(r.x0, x), xb = Math.min(r.x1, x + len);
          if ((row + n) % 2 === 0) { ctx.fillStyle = col(th.alt); ctx.fillRect(xa, y, xb - xa, 0.5); }
          ctx.fillStyle = col(th.seam, 1, 0.55);
          if (xb < r.x1) ctx.fillRect(xb - 0.015, y, 0.03, 0.5);
          x += len; n++;
        }
        ctx.fillStyle = col(th.seam, 1, 0.7);
        ctx.fillRect(r.x0, y, w, 0.025);
      }
    } else if (th.pattern === 'carpet') {
      ctx.fillStyle = col(th.alt);
      for (let x = r.x0; x < r.x1; x++) {
        for (let y = r.y0; y < r.y1; y++) if ((x + y) % 2 === 0) ctx.fillRect(x, y, 1, 1);
      }
      ctx.fillStyle = col(th.seam, 1, 0.35);
      for (let x = r.x0 + 1; x < r.x1; x++) ctx.fillRect(x - 0.01, r.y0, 0.02, d);
      for (let y = r.y0 + 1; y < r.y1; y++) ctx.fillRect(r.x0, y - 0.01, w, 0.02);
    } else if (th.pattern === 'raised') {
      ctx.fillStyle = col(th.seam);
      for (let x = r.x0 + 1; x < r.x1; x++) ctx.fillRect(x - 0.025, r.y0, 0.05, d);
      for (let y = r.y0 + 1; y < r.y1; y++) ctx.fillRect(r.x0, y - 0.025, w, 0.05);
      ctx.fillStyle = col(th.alt);
      for (let x = r.x0; x < r.x1; x++) {
        for (let y = r.y0; y < r.y1; y++) {
          if (hash(x * 13 + y * 7) < 0.3) {
            for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) ctx.fillRect(x + 0.2 + a * 0.18, y + 0.2 + b * 0.18, 0.07, 0.07);
          }
        }
      }
    } else if (th.pattern === 'stone') {
      ctx.fillStyle = col(th.alt);
      for (let x = r.x0; x < r.x1; x += 2) {
        for (let y = r.y0; y < r.y1; y += 2) if (((x - r.x0) / 2 + (y - r.y0) / 2) % 2 === 1) ctx.fillRect(x, y, 2, 2);
      }
      ctx.fillStyle = col(th.seam);
      for (let x = r.x0 + 2; x < r.x1; x += 2) ctx.fillRect(x - 0.02, r.y0, 0.04, d);
      for (let y = r.y0 + 2; y < r.y1; y += 2) ctx.fillRect(r.x0, y - 0.02, w, 0.04);
    }
  }

  function drawRug(x0, y0, x1, y1, c) {
    ctx.fillStyle = col(c[0]);
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.fillStyle = col(c[1]);
    ctx.fillRect(x0 + 0.12, y0 + 0.12, x1 - x0 - 0.24, y1 - y0 - 0.24);
    ctx.fillStyle = col(c[2], 1, 0.6);
    ctx.fillRect(x0 + 0.3, y0 + 0.3, x1 - x0 - 0.6, 0.05);
    ctx.fillRect(x0 + 0.3, y1 - 0.35, x1 - x0 - 0.6, 0.05);
    ctx.fillRect(x0 + 0.3, y0 + 0.3, 0.05, y1 - y0 - 0.6);
    ctx.fillRect(x1 - 0.35, y0 + 0.3, 0.05, y1 - y0 - 0.6);
  }

  // 벽이 바닥과 만나는 곳의 은은한 그림자 띠 (선형 그라디언트, 평면 좌표)
  function aoStrip(x0, y0, x1, y1, fromX, fromY, toX, toY, a) {
    const g = ctx.createLinearGradient(fromX, fromY, toX, toY);
    g.addColorStop(0, `rgba(30, 34, 60, ${a})`);
    g.addColorStop(1, 'rgba(30, 34, 60, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }

  function drawFloors() {
    const W = WORLD.w, D = WORLD.d, h0 = WORLD.hallY0, h1 = WORLD.hallY1;
    ctx.save();
    planeFloor(0.005);

    // 복도 + 러너
    ctx.fillStyle = col(T.hall.floor);
    ctx.fillRect(0, h0, W, h1 - h0);
    ctx.fillStyle = col(T.hall.alt);
    for (let x = 0; x < W; x += 2) ctx.fillRect(x, h0, 1, h1 - h0);
    for (const key in ROOM_DEFS) {
      const r = ROOM_DEFS[key];
      drawPattern(r, T.rooms[key] || { floor: r.floor, alt: r.floor, seam: r.floor, pattern: 'none' });
    }
    const hm = (h0 + h1) / 2;
    ctx.fillStyle = col(T.hall.runnerEdge);
    ctx.fillRect(0.8, hm - 0.48, W - 1.6, 0.96);
    ctx.fillStyle = col(T.hall.runner);
    ctx.fillRect(0.88, hm - 0.4, W - 1.76, 0.8);
    ctx.fillStyle = col(T.hall.runnerIn, 1, 0.8);
    ctx.fillRect(0.88, hm - 0.27, W - 1.76, 0.04);
    ctx.fillRect(0.88, hm + 0.23, W - 1.76, 0.04);

    // 문턱
    ctx.fillStyle = col(T.hall.threshold);
    for (const [a, b] of doorGaps('back')) ctx.fillRect(a, h0 - WALL_T, b - a, WALL_T + 0.04);
    for (const [a, b] of doorGaps('front')) ctx.fillRect(a, h1 - WALL_T, b - a, WALL_T + 0.04);
    // 문으로 새어 나오는 방 불빛 (복도 쪽)
    const sp = T.backdrop.spill.join(',');
    const sa = isNight ? 0.3 : 0.18;
    for (const [a, b] of doorGaps('back')) {
      const g = ctx.createLinearGradient(0, h0, 0, h0 + 1.0);
      g.addColorStop(0, `rgba(${sp},${sa})`);
      g.addColorStop(1, `rgba(${sp},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(a + 0.1, h0, b - a - 0.2, 1.0);
    }
    for (const [a, b] of doorGaps('front')) {
      const g = ctx.createLinearGradient(0, h1 - WALL_T, 0, h1 - WALL_T - 1.0);
      g.addColorStop(0, `rgba(${sp},${sa})`);
      g.addColorStop(1, `rgba(${sp},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(a + 0.1, h1 - WALL_T - 1.0, b - a - 0.2, 1.0);
    }

    // 러그
    drawRug(1.7, 2.4, 6.3, 5.3, T.rugs.archive);
    drawRug(12.0, 10.8, 18.0, 15.0, T.rugs.meeting);
    drawRug(22.4, 13.6, 25.6, 17.3, T.rugs.user_desk);
    drawRug(5.6, 14.0, 9.6, 16.6, T.rugs.research);

    // 벽 AO: 바깥 뒷벽 (y=0, x=0)
    const A = isNight ? 0.28 : 0.16;
    aoStrip(0, 0, W, 0.7, 0, 0, 0, 0.7, A);
    aoStrip(0, 0, 0.7, D, 0, 0, 0.7, 0, A * 0.8);
    // 칸막이 (양쪽)
    const a2 = A * 0.75;
    for (const [x, ya, yb] of [[8, 0, h0], [17, 0, h0], [4, h1, D], [11, h1, D], [19, h1, D]]) {
      aoStrip(x, ya, x + 0.45, yb, x, 0, x + 0.45, 0, a2);
      aoStrip(x - WALL_T - 0.45, ya, x - WALL_T, yb, x - WALL_T, 0, x - WALL_T - 0.45, 0, a2);
    }
    for (const [y, gaps] of [[h0, doorGaps('back')], [h1, doorGaps('front')]]) {
      for (const [a, b] of splitByGaps(0, W, gaps)) {
        aoStrip(a, y, b, y + 0.45, 0, y, 0, y + 0.45, a2);
        aoStrip(a, y - WALL_T - 0.45, b, y - WALL_T, 0, y - WALL_T, 0, y - WALL_T - 0.45, a2);
      }
    }

    // 가구 접촉 그림자 (오른쪽 아래로 살짝 밀림)
    for (const [x, y, w, d, k] of footShadows) {
      ctx.fillStyle = `rgba(28, 30, 55, ${(isNight ? 0.12 : 0.07) * k})`;
      ctx.fillRect(x - 0.06, y - 0.04, w + 0.22, d + 0.14);
      ctx.fillStyle = `rgba(28, 30, 55, ${(isNight ? 0.16 : 0.1) * k})`;
      ctx.fillRect(x + 0.02, y + 0.02, w + 0.06, d + 0.05);
    }
    ctx.restore();
  }

  // 벽 한 면(평면 좌표 u: 가로, z: 높이)에 페인트 + 징두리 + 걸레받이 + 바닥쪽 AO
  function paintWall(u0, u1, th, shade) {
    const h = BACK_WALL_H;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, col(th.wall, 0.9 * shade));
    g.addColorStop(1, col(th.wall, 1.02 * shade));
    ctx.fillStyle = g;
    ctx.fillRect(u0, 0, u1 - u0, h);
    ctx.fillStyle = col(th.wainscot, shade);
    ctx.fillRect(u0, 0, u1 - u0, 0.85);
    ctx.fillStyle = col(T.wall.rail, shade);
    ctx.fillRect(u0, 0.85, u1 - u0, 0.05);
    ctx.fillStyle = col(T.wall.skirt, shade * 0.95);
    ctx.fillRect(u0, 0, u1 - u0, 0.13);
    const ao = ctx.createLinearGradient(0, 0, 0, 0.5);
    ao.addColorStop(0, 'rgba(30,34,60,0.14)');
    ao.addColorStop(1, 'rgba(30,34,60,0)');
    ctx.fillStyle = ao;
    ctx.fillRect(u0, 0, u1 - u0, 0.5);
  }

  function drawBackWalls() {
    const h = BACK_WALL_H;
    const W = WORLD.w;
    const D = WORLD.d;
    const R = T.rooms;
    const hallTh = { wall: '#efece6', wainscot: '#d6d0c6' };

    // 위쪽(y=0) 벽: 방마다 페인트
    ctx.save();
    planeWallY(0);
    paintWall(0, 8, R.archive, 1);
    paintWall(8, 17, R.dev, 1);
    paintWall(17, W, R.server, 1);
    // 방 경계 기둥
    ctx.fillStyle = col('#ffffff', 0.94);
    for (const x of [8, 17]) ctx.fillRect(x - 0.08, 0, 0.16, h);
    // 창문 (개발실)
    const sky = T.backdrop.window;
    for (const [a, b] of [[9.2, 11.6], [13.6, 16.0]]) {
      ctx.fillStyle = col('#ffffff', 0.92);
      ctx.fillRect(a - 0.06, 1.12, b - a + 0.12, 1.2);
      const g = ctx.createLinearGradient(0, 1.2, 0, 2.25);
      g.addColorStop(0, sky[0]);
      g.addColorStop(1, sky[1]);
      ctx.fillStyle = g;
      ctx.fillRect(a + 0.04, 1.2, b - a - 0.08, 1.04);
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.beginPath();
      ctx.moveTo(a + 0.45, 1.2); ctx.lineTo(a + 0.75, 1.2); ctx.lineTo(a + 0.4, 2.24); ctx.lineTo(a + 0.1, 2.24);
      ctx.fill();
      ctx.fillStyle = col('#ffffff', 0.92);
      ctx.fillRect((a + b) / 2 - 0.03, 1.2, 0.06, 1.04);
      ctx.fillStyle = col('#d9dee8');
      ctx.fillRect(a - 0.12, 1.08, b - a + 0.24, 0.06);
    }
    // 서버실 환기구
    ctx.fillStyle = col('#a9b1c0');
    for (const x of [18.4, 23.6]) for (let i = 0; i < 4; i++) ctx.fillRect(x, 2.28 + i * 0.07, 1.4, 0.03);
    ctx.restore();

    ctx.save();
    planeWallX(0);
    // 왼쪽(x=0) 벽: 평면 u = y 좌표
    paintWall(0, 7, R.archive, 0.84);
    paintWall(7, 9, hallTh, 0.84);
    paintWall(9, D, R.elevator, 0.84);
    ctx.fillStyle = col('#ffffff', 0.8);
    for (const y of [7, 9]) ctx.fillRect(y - 0.08, 0, 0.16, h);
    // 액자 (자료실)
    ctx.fillStyle = col(T.wood.dark, 0.84);
    ctx.fillRect(2.6, 1.15, 1.8, 1.05);
    ctx.fillStyle = col('#bfe0f2', 0.84);
    ctx.fillRect(2.7, 1.25, 1.6, 0.85);
    ctx.fillStyle = col('#7cb87a', 0.84);
    ctx.beginPath(); ctx.moveTo(2.7, 1.25); ctx.lineTo(3.4, 1.75); ctx.lineTo(3.8, 1.5); ctx.lineTo(4.3, 1.85); ctx.lineTo(4.3, 1.25); ctx.fill();
    ctx.fillStyle = col('#fcd34d', 0.84);
    ctx.fillRect(3.85, 1.85, 0.16, 0.16);
    // 시계
    ctx.fillStyle = col('#ffffff', 0.84);
    ctx.beginPath(); ctx.ellipse(5.6, 1.9, 0.32, 0.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col('#334155', 0.84);
    ctx.fillRect(5.585, 1.9, 0.03, 0.2);
    ctx.fillRect(5.6, 1.885, 0.18, 0.03);
    // 게시판 (엘리베이터 로비)
    ctx.fillStyle = col('#b88a5a', 0.84);
    ctx.fillRect(14.6, 1.05, 2.2, 1.1);
    ctx.fillStyle = col('#d9b38a', 0.84);
    ctx.fillRect(14.68, 1.12, 2.04, 0.96);
    const notes = ['#fde68a', '#bfdbfe', '#fecaca', '#bbf7d0', '#fde68a'];
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = col(notes[i], 0.84);
      ctx.fillRect(14.8 + i * 0.38, 1.3 + (i % 2) * 0.35, 0.3, 0.3);
    }
    // 엘리베이터 문틀
    ctx.fillStyle = col('#9aa3b2', 0.84);
    ctx.fillRect(10.7, 0, 2.6, 2.08);
    ctx.fillStyle = col('#4b5563', 0.84);
    ctx.fillRect(10.85, 0, 2.3, 1.92);
    ctx.fillStyle = col('#111827', 0.84);
    ctx.fillRect(11.5, 2.14, 1.0, 0.22);
    ctx.fillStyle = col('#cbd5e1', 0.84);
    ctx.fillRect(13.4, 0.9, 0.16, 0.3);
    ctx.restore();

    // 벽 윗면(캡)과 끝 단면
    poly([[0, -WALL_T, h], [W + WALL_T, -WALL_T, h], [W, 0, h], [0, 0, h]], col(T.wall.cap));
    faceX(W, -WALL_T, 0, 0, h, col(R.server.wall, 0.72));
    poly([[-WALL_T, -WALL_T, h], [0, 0, h], [0, D, h], [-WALL_T, D, h]], col(T.wall.cap, 0.97));
    faceY(-WALL_T, 0, D, 0, h, col(R.elevator.wall, 0.9));
  }

  // 엘리베이터 문 (열림 정도가 변하므로 매 프레임)
  function drawElevator(nowMs) {
    const open = elevatorOpen;
    const half = 1.15 * (1 - open);
    if (half > 0.01) {
      faceX(0.003, 10.85, 10.85 + half, 0, 1.9, col('#c7cfdb'));
      faceX(0.003, 13.15 - half, 13.15, 0, 1.9, col('#b8c1ce'));
      faceX(0.004, 10.85 + half - 0.03, 10.85 + half, 0, 1.9, col('#9aa3b2'));
    }
    const lit = open > 0.05 || Math.floor(nowMs / 600) % 2 === 0;
    faceX(0.004, 11.9, 12.1, 2.18, 2.32, lit ? '#fbbf24' : col('#78350f'));
  }

  // ----------------------------------------------------
  // 캐릭터
  // ----------------------------------------------------
  function outfitFor(ag) {
    const O = T.outfits;
    if (ag.id === 'ops') return O.ops;
    if (ag.id.startsWith('sub_')) return O.sub;
    return ag.engine === 'claude' ? O.claude : O.antigravity;
  }

  function rrPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // 채우고 외곽선 (외곽선은 얇고 반투명 — 진흙 같은 검은 선 대신)
  function fs(fill) {
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.stroke();
  }

  function drawAgent(ag, t) {
    const [sx, sy] = iso(ag.x, ag.y, 0);
    const o = outfitFor(ag);
    const walking = ag.isMoving;
    const phase = ag.animTimer * 9;
    const step = Math.sin(phase);
    // 걷기: 발걸음마다 통통, 정지: 아주 느린 숨쉬기
    const bob = walking ? Math.abs(step) * 1.8 : (Math.sin(ag.animTimer * 2.2) + 1) * 0.45;
    const f = ag.facing;
    const skin = col(T.skin);

    ctx.save();
    ctx.translate(sx, sy);

    // 그림자 (몸이 뜰수록 작게)
    const sh = 1 - bob * 0.05;
    ctx.fillStyle = isNight ? 'rgba(0, 0, 0, 0.34)' : 'rgba(25, 30, 60, 0.22)';
    ctx.beginPath();
    ctx.ellipse(1, 0, 11 * sh, 4.8 * sh, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.scale(1.12, 1.12);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = T.outline;

    // 다리 + 신발
    const legSwing = walking ? step * 2.4 : 0;
    rrPath(-5.2 + legSwing, -11, 4.4, 10, 2); fs(col(o.pants));
    rrPath(0.8 - legSwing, -11, 4.4, 10, 2); fs(col(o.pants, 0.86));
    ctx.beginPath(); ctx.ellipse(-3 + legSwing + f * 0.6, -1, 3, 1.7, 0, 0, Math.PI * 2); fs(col(o.shoes));
    ctx.beginPath(); ctx.ellipse(3 - legSwing + f * 0.6, -1, 3, 1.7, 0, 0, Math.PI * 2); fs(col(o.shoes));

    ctx.translate(0, -bob);
    // 걸을 때 진행 방향으로 살짝 기울임
    if (walking) ctx.rotate(f * 0.06);

    // 팔 (작업 중이면 타자 치듯 움직임) — 뒤쪽 팔 먼저
    const typing = ag.state === 'WORKING' && !walking;
    const armY = typing ? Math.sin(t * 18 + ag.slotIndex) * 1.2 : (walking ? -step * 1.8 : 0);
    rrPath(7, -24 - armY, 4.2, 10.5, 2.1); fs(col(o.shirt, 0.8));
    ctx.beginPath(); ctx.arc(9.1, -13 - armY, 1.9, 0, Math.PI * 2); fs(skin);

    // 몸통 (오른쪽은 그늘)
    rrPath(-8, -26, 16, 16.5, 6); fs(col(o.shirt));
    ctx.save();
    ctx.clip();
    ctx.fillStyle = col(o.shirt, 0.84);
    ctx.fillRect(3.5, -26, 6, 17);
    ctx.fillStyle = col(o.pants, 0.9);
    ctx.fillRect(-8, -12.5, 16, 3);
    ctx.restore();
    rrPath(-8, -26, 16, 16.5, 6); ctx.stroke();
    // 칼라 + 넥타이
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.moveTo(-3.6, -25.6); ctx.lineTo(3.6, -25.6); ctx.lineTo(0, -21.8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = col(o.tie);
    ctx.beginPath(); ctx.moveTo(-1.1, -23.4); ctx.lineTo(1.1, -23.4); ctx.lineTo(1.7, -15.5); ctx.lineTo(0, -13.8); ctx.lineTo(-1.7, -15.5); ctx.closePath(); ctx.fill();

    // 앞쪽 팔
    rrPath(-11.2, -24 + armY, 4.2, 10.5, 2.1); fs(col(o.shirt, 0.95));
    ctx.beginPath(); ctx.arc(-9.1, -13 + armY, 1.9, 0, Math.PI * 2); fs(skin);

    // 머리
    ctx.beginPath(); ctx.arc(0, -35, 10.2, 0, Math.PI * 2); fs(skin);
    // 귀
    ctx.beginPath(); ctx.arc(-f * 9.4, -34, 2.1, 0, Math.PI * 2); fs(skin);
    // 머리카락
    ctx.fillStyle = col(o.hair);
    ctx.beginPath();
    ctx.arc(0, -36.2, 10.6, Math.PI * 1.0, Math.PI * 2.0);
    ctx.quadraticCurveTo(6, -38.5, f * 2, -37.5);
    ctx.quadraticCurveTo(-6, -36, -10.6, -36.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = col(o.hair, 1.35);
    ctx.beginPath(); ctx.ellipse(-3 - f * 1.5, -43.5, 3.2, 1.4, -0.3, 0, Math.PI * 2); ctx.fill();
    // 서브에이전트 모자
    if (o.cap) {
      ctx.fillStyle = col(o.cap);
      ctx.beginPath(); ctx.arc(0, -38.5, 9.8, Math.PI, Math.PI * 2); ctx.closePath(); ctx.fill(); ctx.stroke();
      rrPath(f > 0 ? -1 : -13, -40, 14, 2.8, 1.4); fs(col(o.cap, 0.8));
    }
    // 눈 (깜빡임)
    const ex = f * 1.6;
    const blink = (Math.floor(t * 10 + ag.slotIndex * 7) % 38) === 0;
    ctx.fillStyle = '#1f2937';
    if (blink) {
      ctx.fillRect(-4.4 + ex, -33.4, 2.8, 0.9);
      ctx.fillRect(1.6 + ex, -33.4, 2.8, 0.9);
    } else {
      ctx.beginPath();
      ctx.ellipse(-3 + ex, -33.2, 1.35, 1.8, 0, 0, Math.PI * 2);
      ctx.ellipse(3 + ex, -33.2, 1.35, 1.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-3.1 + ex, -34.4, 0.8, 0.8);
      ctx.fillRect(2.9 + ex, -34.4, 0.8, 0.8);
    }
    // 입 + 볼터치
    ctx.strokeStyle = 'rgba(120, 53, 15, 0.7)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    if (ag.state === 'ERROR') ctx.arc(ex, -27.6, 1.6, Math.PI * 1.15, Math.PI * 1.85);
    else ctx.arc(ex, -30, 1.7, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
    ctx.fillStyle = 'rgba(244, 114, 110, 0.38)';
    ctx.beginPath();
    ctx.ellipse(-5.6 + ex, -30.4, 1.9, 1.2, 0, 0, Math.PI * 2);
    ctx.ellipse(5.6 + ex, -30.4, 1.9, 1.2, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // ----------------------------------------------------
  // 방 조명 (에이전트가 일하는 방이 밝아짐)
  // ----------------------------------------------------
  const roomLight = {};
  let elevatorOpen = 0;
  const LIT_STATES = new Set(['WORKING', 'THINKING', 'ASKING', 'REPORTING', 'PONDERING', 'ERROR']);

  function updateLights(agents, dt) {
    const occupied = new Set();
    let elevatorBusy = false;
    const e = ROOM_DEFS.elevator.spot;
    for (const ag of agents) {
      if (ag.state === 'GONE') continue;
      if (LIT_STATES.has(ag.state)) occupied.add(ag.currentRoom);
      if (Math.hypot(ag.x - e[0], ag.y - e[1]) < 1.6 && (ag.isMoving || ag.state === 'IDLE')) elevatorBusy = true;
    }
    for (const key in ROOM_DEFS) {
      const target = occupied.has(key) ? 1 : 0;
      const cur = roomLight[key] || 0;
      roomLight[key] = cur + (target - cur) * Math.min(1, dt * (target ? 4 : 1.2));
    }
    elevatorOpen += ((elevatorBusy ? 1 : 0) - elevatorOpen) * Math.min(1, dt * 3);
  }

  // 일하는 방 바닥에 방 색 빛 웅덩이 (미리 만든 스프라이트를 바닥 평면으로 찍음, 방 바닥에만 클리핑)
  function drawRoomGlows(t) {
    const breathe = 0.9 + 0.1 * Math.sin(t * 1.6);
    for (const key in ROOM_DEFS) {
      const level = roomLight[key] || 0;
      if (level < 0.02) continue;
      const r = ROOM_DEFS[key];
      const w = r.x1 - r.x0, d = r.y1 - r.y0;
      const rad = Math.max(w, d) * 0.8;
      ctx.save();
      planeFloor(0.02);
      ctx.beginPath();
      ctx.rect(r.x0, r.y0, w, d);
      ctx.clip();
      ctx.globalCompositeOperation = isNight ? 'lighter' : 'source-over';
      ctx.globalAlpha = level * breathe * (isNight ? 0.55 : 0.3);
      ctx.drawImage(glowSprite(r.accent), r.spot[0] - rad, r.spot[1] - rad, rad * 2, rad * 2);
      // 방 테두리 강조선 (안쪽)
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = level * 0.6;
      ctx.fillStyle = r.accent;
      ctx.fillRect(r.x0, r.y1 - 0.06, w, 0.06);
      ctx.fillRect(r.x1 - 0.06, r.y0, 0.06, d);
      ctx.restore();
    }
  }

  // ----------------------------------------------------
  // 카메라 & 캔버스
  // ----------------------------------------------------
  let canvas = null;
  const view = { dpr: 1, cw: 0, ch: 0, fit: 1, zoom: 1, panX: 0, panY: 0, insetTop: 70, insetBottom: 90, insetRight: 60 };
  // 화면 맞춤 기준: 좌우는 건물 모서리, 위는 뒷방 이름표, 아래는 앞방 이름표 (잔디 섬 가장자리는 잘려도 됨)
  const WORLD_BOUNDS = {
    minX: (-WORLD.d - 0.5) * (TW / 2),
    maxX: (WORLD.w + 0.5) * (TW / 2),
    minY: -0.8 * (TH / 2) - (BACK_WALL_H + 1.4) * ZH,
    maxY: (WORLD.w + WORLD.d + 1.6) * (TH / 2) + 0.4 * ZH
  };

  function resize() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.cw = Math.max(1, rect.width);
    view.ch = Math.max(1, rect.height);
    const bw = Math.round(view.cw * view.dpr);
    const bh = Math.round(view.ch * view.dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    // 좌우 모서리는 화면 중간 높이에 있어 우측 도구 버튼과 거의 겹치지 않음 → 가로 여백은 작게
    const compact = view.cw < 700;
    view.insetTop = compact ? 64 : 84;
    view.insetBottom = compact ? 70 : 96;
    view.insetRight = compact ? 16 : 24;
    const availW = view.cw - view.insetRight - 8;
    const availH = view.ch - view.insetTop - view.insetBottom;
    const ww = WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX;
    const wh = WORLD_BOUNDS.maxY - WORLD_BOUNDS.minY;
    view.fit = Math.max(0.2, Math.min(availW / ww, availH / wh));
  }

  function scale() {
    return view.fit * view.zoom;
  }

  function origin() {
    const s = scale();
    const ww = WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX;
    const wh = WORLD_BOUNDS.maxY - WORLD_BOUNDS.minY;
    const availW = view.cw - view.insetRight;
    const availH = view.ch - view.insetTop - view.insetBottom;
    const ox = (availW - ww * s) / 2 - WORLD_BOUNDS.minX * s + view.panX + 8;
    const oy = view.insetTop + (availH - wh * s) / 2 - WORLD_BOUNDS.minY * s + view.panY;
    return [ox, oy];
  }

  function worldToScreen(x, y, z = 0) {
    const [ix, iy] = iso(x, y, z);
    const [ox, oy] = origin();
    const s = scale();
    return [ox + ix * s, oy + iy * s];
  }

  function screenToWorld(px, py) {
    const [ox, oy] = origin();
    const s = scale();
    const ix = (px - ox) / s;
    const iy = (py - oy) / s;
    const a = ix / (TW / 2);  // x - y
    const b = iy / (TH / 2);  // x + y
    return [(a + b) / 2, (b - a) / 2];
  }

  function setZoom(z, anchor) {
    const old = view.zoom;
    view.zoom = Math.max(0.6, Math.min(3, z));
    if (anchor) {
      // 커서 위치를 기준으로 확대/축소
      const [ox, oy] = origin();
      const k = view.zoom / old;
      view.panX += (anchor[0] - ox) * (1 - k);
      view.panY += (anchor[1] - oy) * (1 - k);
    }
  }

  function fitView() {
    view.zoom = 1;
    view.panX = 0;
    view.panY = 0;
  }

  // ----------------------------------------------------
  // 하늘 배경 (화면 좌표)
  // ----------------------------------------------------
  // 다크 컨트롤룸 배경: 화면 크기/모드가 바뀔 때만 오프스크린에 구움
  const backdrop = { canvas: null, key: '' };

  function bakeBackdrop() {
    const w = view.cw, h = view.ch, dpr = view.dpr;
    const c = backdrop.canvas || (backdrop.canvas = document.createElement('canvas'));
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const b = c.getContext('2d');
    b.setTransform(dpr, 0, 0, dpr, 0, 0);
    const B = T.backdrop;
    const cx = w * 0.5, cy = h * 0.52;
    const g = b.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(w, h) * 0.62);
    g.addColorStop(0, isNight ? B.mid : B.center);
    g.addColorStop(0.55, B.mid);
    g.addColorStop(1, B.edge);
    b.fillStyle = g;
    b.fillRect(0, 0, w, h);
    // 점 격자: 가운데는 진하고 가장자리로 갈수록 옅게
    const step = 26;
    for (let y = step / 2; y < h; y += step) {
      for (let x = step / 2; x < w; x += step) {
        const d = Math.hypot((x - cx) / w, (y - cy) / h);
        const a = Math.max(0, 0.16 - d * 0.2);
        if (a < 0.01) continue;
        b.fillStyle = `rgba(150,170,255,${a.toFixed(3)})`;
        b.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
      }
    }
    // 아주 옅은 별빛 (밤에 더 많이)
    const n = isNight ? 70 : 30;
    for (let i = 0; i < n; i++) {
      const r = 0.4 + Math.pow(hash(i + 201), 3) * 1.3;
      b.fillStyle = `rgba(220,228,255,${(0.15 + hash(i + 301) * 0.35).toFixed(2)})`;
      b.fillRect(hash(i + 1) * w, hash(i + 101) * h * 0.7, r, r);
    }
    backdrop.key = `${w}|${h}|${dpr}|${isNight ? 1 : 0}`;
  }

  function drawSky() {
    if (backdrop.key !== `${view.cw}|${view.ch}|${view.dpr}|${isNight ? 1 : 0}`) bakeBackdrop();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(backdrop.canvas, 0, 0);
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  }

  // ----------------------------------------------------
  // 오버레이: 방 이름표, 작업 라벨, 이름표, 말풍선
  // ----------------------------------------------------
  const G = T.glass;
  const FONT = '-apple-system, BlinkMacSystemFont, "Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';

  function pill(x, y, text, opts) {
    ctx.font = `${opts.weight || 700} ${opts.size || 12}px ${FONT}`;
    const tw = ctx.measureText(text).width;
    const padX = opts.padX || 10;
    const h = opts.h || 24;
    const dotW = opts.dot ? 13 : 0;
    const w = tw + padX * 2 + dotW;
    const top = Math.round(y - h / 2);
    // 화면 밖·우측 도구 버튼 아래로 잘리지 않게 가로 위치를 안쪽으로 당김
    // shortcut: 도구 버튼 열(폭 ~56px, 높이 ~360px)을 상수로 가정, 레이아웃이 바뀌면 조정
    const maxRight = view.cw - (top < 360 ? 58 : 6);
    const left = Math.round(Math.max(6, Math.min(maxRight - w, x - w / 2)));
    x = left + w / 2;
    if (opts.shadow) {
      ctx.fillStyle = opts.shadow;
      ctx.beginPath();
      ctx.roundRect(left, top + 3, w, h, h / 2.4);
      ctx.fill();
    }
    ctx.fillStyle = opts.bg;
    ctx.beginPath();
    ctx.roundRect(left, top, w, h, opts.radius ?? h / 2.4);
    ctx.fill();
    if (opts.border) {
      ctx.strokeStyle = opts.border;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (opts.dot) {
      ctx.fillStyle = hexA(opts.dot, 0.3);
      ctx.beginPath();
      ctx.arc(left + padX + 4, top + h / 2, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = opts.dot;
      ctx.beginPath();
      ctx.arc(left + padX + 4, top + h / 2, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = opts.color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, left + padX + dotW, top + h / 2 + 0.5);
    return { left, top, w, h };
  }

  function truncate(text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s + '…';
  }

  function drawRoomLabels(t) {
    const tasks = Office.getProjectTaskStates ? Office.getProjectTaskStates(Office.activeProjectKey) : {};
    const s = scale();
    const small = s < 0.45;
    const tiny = s < 0.34;
    for (const key in ROOM_DEFS) {
      const r = ROOM_DEFS[key];
      const cx = (r.x0 + r.x1) / 2;
      const pos = r.row === 'back'
        ? worldToScreen(cx, 0, BACK_WALL_H + 0.9)
        : worldToScreen(cx, WORLD.d + 1.0, 0);
      const level = roomLight[key] || 0;
      const task = tasks && tasks[key];
      const showTask = task && task.text && task.opacity > 0.05;

      if (level > 0.05) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 4);
        ctx.fillStyle = hexA(r.accent, 0.18 * level * (0.6 + 0.4 * pulse));
        ctx.beginPath();
        ctx.roundRect(pos[0] - 46, pos[1] - 18, 92, 36, 18);
        ctx.fill();
      }
      pill(pos[0], pos[1], r.name, {
        bg: G.bgStrong, color: G.text, weight: 750, size: tiny ? 11.5 : (small ? 12.5 : 13.5), h: tiny ? 21 : (small ? 24 : 28), padX: tiny ? 8 : 11,
        shadow: G.shadow, border: level > 0.05 ? hexA(r.accent, 0.4 + 0.5 * level) : G.border, dot: r.accent
      });
      if (tiny && !showTask) continue;

      ctx.font = `600 ${small ? 11 : 12}px ${FONT}`;
      let sub = r.sub;
      // 이웃 방 이름표와 겹치지 않게 방 폭에 맞춰 자름
      if (showTask) sub = truncate(`${task.prefix || ''}${task.text}`, Math.max(110, Math.min(220, (r.x1 - r.x0) * TW * 0.55 * s)));
      ctx.save();
      if (showTask) ctx.globalAlpha = Math.max(0.35, task.opacity);
      pill(pos[0], pos[1] + (small ? 24 : 27), sub, {
        bg: G.bg,
        color: showTask ? G.text : G.sub,
        size: small ? 11 : 12, weight: 600, h: small ? 20 : 22, padX: 9, radius: 6,
        shadow: G.shadow,
        border: showTask ? hexA(r.accent, 0.7) : G.border
      });
      ctx.restore();
    }
  }

  const BUBBLE_STYLE = {
    think: { accent: '#8b5cf6' },
    ask: { accent: '#f59e0b' },
    error: { accent: '#ef4444' },
    report: { accent: '#10b981' },
    meme: { accent: '#ec4899' },
    work: { accent: '#0ea5e9' }
  };

  function drawAgentOverlay(ag, t) {
    const s = scale();
    const [hx, hy] = worldToScreen(ag.x, ag.y, 0);
    const headY = hy - 44 * s;

    // 이름표
    if (s > 0.36) {
      const label = ag.role;
      pill(hx, hy + 13, label, {
        bg: G.bgStrong, border: G.border, dot: outfitFor(ag).shirt,
        color: G.text, size: 11.5, h: 20, padX: 7, radius: 10
      });
    }

    // 상태 마커 (질문/오류/생각)
    let marker = null;
    if (ag.state === 'ASKING') marker = { text: '?', bg: '#f59e0b' };
    else if (ag.state === 'ERROR') marker = { text: '!', bg: '#ef4444' };
    else if (ag.state === 'THINKING' || ag.state === 'PONDERING') marker = { text: '…', bg: '#8b5cf6' };
    if (marker) {
      const bounce = Math.sin(t * 5) * 2;
      ctx.fillStyle = marker.bg;
      ctx.beginPath();
      ctx.arc(hx + 12 * s, headY - 6 + bounce, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `800 11px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(marker.text, hx + 12 * s, headY - 5.5 + bounce);
    }

    // 말풍선 스택
    let bubbles = ag.speechBubbles;
    if (!bubbles || bubbles.length === 0) return;
    // 작은 화면에서는 질문/오류 말풍선만 표시
    if (s < 0.34) bubbles = bubbles.filter(b => b.type === 'ask' || b.type === 'error');
    if (bubbles.length === 0) return;
    const now = Date.now();
    let y = headY - 14;
    for (let i = bubbles.length - 1; i >= Math.max(0, bubbles.length - 1); i--) {
      const b = bubbles[i];
      const remaining = b.expiresAt - now;
      if (remaining <= 0) continue;
      const alpha = (remaining < 600 ? remaining / 600 : 1) * (i === bubbles.length - 1 ? 1 : 0.75);
      const style = BUBBLE_STYLE[b.type] || BUBBLE_STYLE.work;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `600 12.5px ${FONT}`;
      const text = truncate(b.text, 220);
      const w = ctx.measureText(text).width + 22;
      const h = 26;
      const left = Math.max(6, Math.min(view.cw - w - 6, hx - w / 2));
      const top = y - h;
      ctx.fillStyle = G.shadow;
      ctx.beginPath();
      ctx.roundRect(left, top + 3, w, h, 9);
      ctx.fill();
      ctx.fillStyle = G.bgStrong;
      ctx.beginPath();
      ctx.roundRect(left, top, w, h, 9);
      ctx.fill();
      ctx.strokeStyle = hexA(style.accent, 0.55);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = style.accent;
      ctx.beginPath();
      ctx.roundRect(left + 6, top + 8, 3, h - 16, 1.5);
      ctx.fill();
      if (i === bubbles.length - 1) {
        const tx = Math.max(left + 12, Math.min(left + w - 12, hx));
        ctx.fillStyle = G.bgStrong;
        ctx.beginPath();
        ctx.moveTo(tx - 5, top + h - 0.5);
        ctx.lineTo(tx, top + h + 6);
        ctx.lineTo(tx + 5, top + h - 0.5);
        ctx.fill();
      }
      ctx.fillStyle = G.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, left + 14, top + h / 2 + 0.5);
      ctx.restore();
      y = top - 6;
    }
  }

  // ----------------------------------------------------
  // 렌더
  // ----------------------------------------------------
  const agentScreenPos = [];

  // 정적 레이어 캐시 (배율/밤낮/해상도가 바뀔 때만 다시 구움, 이동(pan)은 복사 위치만 바뀜)
  // - ground: 섬·바닥·뒷벽 (방 조명보다 아래)
  // - objects: 정적 가구/칸막이 (방 조명보다 위)
  const layers = { ground: null, objects: null, key: '' };
  const GROUND_BOUNDS = {
    minX: (-WORLD.d - 2 * ISLAND_M - 4) * (TW / 2),
    maxX: (WORLD.w + 2 * ISLAND_M + 4) * (TW / 2),
    minY: -2 * ISLAND_M * (TH / 2) - (BACK_WALL_H + 0.6) * ZH,
    maxY: (WORLD.w + WORLD.d + 2 * ISLAND_M + 2) * (TH / 2) + (ISLAND_DEPTH + 2.2) * ZH
  };
  const LAYER_MAX_PX = 4096; // 이보다 크면(많이 확대) 캐시 없이 직접 그림

  function drawGroundLayer() {
    drawIsland();
    drawFloors();
    drawBackWalls();
  }

  function drawObjectLayer() {
    for (const it of sceneItems) if (!it.dyn) it.draw();
  }

  function bakeLayer(c, k, fn) {
    c.width = Math.ceil((GROUND_BOUNDS.maxX - GROUND_BOUNDS.minX) * k);
    c.height = Math.ceil((GROUND_BOUNDS.maxY - GROUND_BOUNDS.minY) * k);
    const main = ctx;
    ctx = c.getContext('2d');
    ctx.setTransform(k, 0, 0, k, -GROUND_BOUNDS.minX * k, -GROUND_BOUNDS.minY * k);
    ctx.lineJoin = 'round';
    fn();
    ctx = main;
  }

  function staticLayers(k) {
    const bw = (GROUND_BOUNDS.maxX - GROUND_BOUNDS.minX) * k;
    const bh = (GROUND_BOUNDS.maxY - GROUND_BOUNDS.minY) * k;
    if (bw > LAYER_MAX_PX || bh > LAYER_MAX_PX) return false;
    const key = `${k.toFixed(4)}|${isNight ? 1 : 0}`;
    if (layers.key === key) return true;
    if (!layers.ground) {
      layers.ground = document.createElement('canvas');
      layers.objects = document.createElement('canvas');
    }
    bakeLayer(layers.ground, k, drawGroundLayer);
    bakeLayer(layers.objects, k, drawObjectLayer);
    layers.key = key;
    return true;
  }

  // 방 조명 스프라이트 (색별로 한 번만 만든 방사형 그라디언트)
  const glowSprites = new Map();
  function glowSprite(hex) {
    let c = glowSprites.get(hex);
    if (c) return c;
    const rgb = hexToRgb(hex).join(',');
    c = document.createElement('canvas');
    c.width = c.height = 128;
    const g2 = c.getContext('2d');
    const g = g2.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, `rgba(${rgb},1)`);
    g.addColorStop(0.5, `rgba(${rgb},0.38)`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    g2.fillStyle = g;
    g2.fillRect(0, 0, 128, 128);
    glowSprites.set(hex, c);
    return c;
  }

  // 프레임 단위 재사용 버퍼 (매 프레임 새 배열/클로저를 만들지 않음)
  const drawList = [];
  const frameItems = [];
  const agentEntries = [];
  let lastDraw = 0;
  let pendingDt = 0;
  let lastViewSig = '';

  function overlaps(a, b) {
    return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
  }

  function render(agents, dt) {
    if (!canvas) return;
    pendingDt += dt;
    if (document.hidden) return;
    const t = performance.now() / 1000;
    const list = drawList;
    list.length = 0;
    let moving = false;
    for (const ag of agents) {
      if (ag.state === 'GONE') continue;
      list.push(ag);
      if (ag.isMoving) moving = true;
    }
    // 아무것도 걷지 않고 화면도 그대로면 ~30fps 로 낮춤
    const sig = `${view.panX}|${view.panY}|${view.zoom}|${view.cw}|${view.ch}|${isNight}`;
    if (!moving && sig === lastViewSig && t - lastDraw < 1 / 31) return;
    lastViewSig = sig;
    lastDraw = t;
    const fdt = Math.min(pendingDt, 0.1);
    pendingDt = 0;
    updateLights(list, fdt);
    const nowMs = Date.now();

    drawSky();

    const [ox, oy] = origin();
    const s = scale();
    const k = s * view.dpr;
    const cached = staticLayers(k);
    const lx = Math.round(view.dpr * ox + GROUND_BOUNDS.minX * k);
    const ly = Math.round(view.dpr * oy + GROUND_BOUNDS.minY * k);
    if (cached) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(layers.ground, lx, ly);
    }
    // 캐시 복사 위치(정수 픽셀)에 맞춰 동적 레이어도 같은 원점 사용
    const wx = cached ? lx - GROUND_BOUNDS.minX * k : view.dpr * ox;
    const wy = cached ? ly - GROUND_BOUNDS.minY * k : view.dpr * oy;
    ctx.setTransform(k, 0, 0, k, wx, wy);
    ctx.lineJoin = 'round';
    if (!cached) drawGroundLayer();
    drawRoomGlows(t);
    drawElevator(nowMs);

    if (!cached) {
      // 캐시를 못 쓰는 큰 배율: 전부 직접 그림
      list.sort((a, b) => (a.x + a.y) - (b.x + b.y));
      let j = 0;
      for (const it of sceneItems) {
        while (j < list.length && list[j].x + list[j].y + 0.05 < it.key) drawAgent(list[j++], t);
        it.draw();
      }
      while (j < list.length) drawAgent(list[j++], t);
    } else {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(layers.objects, lx, ly);
      ctx.setTransform(k, 0, 0, k, wx, wy);
      // 동적 항목 + 캐릭터, 그리고 그 앞을 가리는 정적 항목만 깊이 순으로 다시 그림
      frameItems.length = 0;
      for (const it of dynItems) frameItems.push(it);
      for (let i = 0; i < list.length; i++) {
        const ag = list[i];
        let e = agentEntries[i];
        if (!e) e = agentEntries[i] = { key: 0, ag: null, bb: [0, 0, 0, 0] };
        const [ax, ay] = iso(ag.x, ag.y, 0);
        e.key = ag.x + ag.y + 0.05;
        e.ag = ag;
        e.bb[0] = ax - 17; e.bb[1] = ay - 58; e.bb[2] = ax + 17; e.bb[3] = ay + 7;
        frameItems.push(e);
      }
      const nDyn = frameItems.length;
      for (const it of sceneItems) {
        if (it.dyn) continue;
        for (let i = 0; i < nDyn; i++) {
          const d = frameItems[i];
          if (it.key > d.key && overlaps(it.bb, d.bb)) {
            frameItems.push(it);
            break;
          }
        }
      }
      frameItems.sort((a, b) => a.key - b.key);
      for (const it of frameItems) {
        if (it.ag) drawAgent(it.ag, t);
        else it.draw();
      }
    }

    // 오버레이 패스 (화면 좌표)
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    drawRoomLabels(t);
    agentScreenPos.length = 0;
    list.sort((a, b) => (a.x + a.y) - (b.x + b.y));
    for (const ag of list) {
      const [hx, hy] = worldToScreen(ag.x, ag.y, 0);
      agentScreenPos.push({ ag, x: hx, y: hy - 24 * s, r: Math.max(14, 28 * s) });
      drawAgentOverlay(ag, t);
    }
  }

  // ----------------------------------------------------
  // 입력 (클릭, 드래그 이동, 휠 확대)
  // ----------------------------------------------------
  // 클릭 지점 아래 방 찾기: 바닥부터 벽 높이까지 올라가며 검사 (벽/가구를 눌러도 해당 방 선택)
  function hitRoom(px, py) {
    const s = scale();
    for (let z = 0; z <= BACK_WALL_H; z += 0.25) {
      const [wx, wy] = screenToWorld(px, py + z * ZH * s);
      const room = getRoomAt(wx, wy);
      if (room) return room;
    }
    return null;
  }

  function hitAgent(px, py) {
    for (let i = agentScreenPos.length - 1; i >= 0; i--) {
      const a = agentScreenPos[i];
      if (Math.hypot(px - a.x, py - a.y) <= a.r) return a.ag;
    }
    return null;
  }

  function bindInput() {
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, panX: view.panX, panY: view.panY, moved: false };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    });
    canvas.addEventListener('pointermove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      if (drag) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        if (drag.moved) {
          view.panX = drag.panX + dx;
          view.panY = drag.panY + dy;
          canvas.style.cursor = 'grabbing';
        }
        return;
      }
      canvas.style.cursor = (hitAgent(px, py) || hitRoom(px, py)) ? 'pointer' : 'grab';
    });
    let suppressClick = false;
    const end = () => {
      if (!drag) return;
      suppressClick = drag.moved;
      drag = null;
      canvas.style.cursor = 'grab';
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('click', (e) => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const ag = hitAgent(px, py);
      if (ag) {
        ag.sayRandomMeme();
        return;
      }
      const room = hitRoom(px, py);
      if (room && Office.openRoomInspector) Office.openRoomInspector(room.id);
    });
    canvas.addEventListener('pointercancel', () => { drag = null; });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const k = Math.exp(-e.deltaY * 0.0015);
      setZoom(view.zoom * k, [e.clientX - rect.left, e.clientY - rect.top]);
    }, { passive: false });
    canvas.addEventListener('dblclick', fitView);
  }

  // ----------------------------------------------------
  // 공개 API
  // ----------------------------------------------------
  function init(el) {
    canvas = el;
    ctx = canvas.getContext('2d');
    const saved = (() => { try { return localStorage.getItem('agent_office_night'); } catch (e) { return null; } })();
    const hour = new Date().getHours();
    isNight = saved === null ? (hour >= 19 || hour < 7) : saved === '1';
    buildScene();
    resize();
    bindInput();
    new ResizeObserver(() => resize()).observe(canvas);
    window.addEventListener('resize', resize);
  }

  function setNight(on) {
    isNight = Boolean(on);
    colorCache.clear();
    try { localStorage.setItem('agent_office_night', isNight ? '1' : '0'); } catch (e) {}
  }

  Office.Iso = {
    init,
    render,
    resize,
    zoomIn: () => setZoom(view.zoom * 1.2, [view.cw / 2, view.ch / 2]),
    zoomOut: () => setZoom(view.zoom / 1.2, [view.cw / 2, view.ch / 2]),
    fit: fitView,
    toggleNight: () => setNight(!isNight),
    isNight: () => isNight,
    worldToScreen
  };

})(window);
