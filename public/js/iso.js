/**
 * 에이전트 오피스 (Agent Office) - 아이소메트릭 사무실 렌더러 (public/js/iso.js)
 * 평면도(타일 좌표)를 비스듬히 내려다본 3D 사무실로 그린다.
 * - 월드 패스: 섬(잔디/흙) → 바닥 → 뒷벽 → 깊이 정렬된 칸막이/가구/캐릭터
 * - 오버레이 패스: 방 이름표, 작업 라벨, 캐릭터 이름표/말풍선 (화면 좌표에서 선명하게)
 * - 카메라: 화면 맞춤, 확대/축소(휠·버튼), 드래그 이동, 낮/밤 모드
 */

(function(window) {
  'use strict';

  const Office = window.Office = window.Office || {};
  const { ROOM_DEFS, WORLD, getRoomAt } = Office;

  const TW = 64;  // 타일 가로(px, 배율 1)
  const TH = 32;  // 타일 세로
  const ZH = 34;  // 높이 1 단위(px)

  const BACK_WALL_H = 2.7;
  const LOW_WALL_H = 1.0;
  const WALL_T = 0.22;

  function iso(x, y, z = 0) {
    return [(x - y) * (TW / 2), (x + y) * (TH / 2) - z * ZH];
  }

  // ----------------------------------------------------
  // 색상 유틸 (낮/밤 변환 캐시)
  // ----------------------------------------------------
  const NIGHT_TINT = [52, 56, 112];
  const colorCache = new Map();
  let isNight = false;

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // k: 밝기 배율 (면 음영), 밤에는 남색으로 섞고 어둡게
  function col(hex, k = 1, alpha = 1) {
    const key = `${hex}|${k}|${alpha}|${isNight ? 1 : 0}`;
    let v = colorCache.get(key);
    if (v) return v;
    let [r, g, b] = hexToRgb(hex);
    r *= k; g *= k; b *= k;
    if (isNight) {
      r = r * 0.62 + NIGHT_TINT[0] * 0.22;
      g = g * 0.62 + NIGHT_TINT[1] * 0.22;
      b = b * 0.62 + NIGHT_TINT[2] * 0.3;
    }
    r = Math.max(0, Math.min(255, Math.round(r)));
    g = Math.max(0, Math.min(255, Math.round(g)));
    b = Math.max(0, Math.min(255, Math.round(b)));
    v = alpha < 1 ? `rgba(${r},${g},${b},${alpha})` : `rgb(${r},${g},${b})`;
    colorCache.set(key, v);
    return v;
  }

  // ----------------------------------------------------
  // 그리기 기본 도형 (월드 좌표)
  // ----------------------------------------------------
  let ctx = null;

  function poly(points, fill, stroke) {
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const [sx, sy] = iso(points[i][0], points[i][1], points[i][2] || 0);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function floorRect(x0, y0, x1, y1, z, fill, stroke) {
    poly([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], fill, stroke);
  }

  // 상자: 윗면 + 왼쪽 앞면(y 최대) + 오른쪽 앞면(x 최대)
  function box(x, y, w, d, h, base, z0 = 0, opts = {}) {
    const z1 = z0 + h;
    poly([[x + w, y, z0], [x + w, y + d, z0], [x + w, y + d, z1], [x + w, y, z1]], col(opts.right || base, opts.right ? 1 : 0.74));
    poly([[x, y + d, z0], [x + w, y + d, z0], [x + w, y + d, z1], [x, y + d, z1]], col(opts.left || base, opts.left ? 1 : 0.88));
    poly([[x, y, z1], [x + w, y, z1], [x + w, y + d, z1], [x, y + d, z1]], col(opts.top || base, opts.top ? 1 : 1.06));
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
    ctx.beginPath();
    ctx.arc(sx, sy, rPx, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  // ----------------------------------------------------
  // 정적 장면 구성 (깊이 정렬 대상)
  // ----------------------------------------------------
  const sceneItems = []; // { key, draw }

  function add(key, draw) {
    sceneItems.push({ key, draw });
  }

  // 반복 가능한 의사난수 (책 색 등 매 프레임 동일하게)
  function hash(n) {
    const s = Math.sin(n * 127.1) * 43758.5453;
    return s - Math.floor(s);
  }

  const BOOK_COLORS = ['#c0504d', '#4f81bd', '#9bbb59', '#f2c14e', '#8064a2', '#4bacc6', '#e07b39', '#2e7d6b'];

  function addWallSegmentsX(y, x0, x1, h, gaps, base) {
    // y = const 를 따라 x 방향으로 뻗은 벽 (보이는 면: +y)
    for (let x = x0; x < x1; x += 1) {
      const a = x;
      const b = Math.min(x + 1, x1);
      for (const [g0, g1] of splitByGaps(a, b, gaps)) {
        add(g0 + 0.5 + y + 0.01, () => {
          poly([[g0, y, 0], [g1, y, 0], [g1, y, h], [g0, y, h]], col(base, 0.9));
          poly([[g0, y - WALL_T, h], [g1, y - WALL_T, h], [g1, y, h], [g0, y, h]], col('#ffffff', 0.97));
          if (gaps.some(([s, e]) => Math.abs(g1 - s) < 0.001)) {
            faceX(g1, y - WALL_T, y, 0, h, col(base, 0.72));
          }
        });
      }
    }
  }

  function addWallSegmentsY(x, y0, y1, h, gaps, base) {
    // x = const 를 따라 y 방향으로 뻗은 벽 (보이는 면: +x)
    for (let y = y0; y < y1; y += 1) {
      const a = y;
      const b = Math.min(y + 1, y1);
      for (const [g0, g1] of splitByGaps(a, b, gaps)) {
        add(x + g0 + 0.5 + 0.01, () => {
          poly([[x, g0, 0], [x, g1, 0], [x, g1, h], [x, g0, h]], col(base, 0.78));
          poly([[x - WALL_T, g0, h], [x, g0, h], [x, g1, h], [x - WALL_T, g1, h]], col('#ffffff', 0.97));
          if (Math.abs(g1 - y1) < 0.001) {
            faceY(x - WALL_T, x, g1, 0, h, col(base, 0.9));
          }
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

  function addPlant(x, y, size = 1) {
    add(x + y, () => {
      box(x - 0.2 * size, y - 0.2 * size, 0.4 * size, 0.4 * size, 0.35 * size, '#c96f4a');
      blob(x, y, 0.75 * size, 11 * size, col('#3f9b5a'));
      blob(x - 0.15, y + 0.1, 0.62 * size, 8 * size, col('#4fb36a'));
      blob(x + 0.12, y - 0.05, 0.95 * size, 7 * size, col('#5cc277'));
    });
  }

  function addTree(x, y, size = 1) {
    add(x + y, () => {
      box(x - 0.12, y - 0.12, 0.24, 0.24, 0.9 * size, '#7a4e2d');
      blob(x, y, 1.35 * size, 22 * size, col('#2f7d4a'));
      blob(x - 0.3, y + 0.25, 1.05 * size, 16 * size, col('#3b9459'));
      blob(x + 0.25, y - 0.2, 1.7 * size, 14 * size, col('#4aa868'));
    });
  }

  function addChair(x, y, color) {
    add(x + y + 0.3, () => {
      box(x, y, 0.5, 0.5, 0.42, color);
      box(x, y - 0.02, 0.5, 0.1, 0.85, color);
    });
  }

  function addMonitor(x, y, screenFn) {
    add(x + y + 0.45, () => {
      box(x + 0.35, y + 0.08, 0.1, 0.1, 0.25, '#374151', 0.5);
      box(x, y, 0.8, 0.1, 0.5, '#1f2937', 0.72);
      const t = performance.now() / 1000;
      faceY(x + 0.06, x + 0.74, y + 0.1, 0.78, 1.17, screenFn ? screenFn(t) : col('#60a5fa'));
    });
  }

  function buildScene() {
    sceneItems.length = 0;
    const W = WORLD.w;
    const D = WORLD.d;
    const hall0 = WORLD.hallY0;
    const hall1 = WORLD.hallY1;
    const wallBase = '#eef0f6';

    // 칸막이 벽 (방 사이)
    addWallSegmentsY(8, 0, hall0, LOW_WALL_H, [], wallBase);
    addWallSegmentsY(17, 0, hall0, LOW_WALL_H, [], wallBase);
    addWallSegmentsY(4, hall1, D, LOW_WALL_H, [], wallBase);
    addWallSegmentsY(11, hall1, D, LOW_WALL_H, [], wallBase);
    addWallSegmentsY(19, hall1, D, LOW_WALL_H, [], wallBase);

    // 복도 벽 (문 자리 비움)
    const backDoors = ['archive', 'dev', 'server'].map(id => [ROOM_DEFS[id].doorX - 0.95, ROOM_DEFS[id].doorX + 0.95]);
    const frontDoors = ['elevator', 'research', 'meeting', 'user_desk'].map(id => [ROOM_DEFS[id].doorX - 0.95, ROOM_DEFS[id].doorX + 0.95]);
    addWallSegmentsX(hall0, 0, W, LOW_WALL_H, backDoors, wallBase);
    addWallSegmentsX(hall1, 0, W, LOW_WALL_H, frontDoors, wallBase);

    // --- 자료실 ---
    for (let i = 0; i < 3; i++) {
      const sx = 0.5 + i * 2.45;
      add(sx + 0.15 + 1.2, () => {
        box(sx, 0.15, 2.2, 0.62, 2.2, '#8a5a3b');
        const fy = 0.77;
        for (let shelf = 0; shelf < 4; shelf++) {
          const z0 = 0.12 + shelf * 0.52;
          faceY(sx + 0.08, sx + 2.12, fy, z0, z0 + 0.44, col('#5e3b25'));
          let bx = sx + 0.12;
          let n = i * 50 + shelf * 13;
          while (bx < sx + 2.05) {
            const w = 0.1 + hash(n) * 0.08;
            const hgt = 0.3 + hash(n + 7) * 0.12;
            faceY(bx, Math.min(bx + w, sx + 2.06), fy + 0.001, z0, z0 + hgt, col(BOOK_COLORS[Math.floor(hash(n + 3) * BOOK_COLORS.length)]));
            bx += w + 0.015;
            n++;
          }
        }
      });
    }
    add(2.4 + 3.6 + 1, () => box(2.3, 3.4, 3.4, 1.3, 0.5, '#c89b6d'));
    addChair(2.8, 2.75, '#b5734a');
    addChair(4.5, 2.75, '#b5734a');
    addPlant(7.3, 0.7);
    addPlant(0.6, 6.3, 0.9);

    // --- 개발실 ---
    for (const dx of [9, 13.3]) {
      add(dx + 1.0 + 1.6, () => box(dx, 1.0, 3.1, 1.1, 0.5, '#e7ebf3'));
      addMonitor(dx + 0.35, 1.1, (t) => col(Math.sin(t * 2 + dx) > 0 ? '#60a5fa' : '#7cb7fb'));
      addMonitor(dx + 1.55, 1.1, (t) => col(Math.sin(t * 1.3 + dx * 2) > 0.3 ? '#34d399' : '#5eead4'));
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
        add(rx + ry + 1.0, () => {
          box(rx, ry, 1.05, 1.0, 2.1, '#2f3647');
          const t = performance.now() / 1000;
          const busy = (roomLight.server || 0) > 0.3;
          for (let u = 0; u < 7; u++) {
            const z = 0.25 + u * 0.26;
            faceY(rx + 0.08, rx + 0.97, ry + 1.001, z, z + 0.16, col('#1f2533'));
            const on = hash(i * 31 + u * 7 + row * 97 + Math.floor(t * (busy ? 6 : 1.5))) > 0.45;
            const led = on ? (u % 3 === 0 ? '#fbbf24' : '#4ade80') : '#14532d';
            faceY(rx + 0.15, rx + 0.25, ry + 1.002, z + 0.05, z + 0.11, isNight && on ? led : col(led));
          }
        });
      }
    }
    add(24.6 + 5.4 + 0.5, () => {
      box(24.6, 5.4, 0.95, 0.8, 1.55, '#d64545');
      faceY(24.7, 25.35, 6.201, 0.7, 1.4, col('#f8d7a8'));
      faceY(25.4, 25.5, 6.201, 0.8, 1.2, col('#1f2937'));
    });

    // --- 엘리베이터 (뒷벽 x=0에 문, 그리기는 drawBackWalls) ---
    addPlant(3.4, 17.3, 0.9);
    add(2.6 + 15.2, () => box(2.4, 14.6, 1.2, 0.45, 0.4, '#9aa5b8'));

    // --- 정보검색실 ---
    add(5 + 10.4 + 2.5, () => box(5, 10.4, 4.4, 1.1, 0.5, '#e4f2ec'));
    addMonitor(5.4, 10.5, (t) => col(Math.sin(t * 1.7) > 0 ? '#34d399' : '#6ee7b7'));
    addMonitor(6.7, 10.5, (t) => col(Math.sin(t * 2.3 + 1) > -0.2 ? '#a78bfa' : '#c4b5fd'));
    addMonitor(8.0, 10.5, (t) => col(Math.sin(t * 1.1 + 2) > 0 ? '#60a5fa' : '#93c5fd'));
    addChair(6.1, 11.8, '#2f9e7a');
    addChair(7.8, 11.8, '#2f9e7a');
    add(10 + 10.6, () => {
      box(9.95, 10.55, 0.12, 0.12, 0.7, '#475569', 0.3);
      box(9.7, 10.3, 0.6, 0.6, 0.3, '#64748b');
      const t = performance.now() / 1000;
      blob(10.0, 10.6, 1.25, 10, col('#3b82f6'));
      const [sx, sy] = iso(10.0, 10.6, 1.25);
      ctx.fillStyle = col('#4ade80');
      ctx.beginPath();
      ctx.ellipse(sx + Math.sin(t) * 3, sy - 2, 4, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    addPlant(4.7, 17.2, 0.9);

    // --- 회의실 ---
    add(12.6 + 12.0 + 3.2, () => box(12.6, 12.0, 4.8, 1.6, 0.5, '#f4f1fb'));
    for (const cx of [13.0, 14.5, 16.0]) {
      addChair(cx, 11.25, '#7c5cdb');
      add(cx + 13.9 + 0.3, () => box(cx, 13.85, 0.5, 0.5, 0.42, '#7c5cdb'));
    }
    add(18.5 + 11.5 + 0.1, () => {
      box(18.45, 10.2, 0.14, 2.8, 1.75, '#f8fafc', 0.15);
      const lines = [['#ef4444', 0.6], ['#3b82f6', 0.95], ['#10b981', 1.3]];
      for (const [c, z] of lines) faceX(18.591, 10.5, 11.8, z + 0.15, z + 0.2, col(c));
    });
    addPlant(11.6, 17.3, 0.9);

    // --- 내 자리 ---
    add(20.5 + 10.3 + 2.2, () => box(20.5, 10.3, 3.2, 1.1, 0.5, '#d4a373'));
    addMonitor(21.3, 10.4, (t) => col(Math.sin(t * 1.5) > 0 ? '#fbbf24' : '#fcd34d'));
    add(23.2 + 10.5 + 0.6, () => {
      box(23.15, 10.45, 0.12, 0.12, 0.55, '#334155', 0.5);
      box(22.95, 10.35, 0.5, 0.35, 0.18, '#f59e0b', 1.0);
    });
    addChair(21.6, 11.55, '#e8853a');
    add(22.8 + 15.45 + 1.4, () => {
      box(22.8, 15.45, 2.5, 0.28, 0.85, '#e07a8a');
      box(22.8, 15.7, 2.5, 0.85, 0.4, '#e98c9b');
    });
    add(23.3 + 14.0 + 1, () => box(23.3, 14.0, 1.5, 0.75, 0.32, '#c08457'));
    addPlant(25.4, 9.7, 1);
    addPlant(19.6, 17.3, 0.85);

    // --- 복도 화분 ---
    addPlant(0.6, 8.0, 0.8);
    addPlant(25.4, 8.0, 0.8);

    // --- 바깥 나무 ---
    addTree(27.6, 2.2, 1.0);
    addTree(27.8, 9.8, 0.85);
    addTree(27.4, 15.8, 1.1);
    addTree(6.2, 19.8, 0.95);
    addTree(14.5, 19.6, 0.8);
    addTree(21.8, 19.9, 1.05);
    addTree(-0.6, 19.6, 0.8);
  }

  // ----------------------------------------------------
  // 바닥 & 뒷벽 (정렬 없이 먼저 그림)
  // ----------------------------------------------------
  function drawIsland() {
    const m = 1.8;
    const x0 = -m, y0 = -m, x1 = WORLD.w + m, y1 = WORLD.d + m;
    const depth = 1.3;
    // 흙 옆면
    poly([[x1, y0, 0], [x1, y1, 0], [x1, y1, -depth], [x1, y0, -depth]], col('#8a5a3c', 0.8));
    poly([[x0, y1, 0], [x1, y1, 0], [x1, y1, -depth], [x0, y1, -depth]], col('#9c6a47'));
    // 잔디 테두리 띠
    poly([[x1, y0, 0], [x1, y1, 0], [x1, y1, -0.22], [x1, y0, -0.22]], col('#4f8f4f'));
    poly([[x0, y1, 0], [x1, y1, 0], [x1, y1, -0.22], [x0, y1, -0.22]], col('#5ea35c'));
    // 잔디 윗면
    floorRect(x0, y0, x1, y1, 0, col('#6cb06a'));
    // 건물 바닥 받침 (살짝 올라온 기단)
    floorRect(-0.15, -0.15, WORLD.w + 0.15, WORLD.d + 0.15, 0, col('#c9ced9'));
  }

  function drawFloors() {
    // 복도
    floorRect(0, WORLD.hallY0, WORLD.w, WORLD.hallY1, 0.01, col('#f1f2f6'));
    for (const key in ROOM_DEFS) {
      const r = ROOM_DEFS[key];
      floorRect(r.x0, r.y0, r.x1, r.y1, 0.01, col(r.floor));
    }
    // 러그
    floorRect(1.7, 2.4, 6.3, 5.3, 0.012, col('#d9a27e'));
    floorRect(1.95, 2.6, 6.05, 5.1, 0.013, col('#e6b896'));
    floorRect(12.0, 10.8, 18.0, 15.0, 0.012, col('#cbbdf0'));
    floorRect(22.4, 13.6, 25.6, 17.3, 0.012, col('#f5c9a8'));

    // 타일 격자 (아주 은은하게)
    ctx.save();
    ctx.globalAlpha = isNight ? 0.08 : 0.12;
    ctx.strokeStyle = '#8b93a7';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let x = 1; x < WORLD.w; x++) {
      const [ax, ay] = iso(x, 0, 0.015);
      const [bx, by] = iso(x, WORLD.d, 0.015);
      ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
    }
    for (let y = 1; y < WORLD.d; y++) {
      const [ax, ay] = iso(0, y, 0.015);
      const [bx, by] = iso(WORLD.w, y, 0.015);
      ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawBackWalls(now) {
    const h = BACK_WALL_H;
    const W = WORLD.w;
    const D = WORLD.d;
    const base = '#e9ecf3';
    // 위쪽(y=0) 벽
    poly([[0, 0, 0], [W, 0, 0], [W, 0, h], [0, 0, h]], col(base, 0.95));
    poly([[0, -WALL_T, h], [W + WALL_T, -WALL_T, h], [W, 0, h], [0, 0, h]], col('#ffffff'));
    faceX(W, -WALL_T, 0, 0, h, col(base, 0.72));
    // 왼쪽(x=0) 벽
    poly([[0, 0, 0], [0, D, 0], [0, D, h], [0, 0, h]], col(base, 0.8));
    poly([[-WALL_T, -WALL_T, h], [0, 0, h], [0, D, h], [-WALL_T, D, h]], col('#ffffff'));
    faceY(-WALL_T, 0, D, 0, h, col(base, 0.9));
    // 걸레받이
    poly([[0, 0, 0], [W, 0, 0], [W, 0, 0.12], [0, 0, 0.12]], col('#cfd5e1'));
    poly([[0, 0, 0], [0, D, 0], [0, D, 0.12], [0, 0, 0.12]], col('#c3c9d6'));

    // 창문 (개발실/서버실 뒷벽)
    const sky = isNight ? '#1e2a5a' : '#a9d3f5';
    for (const [a, b] of [[9.2, 11.6], [13.6, 16.0], [18.0, 20.4], [22.0, 24.6]]) {
      faceY(a, b, 0.001, 1.2, 2.25, col('#cbd5e1'));
      faceY(a + 0.08, b - 0.08, 0.002, 1.28, 2.17, isNight ? sky : col(sky));
      faceY((a + b) / 2 - 0.03, (a + b) / 2 + 0.03, 0.003, 1.28, 2.17, col('#cbd5e1'));
    }
    // 정보검색실 쪽 왼쪽 벽 대형 스크린은 칸막이가 낮아 생략, 엘리베이터 문
    const e = ROOM_DEFS.elevator;
    const open = elevatorOpen;
    faceX(0.001, 10.7, 13.3, 0, 2.05, col('#9aa3b2'));
    faceX(0.002, 10.85, 13.15, 0, 1.9, col('#4b5563'));
    const half = 1.15 * (1 - open);
    faceX(0.003, 10.85, 10.85 + half, 0, 1.9, col('#c7cfdb'));
    faceX(0.003, 13.15 - half, 13.15, 0, 1.9, col('#b8c1ce'));
    // 층 표시등
    faceX(0.003, 11.5, 12.5, 2.12, 2.35, col('#111827'));
    const lit = open > 0.05 || Math.floor(now / 600) % 2 === 0;
    faceX(0.004, 11.9, 12.1, 2.17, 2.3, lit ? '#fbbf24' : col('#78350f'));
    void e;
  }

  // ----------------------------------------------------
  // 캐릭터
  // ----------------------------------------------------
  const OUTFITS = {
    claude: { shirt: '#d97757', hair: '#5b3a29', pants: '#3f3f56' },
    antigravity: { shirt: '#38a3e8', hair: '#1e293b', pants: '#334155' },
    ops: { shirt: '#8b5cf6', hair: '#374151', pants: '#312e81' },
    sub: { shirt: '#14b8a6', hair: '#7c2d12', pants: '#334155' }
  };

  function outfitFor(ag) {
    if (ag.id === 'ops') return OUTFITS.ops;
    if (ag.id.startsWith('sub_')) return OUTFITS.sub;
    return ag.engine === 'claude' ? OUTFITS.claude : OUTFITS.antigravity;
  }

  function drawAgent(ag, t) {
    const [sx, sy] = iso(ag.x, ag.y, 0);
    const o = outfitFor(ag);
    const walking = ag.isMoving;
    const phase = ag.animTimer * 9;
    const bob = walking ? Math.abs(Math.sin(phase)) * 1.6 : Math.sin(ag.animTimer * 2) * 0.5;
    const f = ag.facing;

    ctx.save();
    ctx.translate(sx, sy);

    // 그림자
    ctx.fillStyle = 'rgba(15, 23, 42, 0.22)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 10, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 다리
    const legSwing = walking ? Math.sin(phase) * 2.6 : 0;
    ctx.fillStyle = col(o.pants);
    roundRect(-5 + legSwing, -10, 4, 10, 1.5);
    roundRect(1 - legSwing, -10, 4, 10, 1.5);

    ctx.translate(0, -bob);

    // 몸통
    ctx.fillStyle = col(o.shirt);
    roundRect(-8, -25, 16, 16, 5);
    ctx.fillStyle = col(o.shirt, 0.82);
    roundRect(-8, -14, 16, 5, 2);

    // 팔 (작업 중이면 타자 치듯 움직임)
    const typing = ag.state === 'WORKING' && !walking;
    const armY = typing ? Math.sin(t * 18 + ag.slotIndex) * 1.2 : (walking ? -Math.sin(phase) * 1.8 : 0);
    ctx.fillStyle = col(o.shirt, 0.9);
    roundRect(-11, -23 + armY, 4, 10, 2);
    roundRect(7, -23 - armY, 4, 10, 2);

    // 머리
    ctx.fillStyle = col('#ffdcbf');
    ctx.beginPath();
    ctx.arc(0, -33, 9, 0, Math.PI * 2);
    ctx.fill();
    // 머리카락
    ctx.fillStyle = col(o.hair);
    ctx.beginPath();
    ctx.arc(0, -35, 9.3, Math.PI * 1.02, Math.PI * 1.98);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-f * 5, -37, 5, 3.4, f * 0.4, 0, Math.PI * 2);
    ctx.fill();
    // 서브에이전트 모자
    if (ag.id.startsWith('sub_')) {
      ctx.fillStyle = col('#0f766e');
      ctx.beginPath();
      ctx.arc(0, -38, 8.6, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(f > 0 ? 0 : -12, -39, 12, 2.5);
    }
    // 눈 (깜빡임)
    const blink = (Math.floor(t * 10 + ag.slotIndex * 7) % 38) === 0;
    ctx.fillStyle = '#1f2937';
    if (blink) {
      ctx.fillRect(-3.5 + f * 1.2, -32.5, 2.4, 0.8);
      ctx.fillRect(1.3 + f * 1.2, -32.5, 2.4, 0.8);
    } else {
      ctx.beginPath();
      ctx.arc(-2.3 + f * 1.2, -32, 1.3, 0, Math.PI * 2);
      ctx.arc(2.5 + f * 1.2, -32, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
    // 볼터치
    ctx.fillStyle = 'rgba(244, 114, 110, 0.35)';
    ctx.beginPath();
    ctx.arc(-5 + f, -29, 1.8, 0, Math.PI * 2);
    ctx.arc(5.5 + f, -29, 1.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
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
    for (const ag of agents) {
      if (ag.state === 'GONE') continue;
      if (LIT_STATES.has(ag.state)) occupied.add(ag.currentRoom);
      const e = ROOM_DEFS.elevator.spot;
      if (Math.hypot(ag.x - e[0], ag.y - e[1]) < 1.6 && (ag.isMoving || ag.state === 'IDLE')) elevatorBusy = true;
    }
    for (const key in ROOM_DEFS) {
      const target = occupied.has(key) ? 1 : 0;
      const cur = roomLight[key] || 0;
      roomLight[key] = cur + (target - cur) * Math.min(1, dt * (target ? 4 : 1.2));
    }
    elevatorOpen += ((elevatorBusy ? 1 : 0) - elevatorOpen) * Math.min(1, dt * 3);
  }

  function drawRoomGlows() {
    ctx.save();
    ctx.globalCompositeOperation = isNight ? 'lighter' : 'source-over';
    for (const key in ROOM_DEFS) {
      const level = roomLight[key] || 0;
      if (level < 0.02) continue;
      const r = ROOM_DEFS[key];
      const cx = (r.x0 + r.x1) / 2;
      const cy = (r.y0 + r.y1) / 2;
      const [sx, sy] = iso(cx, cy, 0.02);
      const rad = Math.max(r.x1 - r.x0, r.y1 - r.y0) * 26;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.scale(1, 0.5);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
      const [cr, cg, cb] = hexToRgb(isNight ? '#ffd58a' : r.accent);
      const a = (isNight ? 0.34 : 0.16) * level;
      g.addColorStop(0, `rgba(${cr},${cg},${cb},${a})`);
      g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // ----------------------------------------------------
  // 카메라 & 캔버스
  // ----------------------------------------------------
  let canvas = null;
  const view = { dpr: 1, cw: 0, ch: 0, fit: 1, zoom: 1, panX: 0, panY: 0, insetTop: 70, insetBottom: 90, insetRight: 60 };
  // 화면 맞춤 기준: 건물 + 앞쪽 방 이름표 (잔디 섬 가장자리는 잘려도 됨)
  const WORLD_BOUNDS = (() => {
    const pts = [];
    for (const [x, y] of [[-0.4, -0.4], [WORLD.w + 0.4, -0.4], [WORLD.w + 0.6, WORLD.d + 1.6], [-0.4, WORLD.d + 1.6]]) {
      pts.push(iso(x, y, -0.4), iso(x, y, BACK_WALL_H + 1.4));
    }
    const xs = pts.map(p => p[0]);
    const ys = pts.map(p => p[1]);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  })();

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
    const compact = view.cw < 700;
    view.insetTop = compact ? 64 : 84;
    view.insetBottom = compact ? 70 : 96;
    view.insetRight = compact ? 52 : 64;
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
  const stars = Array.from({ length: 70 }, (_, i) => ({ x: hash(i + 1), y: hash(i + 101) * 0.75, r: 0.6 + hash(i + 201) * 1.2, p: hash(i + 301) * 6 }));
  const clouds = Array.from({ length: 5 }, (_, i) => ({ x: hash(i + 11), y: 0.08 + hash(i + 21) * 0.35, s: 0.7 + hash(i + 31) * 0.7 }));

  function drawSky(t) {
    const w = view.cw;
    const h = view.ch;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    if (isNight) {
      g.addColorStop(0, '#22265c');
      g.addColorStop(1, '#3a3f8f');
    } else {
      g.addColorStop(0, '#b9d3f6');
      g.addColorStop(1, '#e7eefc');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    if (isNight) {
      for (const s of stars) {
        const a = 0.35 + 0.45 * Math.abs(Math.sin(t * 0.8 + s.p));
        ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      const mx = w * 0.76;
      const my = h * 0.27;
      const mg = ctx.createRadialGradient(mx, my, 4, mx, my, 46);
      mg.addColorStop(0, 'rgba(255,255,255,0.35)');
      mg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = mg;
      ctx.beginPath();
      ctx.arc(mx, my, 46, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e5e7eb';
      ctx.beginPath();
      ctx.arc(mx, my, 17, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(148,163,184,0.35)';
      ctx.beginPath();
      ctx.arc(mx - 5, my - 3, 3.5, 0, Math.PI * 2);
      ctx.arc(mx + 5, my + 5, 2.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      for (const c of clouds) {
        const cx = ((c.x * w + t * 6 * c.s) % (w + 160)) - 80;
        const cy = c.y * h;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 34 * c.s, 11 * c.s, 0, 0, Math.PI * 2);
        ctx.ellipse(cx + 18 * c.s, cy - 7 * c.s, 20 * c.s, 10 * c.s, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      const sx = w * 0.76;
      const sy = h * 0.27;
      const sg = ctx.createRadialGradient(sx, sy, 6, sx, sy, 60);
      sg.addColorStop(0, 'rgba(255,236,170,0.9)');
      sg.addColorStop(1, 'rgba(255,236,170,0)');
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(sx, sy, 60, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ----------------------------------------------------
  // 오버레이: 방 이름표, 작업 라벨, 이름표, 말풍선
  // ----------------------------------------------------
  const FONT = '-apple-system, BlinkMacSystemFont, "Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';

  function pill(x, y, text, opts) {
    ctx.font = `${opts.weight || 700} ${opts.size || 12}px ${FONT}`;
    const tw = ctx.measureText(text).width;
    const padX = opts.padX || 10;
    const h = opts.h || 24;
    const w = tw + padX * 2;
    const left = Math.round(x - w / 2);
    const top = Math.round(y - h / 2);
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
    ctx.fillStyle = opts.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, top + h / 2 + 0.5);
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
        bg: r.accent, color: '#ffffff', size: tiny ? 10 : (small ? 11 : 13), h: tiny ? 18 : (small ? 22 : 26), padX: tiny ? 7 : 12,
        shadow: 'rgba(15,23,42,0.18)'
      });
      if (tiny && !showTask) continue;

      ctx.font = `600 ${small ? 10 : 11}px ${FONT}`;
      let sub = r.sub;
      if (showTask) sub = truncate(`${task.prefix || ''}${task.text}`, 170);
      ctx.save();
      if (showTask) ctx.globalAlpha = Math.max(0.35, task.opacity);
      pill(pos[0], pos[1] + (small ? 21 : 25), sub, {
        bg: showTask ? '#ffffff' : 'rgba(255,255,255,0.92)',
        color: showTask ? '#0f172a' : '#475569',
        size: small ? 10 : 11, weight: 600, h: small ? 18 : 20, padX: 8, radius: 5,
        border: showTask ? hexA(r.accent, 0.9) : 'rgba(148,163,184,0.45)'
      });
      ctx.restore();
    }
  }

  function hexA(hex, a) {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
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
    if (s > 0.42) {
      ctx.font = `700 10.5px ${FONT}`;
      const label = ag.role;
      pill(hx, hy + 12, label, {
        bg: ag.id.startsWith('sub_') ? 'rgba(13,148,136,0.92)' : 'rgba(15,23,42,0.78)',
        color: '#ffffff', size: 10.5, h: 17, padX: 6, radius: 8.5
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
      ctx.font = `600 11.5px ${FONT}`;
      const text = truncate(b.text, 200);
      const w = ctx.measureText(text).width + 22;
      const h = 24;
      const left = Math.max(6, Math.min(view.cw - w - 6, hx - w / 2));
      const top = y - h;
      ctx.fillStyle = 'rgba(15,23,42,0.12)';
      ctx.beginPath();
      ctx.roundRect(left, top + 2, w, h, 9);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
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
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(tx - 5, top + h - 0.5);
        ctx.lineTo(tx, top + h + 6);
        ctx.lineTo(tx + 5, top + h - 0.5);
        ctx.fill();
      }
      ctx.fillStyle = '#1e293b';
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

  function render(agents, dt) {
    if (!canvas) return;
    const t = performance.now() / 1000;
    const now = Date.now();
    const list = [];
    for (const ag of agents) if (ag.state !== 'GONE') list.push(ag);
    updateLights(list, dt);

    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    drawSky(t);

    // 월드 패스
    const [ox, oy] = origin();
    const s = scale();
    ctx.setTransform(view.dpr * s, 0, 0, view.dpr * s, view.dpr * ox, view.dpr * oy);
    ctx.lineJoin = 'round';
    drawIsland();
    drawFloors();
    drawRoomGlows();
    drawBackWalls(now);

    const items = sceneItems.slice();
    for (const ag of list) {
      items.push({ key: ag.x + ag.y + 0.05, draw: () => drawAgent(ag, t) });
    }
    items.sort((a, b) => a.key - b.key);
    for (const it of items) it.draw();

    // 오버레이 패스 (화면 좌표)
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    drawRoomLabels(t);
    agentScreenPos.length = 0;
    const byDepth = list.slice().sort((a, b) => (a.x + a.y) - (b.x + b.y));
    for (const ag of byDepth) {
      const [hx, hy] = worldToScreen(ag.x, ag.y, 0);
      agentScreenPos.push({ ag, x: hx, y: hy - 22 * s, r: Math.max(14, 26 * s) });
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
