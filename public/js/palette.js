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


  // Office 네임스페이스 및 전역 노출
  Object.assign(Office, {
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
