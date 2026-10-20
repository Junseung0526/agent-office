/**
 * 에이전트 오피스 (Agent Office) - 스프라이트 모듈 (public/js/sprites.js)
 * 캐릭터 애니메이션 프레임 및 사무실 소품 오프스크린 베이킹
 */

(function(window) {
  'use strict';

  const Office = window.Office = window.Office || {};
  const {
    PALETTE,
    createBakedCanvas,
    bakePixelGrid,
    CHAR_COLOR_DEFAULT,
    CHAR_COLOR_SUB
  } = Office;

    const SPRITE_FRAMES = {};

    function bakeCharacterSprites() {
      // 1) 대기 프레임 1 (IDLE 0)
      const idle0 = [
        "....HHHHHHHH....",
        "...HHHHHHHHHH...",
        "...HHSSSSSSHH...",
        "...HHSEESEEHH...",
        "...HHSSSSSSHH...",
        "....HSSSSSSH....",
        "....HSSSSSSH....",
        ".....SSSSSS.....",
        "....BBBBBBBB....",
        "...BBBBTTBBBB...",
        "...BBBBTTBBBB...",
        "...BBBBTTBBBB...",
        "...BBBBBBBBBB...",
        "...BBBBBBBBBB...",
        "...WWBBBBBBWW...",
        "....PPPPPPPP....",
        "....PPPPPPPP....",
        "....PPPPPPPP....",
        "....PPPPPPPP....",
        "....PPPPPPPP....",
        "....PPPPPPPP....",
        "....PPPPPPPP....",
        "...FFFF..FFFF...",
        "...FFFF..FFFF..."
      ];

      // 2) 대기 프레임 2 (IDLE 1: 1px 숨쉬기 들숨)
      const idle1 = [
        "....HHHHHHHH....",
        "...HHHHHHHHHH...",
        "...HHSSSSSSHH...",
        "...HHSEESEEHH...",
        "...HHSSSSSSHH...",
        "....HSSSSSSH....",
        "....HSSSSSSH....",
        ".....SSSSSS.....",
        "...BBBBBBBBBB...",
        "...BBBBTTBBBB...",
        "..BBBBBTTBBBBB..",
        "..BBBBBTTBBBBB..",
        "...BBBBBBBBBB...",
        "...BBBBBBBBBB...",
        "...WWBBBBBBWW...",
        "....PPPPPPPP....",
        "....PPPPPPPP....",
        "....PPPPPPPP....",
        "....PPPPPPPP....",
        "....PPPPPPPP....",
        "....PPPPPPPP....",
        "....PPPPPPPP....",
        "...FFFF..FFFF...",
        "...FFFF..FFFF..."
      ];

      // 3) 걷기 프레임 4개 (WALK 0 ~ 3)
      const walk0 = [
        "....HHHHHHHH....",
        "...HHHHHHHHHH...",
        "...HHSSSSSSHH...",
        "...HHSEESEEHH...",
        "...HHSSSSSSHH...",
        "....HSSSSSSH....",
        "....HSSSSSSH....",
        ".....SSSSSS.....",
        "....BBBBBBBB....",
        "...BBBBTTBBBB...",
        "...BBBBTTBBBB...",
        "..WBBBBTTBBBB...",
        "..WBBBBBBBBBB...",
        "...BBBBBBBBBBW..",
        "....PPPPPPPP.W..",
        "....PPPPPPPP....",
        "...PPPP..PPPP...",
        "...PPPP..PPPP...",
        "..PPPP....PPPP..",
        "..PPPP....PPPP..",
        ".FFFF......PPPP.",
        ".FFFF......PPPP.",
        "............FFFF",
        "............FFFF"
      ];

      const walk1 = idle0; // 중앙 교차

      const walk2 = [
        "....HHHHHHHH....",
        "...HHHHHHHHHH...",
        "...HHSSSSSSHH...",
        "...HHSEESEEHH...",
        "...HHSSSSSSHH...",
        "....HSSSSSSH....",
        "....HSSSSSSH....",
        ".....SSSSSS.....",
        "....BBBBBBBB....",
        "...BBBBTTBBBB...",
        "...BBBBTTBBBB...",
        "...BBBBTTBBBBW..",
        "...BBBBBBBBBBW..",
        "..WBBBBBBBBBB...",
        "..W.PPPPPPPP....",
        "....PPPPPPPP....",
        "...PPPP..PPPP...",
        "...PPPP..PPPP...",
        "..PPPP....PPPP..",
        "..PPPP....PPPP..",
        ".PPPP......FFFF.",
        ".PPPP......FFFF.",
        "FFFF............",
        "FFFF............"
      ];

      const walk3 = idle1;

      // 4) 고민 포즈 (PONDER: 턱 괴고 팔짱)
      const ponder = [
        "....HHHHHHHH....",
        "...HHHHHHHHHH...",
        "...HHSSSSSSHH...",
        "...HH.EE.EEHH...",
        "...HHSSSSSSHH...",
        "....HSSSSSSH....",
        "....HSSSSSSH....",
        ".....SSSSSWH....",
        "....BBBBBBWW....",
        "...BBBBTTBBBB...",
        "...BBWWWWBBBB...",
        "...BBWWWWBBBB...",
        "...BBBBBBBBBB...",
        "...BBBBBBBBBB...",
        "....PPPPPPPP....",
        "....PPPPPPPP....",
        "....PPPPPPPP....",
        "....PPPPPPPP....",
        "....PPPPPPPP....",
        "....PPPPPPPP....",
        "....PPPPPPPP....",
        "....PPPPPPPP....",
        "...FFFF..FFFF...",
        "...FFFF..FFFF..."
      ];

      // 5) 식은땀 에러 포즈 (SWEAT: 동공지진 + 땀방울)
      const sweat = [
        "...RHHHHHHHH....",
        "..RRHHHHHHHHH...",
        "...HHSSSSSSHH...",
        "...HHSE..SEHH...",
        "...HHSSSSSSHH...",
        "....HSSRRSSSH...",
        "....HSSSSSSH....",
        ".....SSSSSS.....",
        "...WBBBBBBBBW...",
        "..WWBBBTTBBBW...",
        "..WWBBBTTBBBW...",
        "...WBBBTTBBBW...",
        "...BBBBBBBBBB...",
        "...BBBBBBBBBB...",
        "....PPPPPPPP....",
        "....PPPPPPPP....",
        "....PPPPPPPP....",
        "....PPPPPPPP....",
        "....PPPPPPPP....",
        "....PPPPPPPP....",
        "....PPPPPPPP....",
        "....PPPPPPPP....",
        "...FFFF..FFFF...",
        "...FFFF..FFFF..."
      ];

      // 6) 보고/퇴근 포즈 (REPORT: 서류 들고 활짝 웃기)
      const report = [
        "....HHHHHHHH....",
        "...HHHHHHHHHH...",
        "...HHSSSSSSHH...",
        "...HHS..S..SHH...",
        "...HHSSSSSSHH...",
        "....HSS..SSSH...",
        "....HSSSSSSH....",
        ".....SSSSSS.....",
        "....BBBBBBBB....",
        "...BBBBTTBBBW...",
        "...BBBBTTBBWWW..",
        "...BBBBTTBWWWW..",
        "...BBBBBBWWWW...",
        "...BBBBBBBBBB...",
        "...WWBBBBBBBB...",
        "....PPPPPPPP....",
        "....PPPPPPPP....",
        "....PPPPPPPP....",
        "....PPPPPPPP....",
        "....PPPPPPPP....",
        "....PPPPPPPP....",
        "....PPPPPPPP....",
        "...FFFF..FFFF...",
        "...FFFF..FFFF..."
      ];

      // 베이킹 등록 (기본 & 서브에이전트 & 엔진별 고유 외형)
      const colorAG = Office.CHAR_COLOR_ANTIGRAVITY || CHAR_COLOR_DEFAULT;
      const colorClaude = Office.CHAR_COLOR_CLAUDE || CHAR_COLOR_DEFAULT;

      // Antigravity 에이전트 (사이언 블루 랩코트 & 네이비)
      SPRITE_FRAMES['antigravity_idle0'] = bakePixelGrid(idle0, colorAG);
      SPRITE_FRAMES['antigravity_idle1'] = bakePixelGrid(idle1, colorAG);
      SPRITE_FRAMES['antigravity_walk0'] = bakePixelGrid(walk0, colorAG);
      SPRITE_FRAMES['antigravity_walk1'] = bakePixelGrid(walk1, colorAG);
      SPRITE_FRAMES['antigravity_walk2'] = bakePixelGrid(walk2, colorAG);
      SPRITE_FRAMES['antigravity_walk3'] = bakePixelGrid(walk3, colorAG);
      SPRITE_FRAMES['antigravity_ponder'] = bakePixelGrid(ponder, colorAG);
      SPRITE_FRAMES['antigravity_sweat'] = bakePixelGrid(sweat, colorAG);
      SPRITE_FRAMES['antigravity_report'] = bakePixelGrid(report, colorAG);

      // Claude Code 에이전트 (앤트로픽 웜 테라코타 오렌지 & 퍼플 타이)
      SPRITE_FRAMES['claude_idle0'] = bakePixelGrid(idle0, colorClaude);
      SPRITE_FRAMES['claude_idle1'] = bakePixelGrid(idle1, colorClaude);
      SPRITE_FRAMES['claude_walk0'] = bakePixelGrid(walk0, colorClaude);
      SPRITE_FRAMES['claude_walk1'] = bakePixelGrid(walk1, colorClaude);
      SPRITE_FRAMES['claude_walk2'] = bakePixelGrid(walk2, colorClaude);
      SPRITE_FRAMES['claude_walk3'] = bakePixelGrid(walk3, colorClaude);
      SPRITE_FRAMES['claude_ponder'] = bakePixelGrid(ponder, colorClaude);
      SPRITE_FRAMES['claude_sweat'] = bakePixelGrid(sweat, colorClaude);
      SPRITE_FRAMES['claude_report'] = bakePixelGrid(report, colorClaude);

      // 기본 main_ 폴백 호환성
      SPRITE_FRAMES['main_idle0'] = SPRITE_FRAMES['antigravity_idle0'];
      SPRITE_FRAMES['main_idle1'] = SPRITE_FRAMES['antigravity_idle1'];
      SPRITE_FRAMES['main_walk0'] = SPRITE_FRAMES['antigravity_walk0'];
      SPRITE_FRAMES['main_walk1'] = SPRITE_FRAMES['antigravity_walk1'];
      SPRITE_FRAMES['main_walk2'] = SPRITE_FRAMES['antigravity_walk2'];
      SPRITE_FRAMES['main_walk3'] = SPRITE_FRAMES['antigravity_walk3'];
      SPRITE_FRAMES['main_ponder'] = SPRITE_FRAMES['antigravity_ponder'];
      SPRITE_FRAMES['main_sweat'] = SPRITE_FRAMES['antigravity_sweat'];
      SPRITE_FRAMES['main_report'] = SPRITE_FRAMES['antigravity_report'];

      SPRITE_FRAMES['sub_idle0'] = bakePixelGrid(idle0, CHAR_COLOR_SUB);
      SPRITE_FRAMES['sub_idle1'] = bakePixelGrid(idle1, CHAR_COLOR_SUB);
      SPRITE_FRAMES['sub_walk0'] = bakePixelGrid(walk0, CHAR_COLOR_SUB);
      SPRITE_FRAMES['sub_walk1'] = bakePixelGrid(walk1, CHAR_COLOR_SUB);
      SPRITE_FRAMES['sub_walk2'] = bakePixelGrid(walk2, CHAR_COLOR_SUB);
      SPRITE_FRAMES['sub_walk3'] = bakePixelGrid(walk3, CHAR_COLOR_SUB);
      SPRITE_FRAMES['sub_ponder'] = bakePixelGrid(ponder, CHAR_COLOR_SUB);
      SPRITE_FRAMES['sub_sweat'] = bakePixelGrid(sweat, CHAR_COLOR_SUB);
      SPRITE_FRAMES['sub_report'] = bakePixelGrid(report, CHAR_COLOR_SUB);
    }
    bakeCharacterSprites();

    // ----------------------------------------------------
    // C. 방 소품 스프라이트 베이킹 (오프스크린)
    // ----------------------------------------------------
    const PROPS = {};

    function bakeProps() {
      // 1. 자료실 책장 (36x64)
      const shelf = createBakedCanvas(36, 64);
      const sctx = shelf.ctx;
      sctx.fillStyle = PALETTE[8];
      sctx.fillRect(0, 0, 36, 64);
      sctx.fillStyle = PALETTE[10];
      sctx.fillRect(2, 2, 32, 60);
      // 선반 3개
      const bookColors = [14, 23, 19, 13, 27, 21, 16];
      for (let y = 18; y < 60; y += 18) {
        sctx.fillStyle = PALETTE[9];
        sctx.fillRect(2, y, 32, 3);
        // 책 꽂기
        for (let x = 4; x < 30; x += 4) {
          sctx.fillStyle = PALETTE[bookColors[(x + y) % bookColors.length]];
          sctx.fillRect(x, y - 13, 3, 13);
          sctx.fillStyle = PALETTE[7];
          sctx.fillRect(x + 1, y - 10, 1, 2); // 책등 금박
        }
      }
      PROPS['bookshelf'] = shelf.canvas;

      // 2. 사다리 (12x48)
      const ladder = createBakedCanvas(12, 48);
      const lctx = ladder.ctx;
      lctx.fillStyle = PALETTE[11];
      lctx.fillRect(0, 0, 2, 48);
      lctx.fillRect(10, 0, 2, 48);
      for (let y = 6; y < 48; y += 8) {
        lctx.fillRect(2, y, 8, 2);
      }
      PROPS['ladder'] = ladder.canvas;

      // 3. 카드 서랍장 (인덱스 캐비닛 20x24)
      const cabinet = createBakedCanvas(20, 24);
      const cctx = cabinet.ctx;
      cctx.fillStyle = PALETTE[10];
      cctx.fillRect(0, 0, 20, 24);
      cctx.fillStyle = PALETTE[8];
      cctx.strokeRect(0, 0, 20, 24);
      for (let y = 2; y < 22; y += 7) {
        cctx.fillStyle = PALETTE[9];
        cctx.fillRect(2, y, 16, 5);
        cctx.fillStyle = PALETTE[13];
        cctx.fillRect(8, y + 2, 4, 1); // 황동 손잡이
      }
      PROPS['cabinet'] = cabinet.canvas;

      // 4. 아이맥 모니터 & 책상 (개발실 36x30)
      const devDesk = createBakedCanvas(40, 32);
      const dctx = devDesk.ctx;
      // 책상 상판 & 다리
      dctx.fillStyle = PALETTE[4];
      dctx.fillRect(0, 16, 40, 4);
      dctx.fillStyle = PALETTE[3];
      dctx.fillRect(4, 20, 3, 12);
      dctx.fillRect(33, 20, 3, 12);
      // 모니터 스탠드 & 외곽
      dctx.fillStyle = PALETTE[5];
      dctx.fillRect(18, 11, 4, 6);
      dctx.fillRect(14, 15, 12, 2);
      dctx.fillStyle = PALETTE[1];
      dctx.fillRect(8, 0, 24, 14);
      // 액정 블루 빛
      dctx.fillStyle = PALETTE[22];
      dctx.fillRect(9, 1, 22, 12);
      // 포스트잇 2개
      dctx.fillStyle = PALETTE[17];
      dctx.fillRect(7, 2, 3, 3);
      dctx.fillStyle = PALETTE[15];
      dctx.fillRect(7, 6, 3, 3);
      PROPS['devDesk'] = devDesk.canvas;

      // 5. 몬스테라 화분 (14x18)
      const plant = createBakedCanvas(14, 18);
      const pctx = plant.ctx;
      pctx.fillStyle = PALETTE[10];
      pctx.fillRect(3, 10, 8, 8); // 화분
      pctx.fillStyle = PALETTE[18];
      pctx.fillRect(1, 4, 5, 5); // 잎 1
      pctx.fillRect(7, 1, 6, 6); // 잎 2
      pctx.fillRect(4, 6, 4, 4);
      pctx.fillStyle = PALETTE[19];
      pctx.fillRect(2, 5, 2, 2);
      pctx.fillRect(9, 2, 2, 2);
      PROPS['plant'] = plant.canvas;

      // 6. 서버 랙 (28x60)
      const rack = createBakedCanvas(28, 60);
      const rctx = rack.ctx;
      rctx.fillStyle = PALETTE[1];
      rctx.fillRect(0, 0, 28, 60);
      rctx.fillStyle = PALETTE[3];
      rctx.strokeRect(0, 0, 28, 60);
      // 유닛 슬롯 6개
      for (let y = 3; y < 56; y += 9) {
        rctx.fillStyle = PALETTE[2];
        rctx.fillRect(2, y, 24, 7);
        rctx.fillStyle = PALETTE[5];
        rctx.fillRect(4, y + 2, 12, 3); // 메탈 베이
      }
      PROPS['rack'] = rack.canvas;

      // 7. 환풍구 그릴 (바닥 에어벤트 24x6)
      const vent = createBakedCanvas(24, 6);
      const vctx = vent.ctx;
      vctx.fillStyle = PALETTE[2];
      vctx.fillRect(0, 0, 24, 6);
      vctx.fillStyle = PALETTE[5];
      for (let x = 2; x < 22; x += 4) {
        vctx.fillRect(x, 1, 2, 4);
      }
      PROPS['vent'] = vent.canvas;

      // 8. 멀티 모니터 벽 (정보검색실 42x34)
      const multiScreen = createBakedCanvas(42, 34);
      const mctx = multiScreen.ctx;
      mctx.fillStyle = PALETTE[3];
      mctx.fillRect(19, 14, 4, 18);
      mctx.fillRect(12, 30, 18, 3);
      // 좌측 모니터
      mctx.fillStyle = PALETTE[1];
      mctx.fillRect(0, 0, 19, 14);
      mctx.fillStyle = PALETTE[28];
      mctx.fillRect(1, 1, 17, 12);
      // 우측 모니터
      mctx.fillStyle = PALETTE[1];
      mctx.fillRect(23, 0, 19, 14);
      mctx.fillStyle = PALETTE[26];
      mctx.fillRect(24, 1, 17, 12);
      PROPS['multiScreen'] = multiScreen.canvas;

      // 9. 화이트보드 (회의실 48x34)
      const wb = createBakedCanvas(48, 34);
      const wctx = wb.ctx;
      wctx.fillStyle = PALETTE[5];
      wctx.fillRect(0, 0, 48, 34);
      wctx.fillStyle = PALETTE[7];
      wctx.fillRect(2, 2, 44, 28);
      wctx.fillStyle = PALETTE[4];
      wctx.fillRect(16, 30, 16, 2); // 마커 받침대
      wctx.fillStyle = PALETTE[14];
      wctx.fillRect(18, 29, 3, 2); // 빨강 마커
      wctx.fillStyle = PALETTE[23];
      wctx.fillRect(23, 29, 3, 2); // 파랑 마커
      // 내용 체크리스트
      wctx.fillStyle = PALETTE[19];
      wctx.fillRect(6, 6, 3, 3);
      wctx.fillStyle = PALETTE[3];
      wctx.fillRect(11, 7, 24, 2);
      wctx.fillStyle = PALETTE[19];
      wctx.fillRect(6, 13, 3, 3);
      wctx.fillStyle = PALETTE[3];
      wctx.fillRect(11, 14, 28, 2);
      wctx.fillStyle = PALETTE[13];
      wctx.fillRect(6, 20, 3, 3);
      wctx.fillStyle = PALETTE[3];
      wctx.fillRect(11, 21, 18, 2);
      PROPS['whiteboard'] = wb.canvas;

      // 10. 내 자리 책상 & 웜 스탠드 (36x30)
      const userDesk = createBakedCanvas(38, 32);
      const uctx = userDesk.ctx;
      uctx.fillStyle = PALETTE[11];
      uctx.fillRect(0, 16, 38, 4);
      uctx.fillStyle = PALETTE[9];
      uctx.fillRect(3, 20, 3, 12);
      uctx.fillRect(32, 20, 3, 12);
      // 노트북
      uctx.fillStyle = PALETTE[6];
      uctx.fillRect(12, 14, 14, 2);
      uctx.fillStyle = PALETTE[1];
      uctx.fillRect(13, 5, 12, 9);
      uctx.fillStyle = PALETTE[24];
      uctx.fillRect(14, 6, 10, 7);
      // 노란 스탠드 조명
      uctx.fillStyle = PALETTE[13];
      uctx.fillRect(2, 6, 2, 10);
      uctx.fillRect(2, 5, 6, 2);
      uctx.fillRect(5, 5, 5, 4); // 갓등
      // 머그컵
      uctx.fillStyle = PALETTE[7];
      uctx.fillRect(29, 11, 4, 5);
      PROPS['userDesk'] = userDesk.canvas;

      // 11. 엘리베이터 문 (32x56)
      const elev = createBakedCanvas(32, 56);
      const ectx = elev.ctx;
      ectx.fillStyle = PALETTE[2];
      ectx.fillRect(0, 0, 32, 56);
      ectx.fillStyle = PALETTE[5];
      ectx.fillRect(2, 8, 13, 48); // 좌측 문
      ectx.fillRect(17, 8, 13, 48); // 우측 문
      ectx.fillStyle = PALETTE[1];
      ectx.fillRect(15, 8, 2, 48); // 틈
      ectx.fillStyle = PALETTE[13];
      ectx.fillRect(12, 3, 8, 4); // 층 램프
      PROPS['elevator'] = elev.canvas;
    }
    bakeProps();


  Object.assign(Office, {
    SPRITE_FRAMES,
    bakeCharacterSprites,
    PROPS,
    bakeProps
  });

  window.SPRITE_FRAMES = SPRITE_FRAMES;
  window.bakeCharacterSprites = bakeCharacterSprites;
  window.PROPS = PROPS;
  window.bakeProps = bakeProps;

})(window);
