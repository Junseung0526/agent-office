/**
 * 에이전트 오피스 (Agent Office) - 팔레트 및 유틸리티 모듈 (public/js/palette.js)
 * 32색 마스터 픽셀 팔레트, 토큰 단가 및 포맷팅, 오프스크린 캔버스 헬퍼
 */

(function(window) {
  'use strict';

  const Office = window.Office = window.Office || {};

  // 공유 상태 초기화 및 전역 접근자 바인딩
  Office.activeProjectKey = null;
  Office.currentProjectTokenUsage = null;
  Office.projectsList = [];
  Office.agentsMap = new Map();

  ['activeProjectKey', 'currentProjectTokenUsage', 'projectsList', 'agentsMap'].forEach(prop => {
    if (!Object.prototype.hasOwnProperty.call(window, prop)) {
      Object.defineProperty(window, prop, {
        get() { return Office[prop]; },
        set(v) { Office[prop] = v; },
        configurable: true
      });
    }
  });

    // ----------------------------------------------------
    // [설정] 세션별 토큰 단가 설정 (1M = 1,000,000 토큰 기준 USD)
    // 기본값은 null(비용 미표시). 모델별 단가를 채워 넣으면 그때만 예상 비용을 자동 계산합니다.
    // ----------------------------------------------------
    const TOKEN_PRICE_CONFIG = {
      default: null,
      'claude-3-7-sonnet': { inputPerM: 3.0, outputPerM: 15.0, cacheReadPerM: 0.3 },
      'claude-3-5-sonnet': { inputPerM: 3.0, outputPerM: 15.0, cacheReadPerM: 0.3 },
      'claude-3-5-haiku':  { inputPerM: 0.8, outputPerM: 4.0,  cacheReadPerM: 0.08 },
      'claude-3-opus':     { inputPerM: 15.0, outputPerM: 75.0, cacheReadPerM: 1.5 },
      'gemini-2.5-pro':    { inputPerM: 1.25, outputPerM: 5.0, cacheReadPerM: 0.3125 },
      'gemini-2.5-flash':  { inputPerM: 0.15, outputPerM: 0.6, cacheReadPerM: 0.0375 },
      'gemini-2.0-flash':  { inputPerM: 0.10, outputPerM: 0.4, cacheReadPerM: 0.025 },
      'gpt-4o':            { inputPerM: 2.5,  outputPerM: 10.0, cacheReadPerM: 1.25 },
      'gpt-4o-mini':       { inputPerM: 0.15, outputPerM: 0.6, cacheReadPerM: 0.075 }
    };

    function calculateEstimatedCost(usage, modelName) {
      if (!usage) return null;
      let price = null;
      if (modelName && TOKEN_PRICE_CONFIG[modelName]) {
        price = TOKEN_PRICE_CONFIG[modelName];
      } else if (modelName) {
        for (const k in TOKEN_PRICE_CONFIG) {
          if (k !== 'default' && TOKEN_PRICE_CONFIG[k] && modelName.includes(k)) {
            price = TOKEN_PRICE_CONFIG[k];
            break;
          }
        }
      }
      if (!price && TOKEN_PRICE_CONFIG.default) {
        price = TOKEN_PRICE_CONFIG.default;
      }
      if (!price) return null;

      const inputCost = ((usage.inputTokens || 0) / 1000000) * (price.inputPerM || 0);
      const outputCost = ((usage.outputTokens || 0) / 1000000) * (price.outputPerM || 0);
      const cacheCost = ((usage.cacheTokens || 0) / 1000000) * (price.cacheReadPerM || 0);
      return inputCost + outputCost + cacheCost;
    }

    function formatTokenCount(num) {
      if (num === null || num === undefined || isNaN(num)) return '0';
      return Number(num).toLocaleString('en-US');
    }

    function formatCompactTokenCount(num) {
      if (!num) return '0';
      if (num >= 1000000) {
        return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
      }
      if (num >= 1000) {
        return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
      }
      return String(num);
    }

    function escapeHtml(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    // ----------------------------------------------------
    // A. 32색 마스터 픽셀 팔레트 (Palette 0 ~ 31)
    // ----------------------------------------------------
    const PALETTE = [
      '#000000', // 0: 투명/블랙
      '#0d1117', // 1: 딥 다크 네이비
      '#161b26', // 2: 어두운 벽 몰딩
      '#21283b', // 3: 벽/기둥 베이스
      '#323c59', // 4: 슬레이트 가구
      '#526084', // 5: 밝은 메탈
      '#8fa1c4', // 6: 실버 그레이
      '#ffffff', // 7: 퓨어 화이트
      '#361b17', // 8: 딥 우드 다크
      '#5e2e25', // 9: 우드 섀도우
      '#8f4b32', // 10: 클래식 원목 브라운 (책장/책상)
      '#c27349', // 11: 밝은 원목
      '#fed7aa', // 12: 피부 베이스
      '#f59e0b', // 13: 웜 골드 스탠드 조명
      '#ef4444', // 14: 비비드 레드 (에러/LED/넥타이)
      '#fca5a5', // 15: 라이트 레드
      '#ea580c', // 16: 오렌지 (서브에이전트 옷)
      '#fef08a', // 17: 노란색 (질문/포스트잇)
      '#15803d', // 18: 다크 그린 (화분 잎)
      '#22c55e', // 19: 네온 에메랄드 (코드/정상 LED)
      '#0d9488', // 20: 청록 (서버실 베이스)
      '#14b8a6', // 21: 터콰이즈 레이더
      '#0284c7', // 22: 개발실 블루 (모니터 빛)
      '#38bdf8', // 23: 사이언 블루 (메인 에이전트 셔츠)
      '#7dd3fc', // 24: 하이라이트 블루
      '#4f46e5', // 25: 인디고 (서버실 그림자)
      '#7c3aed', // 26: 퍼플 (정보검색실 틴트)
      '#a855f7', // 27: 네온 퍼플
      '#3b1c54', // 28: 다크 퍼플
      '#451a03', // 29: 자료실 따뜻한 갈색 섀도우
      '#1c1917', // 30: 바닥 레트로 타일
      '#292524'  // 31: 바닥 타일 하이라이트
    ];

    // 오프스크린 캔버스 헬퍼
    function createBakedCanvas(w, h) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      return { canvas: c, ctx: ctx };
    }

    // 문자열 픽셀 맵을 캔버스에 베이킹하는 함수
    function bakePixelGrid(grid, colorMap, pixelSize = 1) {
      const h = grid.length;
      const w = grid[0].length;
      const baked = createBakedCanvas(w * pixelSize, h * pixelSize);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const char = grid[y][x];
          if (char !== '.' && colorMap[char] !== undefined) {
            const colorIdx = colorMap[char];
            baked.ctx.fillStyle = PALETTE[colorIdx] || colorIdx;
            baked.ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);
          }
        }
      }
      return baked.canvas;
    }

    // ----------------------------------------------------
    // B. 캐릭터 스프라이트 베이킹 (16x24 픽셀)
    // ----------------------------------------------------
    // 템플릿:
    // . : 투명
    // H : 머리카락
    // S : 피부
    // E : 눈
    // B : 옷(셔츠)
    // T : 넥타이/디테일
    // P : 바지
    // F : 신발
    // W : 흰색 보고서/손
    // R : 빨강(에러/식은땀)
    const CHAR_COLOR_ANTIGRAVITY = {
      'H': 1, 'S': 12, 'E': 0, 'B': 23, 'T': 14, 'P': 4, 'F': 1, 'W': 7, 'R': 14
    };
    const CHAR_COLOR_CLAUDE = {
      'H': 8, 'S': 12, 'E': 0, 'B': 16, 'T': 26, 'P': 30, 'F': 1, 'W': 7, 'R': 14
    };
    const CHAR_COLOR_SUB = {
      'H': 8, 'S': 12, 'E': 0, 'B': 27, 'T': 17, 'P': 3, 'F': 1, 'W': 7, 'R': 14
    };
    const CHAR_COLOR_DEFAULT = CHAR_COLOR_ANTIGRAVITY;


    // ----------------------------------------------------
    // C. 아이소메트릭 오피스 테마 (iso.js 전용)
    // 빛은 화면 왼쪽 위에서 온다: 윗면 1.0 > 왼쪽 앞면(+y) 0.9 > 오른쪽 앞면(+x) 0.76
    // ----------------------------------------------------
    const ISO_THEME = {
      // 다크 컨트롤룸 배경: 짙은 남색 + 비네트 + 점 격자, 건물 아래 인디고/시안 빛 웅덩이
      backdrop: {
        center: '#121a36', mid: '#0b1022', edge: '#05070f',
        dot: 'rgba(150, 170, 255, 0.11)',
        poolA: 'rgba(99, 102, 241, 0.42)', poolB: 'rgba(34, 211, 238, 0.14)',
        rim: 'rgba(165, 200, 255, 0.55)', rimSoft: 'rgba(103, 232, 249, 0.22)',
        window: ['#0a1030', '#1a2456'], spill: [255, 232, 190]
      },
      // 캔버스 라벨: 어두운 유리 카드
      glass: {
        bg: 'rgba(12, 16, 34, 0.78)', bgStrong: 'rgba(14, 19, 40, 0.9)',
        border: 'rgba(255, 255, 255, 0.14)', shadow: 'rgba(0, 0, 0, 0.35)',
        text: '#eef1ff', sub: '#aab3d6'
      },
      sky: {
        day: ['#8fbdf0', '#c9def8', '#eef2f8'],
        night: ['#070b24', '#141b4d', '#2c3277'],
        horizonDay: 'rgba(255, 233, 204, 0.55)',
        horizonNight: 'rgba(120, 110, 220, 0.30)'
      },
      grass: { top: '#82c27a', rim: '#a3d897', side: '#5f9f57', sideR: '#4f8a4a', dot: '#6fae67', flower: ['#fff4c2', '#ffd1dc', '#ffffff'] },
      soil: { a: '#b07a52', b: '#93603f', c: '#7a4c32', strata: '#c49068' },
      plinth: { top: '#e3e6ee', side: '#c3c8d4', sideR: '#aab1c1' },
      wall: { cap: '#ffffff', rail: '#ffffff', skirt: '#cfc8bc', partition: '#f3f1ec', partitionCap: '#ffffff' },
      hall: { floor: '#ebe8e1', alt: '#e2ded5', runner: '#7d8db0', runnerIn: '#93a2c2', runnerEdge: '#62729a', threshold: '#c9c2b4' },
      rooms: {
        archive:   { floor: '#e2c6a2', alt: '#d6b791', seam: '#b8946c', pattern: 'wood',   wall: '#f1e4d1', wainscot: '#d9c2a2' },
        dev:       { floor: '#d4ddef', alt: '#cad4ea', seam: '#b4c0db', pattern: 'carpet', wall: '#e6ebf6', wainscot: '#c9d3ea' },
        server:    { floor: '#cfd4de', alt: '#c3c9d5', seam: '#a5adbd', pattern: 'raised', wall: '#dde1e9', wainscot: '#bcc3d0' },
        elevator:  { floor: '#e7e3dc', alt: '#dcd7cf', seam: '#f6f3ee', pattern: 'stone',  wall: '#efebe5', wainscot: '#d8d1c5' },
        research:  { floor: '#cfe8de', alt: '#c3dfd3', seam: '#aacfc0', pattern: 'carpet', wall: '#e3f1eb', wainscot: '#bcdccf' },
        meeting:   { floor: '#e1d9f1', alt: '#d7cdec', seam: '#c1b4df', pattern: 'carpet', wall: '#ece6f6', wainscot: '#d1c6ea' },
        user_desk: { floor: '#efd5b7', alt: '#e5c7a5', seam: '#c9a47c', pattern: 'wood',   wall: '#f6e9da', wainscot: '#e3cbb0' }
      },
      rugs: {
        archive: ['#b5654a', '#d9906d', '#f1d3b5'],
        meeting: ['#6f58c9', '#9a86e0', '#d9d0f5'],
        user_desk: ['#e07a5f', '#f2a488', '#fde2d2'],
        research: ['#2f9e7a', '#63c2a0', '#d7f0e6']
      },
      wood: { dark: '#7b5034', mid: '#a06d49', light: '#c99766', top: '#d8a978' },
      metal: { dark: '#2c3240', mid: '#4a5263', light: '#8a93a6', chrome: '#c9cfda' },
      screen: { off: '#1f2633', frame: '#262c38' },
      books: ['#c0504d', '#3f6fb5', '#7fae4f', '#e5b343', '#7b5ea7', '#3aa4bf', '#d9733a', '#2e7d6b', '#e8e2d4'],
      leaf: ['#2f7d4a', '#3f9b5a', '#57b56c', '#7fd08a'],
      pot: '#d07b55',
      outline: 'rgba(30, 27, 52, 0.62)',
      skin: '#ffd9bd',
      outfits: {
        claude:      { shirt: '#d97757', tie: '#6b46c1', hair: '#4a2f22', pants: '#3b3552', shoes: '#2a2433' },
        antigravity: { shirt: '#2fb4e8', tie: '#1e3a8a', hair: '#1c2433', pants: '#1f2b4d', shoes: '#151b2e' },
        ops:         { shirt: '#7c5cdb', tie: '#f5b942', hair: '#363b47', pants: '#2b2858', shoes: '#1d1b33' },
        sub:         { shirt: '#14b8a6', tie: '#0f766e', hair: '#7c2d12', pants: '#334155', shoes: '#1f2937', cap: '#0f766e' }
      }
    };

  // Office 네임스페이스 및 전역 노출
  Object.assign(Office, {
    ISO_THEME,
    TOKEN_PRICE_CONFIG,
    calculateEstimatedCost,
    formatTokenCount,
    formatCompactTokenCount,
    escapeHtml,
    PALETTE,
    createBakedCanvas,
    bakePixelGrid,
    CHAR_COLOR_DEFAULT,
    CHAR_COLOR_ANTIGRAVITY,
    CHAR_COLOR_CLAUDE,
    CHAR_COLOR_SUB
  });

  window.TOKEN_PRICE_CONFIG = TOKEN_PRICE_CONFIG;
  window.calculateEstimatedCost = calculateEstimatedCost;
  window.formatTokenCount = formatTokenCount;
  window.formatCompactTokenCount = formatCompactTokenCount;
  window.escapeHtml = escapeHtml;
  window.PALETTE = PALETTE;
  window.createBakedCanvas = createBakedCanvas;
  window.bakePixelGrid = bakePixelGrid;
  window.CHAR_COLOR_DEFAULT = CHAR_COLOR_DEFAULT;
  window.CHAR_COLOR_ANTIGRAVITY = CHAR_COLOR_ANTIGRAVITY;
  window.CHAR_COLOR_CLAUDE = CHAR_COLOR_CLAUDE;
  window.CHAR_COLOR_SUB = CHAR_COLOR_SUB;

})(window);
