/**
 * 에이전트 오피스 (Agent Office) - 사무실 룸 및 환경 렌더링 모듈 (public/js/rooms.js)
 * 방 좌표 정의, 도구 인자 매핑, 실시간 작업 상태 및 배경 픽셀아트 렌더러
 */

(function(window) {
  'use strict';

  const Office = window.Office = window.Office || {};
  const {
    PALETTE,
    PROPS,
    formatCompactTokenCount
  } = Office;

    // ----------------------------------------------------
    // E. 480x270 사무실 레이아웃 & 픽셀 좌표계
    // ----------------------------------------------------
    // 복도 바닥 y = 210, 방 높이 = 170 (y: 40 ~ 210)
    // 전체 폭 480을 7개 구역으로 균등/정밀 분할:
    // [0] 엘리베이터 : x 10 ~ 58 (폭 48, 타겟 x = 34)
    // [1] 자료실     : x 62 ~ 124 (폭 62, 타겟 x = 92)
    // [2] 개발실     : x 128 ~ 194 (폭 66, 타겟 x = 160)
    // [3] 서버실     : x 198 ~ 264 (폭 66, 타겟 x = 230)
    // [4] 정보검색실 : x 268 ~ 334 (폭 66, 타겟 x = 300)
    // [5] 회의실     : x 338 ~ 406 (폭 68, 타겟 x = 372)
    // [6] 내 자리    : x 410 ~ 472 (폭 62, 타겟 x = 440)
    const ROOM_DEFS = {
      elevator:  { id: 'elevator',  name: '엘리베이터', x: 10,  w: 50, targetX: 34,  colorIdx: 5 },
      archive:   { id: 'archive',   name: '자료실',     x: 64,  w: 62, targetX: 95,  colorIdx: 11 },
      dev:       { id: 'dev',       name: '개발실',     x: 130, w: 64, targetX: 162, colorIdx: 23 },
      server:    { id: 'server',    name: '서버실',     x: 198, w: 66, targetX: 230, colorIdx: 20 },
      research:  { id: 'research',  name: '정보검색실', x: 268, w: 66, targetX: 300, colorIdx: 27 },
      meeting:   { id: 'meeting',   name: '회의실',     x: 338, w: 68, targetX: 372, colorIdx: 6 },
      user_desk: { id: 'user_desk', name: '내 자리',    x: 410, w: 62, targetX: 440, colorIdx: 13 }
    };

    const FLOOR_Y = 208; // 캐릭터 발 위치

    // ----------------------------------------------------
    // E-1. 도구 입력 인자(args/input) 추출 및 보안 마스킹 매핑표
    // ----------------------------------------------------
    const TOOL_PARAM_MAPPINGS = {
      // 개발실: 수정 중인 파일명 (경로 전체 말고 마지막 파일명만)
      dev: {
        room: 'dev',
        tools: [
          'Edit', 'edit_file', 'Write', 'write_file', 'write_to_file',
          'MultiEdit', 'replace_file_content', 'multi_replace_file_content',
          'NotebookEditCell', 'apply_diff', 'FileEdit', 'StrReplace', 'Patch'
        ],
        fields: ['TargetFile', 'Path', 'path', 'file_path', 'filename', 'file', 'target_file', 'filepath'],
        type: 'filename',
        prefix: '📄 '
      },
      // 서버실: 실행 중인 명령어 앞 30자 (토큰/패스워드 마스킹, 전광판 티커)
      server: {
        room: 'server',
        tools: ['Bash', 'run_command', 'exec', 'terminal', 'execute_command', 'sh', 'zsh', 'git'],
        fields: ['CommandLine', 'command', 'cmd', 'script'],
        type: 'command',
        prefix: '> '
      },
      // 자료실: 읽는 파일명 또는 검색어 (Grep/Glob 패턴)
      archive: {
        room: 'archive',
        tools: [
          'Read', 'read_file', 'View', 'view_file', 'list_dir',
          'Grep', 'grep_search', 'Glob', 'LS', 'Find', 'find_by_name',
          'FileSearch', 'read_resource', 'list_resources'
        ],
        fields: ['pattern', 'glob', 'AbsolutePath', 'Path', 'path', 'file_path', 'query', 'Uri', 'TargetFile', 'DirectoryPath', 'dir_path', 'directory'],
        type: 'file_or_pattern',
        prefix: '📖 '
      },
      // 정보검색실: 검색어 또는 MCP 도구 이름
      research: {
        room: 'research',
        tools: ['WebSearch', 'WebFetch', 'search_web', 'read_url_content', 'call_mcp_tool'],
        fields: ['ToolName', 'query', 'Url', 'url', 'ServerName', 'domain'],
        type: 'search_or_mcp',
        prefix: '🌐 '
      },
      // 회의실: 계획 수립, 아키텍처 논의, 브레인스토밍, 순차 추론, 실시간 사고 과정
      meeting: {
        room: 'meeting',
        tools: ['sequentialthinking', 'brainstorming', 'plan', 'manage_task', 'schedule', 'task', 'TodoWrite', 'TodoRead', 'thinking'],
        fields: ['thought', 'prompt', 'title', 'task', 'step', 'goal', 'query', 'toolSummary', 'thinkingText'],
        type: 'planning',
        prefix: '💡 '
      }
    };

    // 파일 경로에서 마지막 파일명(basename)만 추출
    function extractBasename(filePath) {
      if (!filePath || typeof filePath !== 'string') return '';
      const clean = filePath.replace(/^["']|["']$/g, '').trim();
      const parts = clean.split(/[/\\]/);
      return parts[parts.length - 1] || clean;
    }

    // 보안 마스킹: 토큰, 패스워드, API 키, Bearer 토큰 등 민감정보를 ***로 마스킹
    function maskSensitive(str) {
      if (!str || typeof str !== 'string') return '';
      // 줄바꿈 및 제어문자 공백 치환
      let s = str.replace(/[\r\n\t\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim();
      // Bearer 토큰
      s = s.replace(/(Bearer\s+)[A-Za-z0-9_\-\.]{8,}/gi, '$1***');
      // KEY=, TOKEN=, password=, secret=, API_KEY= 등
      s = s.replace(/([A-Z0-9_-]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH|CREDENTIAL|PRIVATE)[A-Z0-9_-]*\s*[:=]\s*)([^\s&|;'"]+)/gi, '$1***');
      // 일반적인 API 토큰 패턴 (ghp_, sk-, xoxb-)
      s = s.replace(/\b(gh[pousr]_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]+)\b/g, '***');
      // URL 내 사용자/비밀번호 (http://user:pass@host)
      s = s.replace(/(https?:\/\/[^\/\s:@]+:)[^\/\s:@]+(@)/gi, '$1***$2');
      return s;
    }

    // 도구 호출 이벤트로부터 구체적인 작업 상세 내용 추출
    function extractTaskDetail(roomId, toolName, args, summary) {
      const cfg = TOOL_PARAM_MAPPINGS[roomId];
      let detail = '';
      let prefix = (cfg && cfg.prefix) || '';

      if (cfg && args && typeof args === 'object') {
        if (cfg.type === 'filename') {
          for (const f of cfg.fields) {
            if (args[f] && typeof args[f] === 'string') {
              detail = extractBasename(args[f]);
              break;
            }
          }
        } else if (cfg.type === 'command') {
          for (const f of cfg.fields) {
            if (args[f] && typeof args[f] === 'string') {
              detail = maskSensitive(args[f]);
              break;
            }
          }
        } else if (cfg.type === 'file_or_pattern') {
          if (args.pattern && typeof args.pattern === 'string') {
            prefix = '🔍 ';
            detail = `grep: ${maskSensitive(args.pattern)}`;
          } else if (args.glob && typeof args.glob === 'string') {
            prefix = '🔍 ';
            detail = `glob: ${maskSensitive(args.glob)}`;
          } else {
            for (const f of cfg.fields) {
              if (args[f] && typeof args[f] === 'string') {
                const val = args[f].trim();
                if (val.includes('/') || val.includes('\\')) {
                  detail = extractBasename(val);
                } else {
                  detail = maskSensitive(val);
                }
                break;
              }
            }
          }
        } else if (cfg.type === 'search_or_mcp') {
          if (args.ToolName && typeof args.ToolName === 'string') {
            prefix = '⚡ ';
            detail = `MCP: ${args.ToolName}`;
          } else if (args.query && typeof args.query === 'string') {
            prefix = '🔍 ';
            detail = maskSensitive(args.query);
          } else if (args.Url || args.url) {
            prefix = '🌐 ';
            const u = args.Url || args.url;
            try {
              detail = new URL(u).hostname || maskSensitive(u);
            } catch (e) {
              detail = maskSensitive(u);
            }
          } else if (args.ServerName && typeof args.ServerName === 'string') {
            prefix = '⚡ ';
            detail = `MCP: ${args.ServerName}`;
          }
        } else if (cfg.type === 'planning') {
          if (args.thought && typeof args.thought === 'string') {
            prefix = '💭 ';
            detail = maskSensitive(args.thought);
          } else {
            for (const f of cfg.fields) {
              if (args[f] && typeof args[f] === 'string') {
                detail = maskSensitive(args[f]);
                break;
              }
            }
          }
        }
      }

      // MCP 도구명이 직접 들어온 경우 (예: mcp__notion_search)
      if (!detail && toolName && toolName.startsWith('mcp__')) {
        prefix = '⚡ ';
        detail = toolName.replace(/^mcp__/, '');
      }

      // Fallback: summary 또는 toolName
      if (!detail) {
        if (summary && typeof summary === 'string') {
          detail = maskSensitive(summary);
          if (roomId === 'dev' && (detail.includes('/') || detail.includes('\\'))) {
            detail = extractBasename(detail);
          }
        } else {
          detail = toolName || '작업 중';
        }
      }

      return { prefix, text: detail };
    }

    // 프로젝트별 각 방의 작업 상태 (라벨, 마퀴 오프셋, 페이드아웃 타이머)
    const projectRoomTaskStates = new Map();

    function getProjectTaskStates(pKey) {
      const key = pKey || activeProjectKey || 'default';
      if (!projectRoomTaskStates.has(key)) {
        projectRoomTaskStates.set(key, {
          lastActiveTime: performance.now(),
          dev: { text: '', prefix: '', active: false, endTime: 0, opacity: 0, tickerOffset: 0 },
          server: { text: '', prefix: '', active: false, endTime: 0, opacity: 0, tickerOffset: 0 },
          archive: { text: '', prefix: '', active: false, endTime: 0, opacity: 0, tickerOffset: 0 },
          research: { text: '', prefix: '', active: false, endTime: 0, opacity: 0, tickerOffset: 0 },
          meeting: { text: '', prefix: '', active: false, endTime: 0, opacity: 0, tickerOffset: 0 }
        });
      }
      const tasks = projectRoomTaskStates.get(key);
      tasks.lastActiveTime = performance.now();
      return tasks;
    }

    function setRoomTaskStart(pKey, roomId, toolName, args, summary) {
      const tasks = getProjectTaskStates(pKey);
      if (!tasks[roomId]) return;
      const detail = extractTaskDetail(roomId, toolName, args, summary);
      tasks[roomId].text = detail.text;
      tasks[roomId].prefix = detail.prefix;
      tasks[roomId].active = true;
      tasks[roomId].endTime = 0;
      tasks[roomId].opacity = 1;
      tasks[roomId].tickerOffset = 0;

      // 상세 인스펙터용 원본 정보 및 이력 보관
      tasks[roomId].currentArgs = args;
      tasks[roomId].currentTool = toolName;
      tasks[roomId].currentSummary = summary;
      tasks[roomId].startTime = Date.now();

      if (!tasks[roomId].history) tasks[roomId].history = [];
      tasks[roomId].history.unshift({
        toolName,
        args,
        summary,
        detailText: `${detail.prefix}${detail.text}`,
        time: new Date().toTimeString().split(' ')[0],
        timestamp: Date.now()
      });
      if (tasks[roomId].history.length > 20) tasks[roomId].history.pop();
    }

    function setRoomTaskEnd(pKey, roomId) {
      const tasks = getProjectTaskStates(pKey);
      if (!tasks[roomId]) return;
      if (tasks[roomId].active) {
        tasks[roomId].active = false;
        tasks[roomId].endTime = performance.now();
      }
    }

    function finishAllRoomTasks(pKey) {
      const tasks = getProjectTaskStates(pKey);
      const now = performance.now();
      for (const r in tasks) {
        if (tasks[r].active) {
          tasks[r].active = false;
          tasks[r].endTime = now;
        }
      }
    }


    // ----------------------------------------------------
    // G. 디테일 환경 렌더러
    // ----------------------------------------------------
    let tickCount = 0;

    // ----------------------------------------------------
    // G-1. 색상 유틸 (방 테마색을 벽 베이스에 섞어 방마다 은은한 톤 차이를 준다)
    // ----------------------------------------------------
    function hexToRgb(hex) {
      const n = parseInt(hex.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    function mixRgb(a, b, t) {
      return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
    }
    function rgba(rgb, a) {
      return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
    }

    const WALL_TOP = 36;
    const WAINSCOT_H = 22;
    const WALL_BASE_RGB = [22, 28, 43];
    const WALL_LOW_RGB = [15, 19, 30];

    // ----------------------------------------------------
    // G-2. 정적 배경 오프스크린 베이킹 (천장/벽/징두리/기둥/바닥/벽 장식) - 1회 생성 후 매 프레임 drawImage 1회
    // ----------------------------------------------------
    const backgroundCanvas = document.createElement('canvas');
    backgroundCanvas.width = 480;
    backgroundCanvas.height = 270;
    bakeOfficeBackground(backgroundCanvas.getContext('2d'));

    function bakeOfficeBackground(c) {
      // 1. 천장 슬래브 (콘크리트 질감 점묘)
      c.fillStyle = '#090c14';
      c.fillRect(0, 0, 480, 270);
      c.fillStyle = '#0d111b';
      for (let y = 2; y < 28; y += 3) {
        for (let x = (y % 2) * 3; x < 480; x += 7) c.fillRect(x, y, 1, 1);
      }
      // 천장 보 & 조명 트랙
      c.fillStyle = '#1a2133';
      c.fillRect(0, 28, 480, 6);
      c.fillStyle = '#252e45';
      c.fillRect(0, 28, 480, 1);
      c.fillStyle = '#0b0e17';
      c.fillRect(0, 34, 480, 2);

      // 2. 외벽 (엘리베이터 좌측 / 내 자리 우측)
      c.fillStyle = '#121725';
      c.fillRect(0, WALL_TOP, 10, FLOOR_Y - WALL_TOP);
      c.fillRect(472, WALL_TOP, 8, FLOOR_Y - WALL_TOP);

      // 3. 방별 벽면
      for (const key in ROOM_DEFS) {
        const room = ROOM_DEFS[key];
        const tint = hexToRgb(PALETTE[room.colorIdx]);
        const x0 = room.x;
        const w = room.w - 2;

        // 상단 벽: 4단 밴딩 그라데이션 (위쪽이 어둡고 아래로 갈수록 밝아짐)
        const wallH = FLOOR_Y - WAINSCOT_H - WALL_TOP;
        for (let i = 0; i < 4; i++) {
          c.fillStyle = mixRgb(WALL_BASE_RGB, tint, 0.04 + i * 0.015);
          const y = WALL_TOP + Math.floor((wallH * i) / 4);
          c.fillRect(x0, y, w, Math.ceil(wallH / 4) + 1);
        }
        // 벽지 세로 결 (아주 미세)
        c.fillStyle = 'rgba(255,255,255,0.018)';
        for (let x = x0 + 3; x < x0 + w; x += 6) c.fillRect(x, WALL_TOP + 16, 1, wallH - 16);

        // 징두리 판넬 (하단 벽)
        const wy = FLOOR_Y - WAINSCOT_H;
        c.fillStyle = mixRgb(WALL_LOW_RGB, tint, 0.07);
        c.fillRect(x0, wy, w, WAINSCOT_H);
        c.fillStyle = mixRgb(WALL_LOW_RGB, tint, 0.03);
        for (let x = x0 + 10; x < x0 + w - 4; x += 12) c.fillRect(x, wy + 3, 1, WAINSCOT_H - 5);
        // 체어 레일 (하이라이트 + 그림자)
        c.fillStyle = mixRgb([58, 68, 96], tint, 0.15);
        c.fillRect(x0, wy - 1, w, 1);
        c.fillStyle = 'rgba(0,0,0,0.35)';
        c.fillRect(x0, wy, w, 1);
        // 걸레받이
        c.fillStyle = '#080a12';
        c.fillRect(x0, FLOOR_Y - 2, w, 2);

        // 천장 아래 그림자 (벽 상단 어둡게)
        c.fillStyle = 'rgba(0,0,0,0.25)';
        c.fillRect(x0, WALL_TOP, w, 2);
        c.fillStyle = 'rgba(0,0,0,0.12)';
        c.fillRect(x0, WALL_TOP + 2, w, 2);

        // 방 사이 기둥 (입체감: 좌측 하이라이트 / 우측 그림자)
        const px = room.x + room.w - 2;
        c.fillStyle = '#20283b';
        c.fillRect(px, WALL_TOP, 4, FLOOR_Y - WALL_TOP);
        c.fillStyle = '#323d58';
        c.fillRect(px, WALL_TOP, 1, FLOOR_Y - WALL_TOP);
        c.fillStyle = '#121725';
        c.fillRect(px + 3, WALL_TOP, 1, FLOOR_Y - WALL_TOP);
        c.fillStyle = '#2a3349';
        c.fillRect(px - 1, FLOOR_Y - 4, 6, 4); // 기둥 받침

        bakeWallDecor(c, room);
      }

      // 4. 바닥: 원근감 있는 광택 타일 (가까울수록 타일이 크고 밝음)
      const fy = FLOOR_Y;
      c.fillStyle = '#121620';
      c.fillRect(0, fy, 480, 270 - fy);
      const rows = [
        { h: 5, w: 14, base: '#151a26' },
        { h: 7, w: 16, base: '#171c29' },
        { h: 9, w: 19, base: '#191f2d' },
        { h: 12, w: 23, base: '#1b2131' },
        { h: 29, w: 28, base: '#1d2334' }
      ];
      let ry = fy + 2;
      rows.forEach((row, ri) => {
        c.fillStyle = row.base;
        c.fillRect(0, ry, 480, row.h);
        c.fillStyle = 'rgba(255,255,255,0.035)'; // 타일 윗변 하이라이트
        c.fillRect(0, ry, 480, 1);
        c.fillStyle = '#0d1018'; // 줄눈
        const offset = (ri % 2) * Math.floor(row.w / 2);
        for (let x = offset; x < 480; x += row.w) c.fillRect(x, ry, 1, row.h);
        ry += row.h;
        c.fillRect(0, ry - 1, 480, 1);
      });
      // 앞쪽으로 갈수록 어두워지는 비네팅 (큰 타일의 격자감 완화)
      const fade = c.createLinearGradient(0, fy + 14, 0, 270);
      fade.addColorStop(0, 'rgba(9,12,20,0)');
      fade.addColorStop(1, 'rgba(9,12,20,0.75)');
      c.fillStyle = fade;
      c.fillRect(0, fy + 14, 480, 270 - fy - 14);

      // 벽-바닥 경계 립 & 벽 그림자
      c.fillStyle = '#2b3348';
      c.fillRect(0, fy, 480, 1);
      c.fillStyle = '#0a0d15';
      c.fillRect(0, fy + 1, 480, 1);
      c.fillStyle = 'rgba(0,0,0,0.22)';
      c.fillRect(0, fy + 2, 480, 3);

      // 바닥에 비친 방 색 반사 (아주 은은하게)
      for (const key in ROOM_DEFS) {
        const room = ROOM_DEFS[key];
        const tint = hexToRgb(PALETTE[room.colorIdx]);
        const g = c.createLinearGradient(0, fy + 2, 0, fy + 26);
        g.addColorStop(0, rgba(tint, 0.06));
        g.addColorStop(1, rgba(tint, 0));
        c.fillStyle = g;
        c.fillRect(room.x + 4, fy + 2, room.w - 10, 24);
      }
    }

    // 방별 정적 벽 장식 (소품이 놓이지 않는 벽 중단 공간을 채움)
    function bakeWallDecor(c, room) {
      const rx = room.x;
      if (room.id === 'elevator') {
        // 층 표시등 패널
        c.fillStyle = '#0a0d16';
        c.fillRect(rx + 16, 138, 20, 8);
        c.fillStyle = '#2a3349';
        c.fillRect(rx + 16, 138, 20, 1);
        // 호출 버튼 패널
        c.fillStyle = '#2a3349';
        c.fillRect(rx + 42, 176, 4, 8);
        c.fillStyle = '#526084';
        c.fillRect(rx + 43, 177, 2, 2);
        c.fillRect(rx + 43, 181, 2, 2);
      } else if (room.id === 'archive') {
        // 액자 (도면)
        c.fillStyle = '#3a2a1c';
        c.fillRect(rx + 8, 64, 24, 18);
        c.fillStyle = '#1e3a5f';
        c.fillRect(rx + 10, 66, 20, 14);
        c.fillStyle = 'rgba(147,197,253,0.55)';
        c.fillRect(rx + 12, 68, 10, 1);
        c.fillRect(rx + 12, 68, 1, 9);
        c.fillRect(rx + 12, 76, 14, 1);
        c.fillRect(rx + 21, 68, 1, 5);
        c.fillRect(rx + 21, 72, 6, 1);
        // 벽시계 테두리 (바늘은 실시간 동적 렌더링)
        c.fillStyle = '#3a4560';
        c.beginPath(); c.arc(rx + 46, 73, 8, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#e2e8f0';
        c.beginPath(); c.arc(rx + 46, 73, 7, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#64748b';
        c.fillRect(rx + 46, 67, 1, 1); c.fillRect(rx + 46, 79, 1, 1);
        c.fillRect(rx + 40, 73, 1, 1); c.fillRect(rx + 52, 73, 1, 1);
      } else if (room.id === 'dev') {
        // 칸반 보드 (TODO / DOING / DONE)
        c.fillStyle = '#2a3349';
        c.fillRect(rx + 6, 62, 50, 32);
        c.fillStyle = '#1e293b';
        c.fillRect(rx + 7, 63, 48, 30);
        c.fillStyle = '#334155';
        c.fillRect(rx + 23, 65, 1, 26);
        c.fillRect(rx + 39, 65, 1, 26);
        const notes = [
          [9, 67, '#fde68a'], [9, 74, '#fbcfe8'], [9, 81, '#fde68a'],
          [26, 67, '#bae6fd'], [26, 74, '#fde68a'],
          [42, 67, '#bbf7d0'], [42, 74, '#bbf7d0'], [42, 81, '#bbf7d0']
        ];
        for (const [nx, ny, col] of notes) {
          c.fillStyle = col;
          c.fillRect(rx + nx, ny, 11, 6);
          c.fillStyle = 'rgba(15,23,42,0.35)';
          c.fillRect(rx + nx + 2, ny + 2, 7, 1);
        }
        // 선반 위 머그컵 & 책
        c.fillStyle = '#323c59';
        c.fillRect(rx + 8, 110, 30, 2);
        c.fillStyle = '#ef4444'; c.fillRect(rx + 10, 102, 3, 8);
        c.fillStyle = '#38bdf8'; c.fillRect(rx + 13, 103, 3, 7);
        c.fillStyle = '#f59e0b'; c.fillRect(rx + 16, 101, 3, 9);
        c.fillStyle = '#e2e8f0'; c.fillRect(rx + 30, 105, 5, 5);
        c.fillRect(rx + 35, 106, 1, 3);
      } else if (room.id === 'server') {
        // 케이블 트레이 & 늘어진 케이블
        c.fillStyle = '#2a3349';
        c.fillRect(rx + 2, 58, room.w - 6, 3);
        c.fillStyle = '#3a4560';
        c.fillRect(rx + 2, 58, room.w - 6, 1);
        const cables = [['#0ea5e9', 12], ['#22c55e', 16], ['#f59e0b', 42], ['#a855f7', 46]];
        for (const [col, cx] of cables) {
          c.fillStyle = col;
          c.fillRect(rx + cx, 61, 1, FLOOR_Y - 60 - 61);
        }
        // 패치 패널 (포트 LED는 동적)
        c.fillStyle = '#0b0e17';
        c.fillRect(rx + 8, 72, 48, 12);
        c.fillStyle = '#2a3349';
        c.fillRect(rx + 8, 72, 48, 1);
        c.fillStyle = '#1a2133';
        for (let i = 0; i < 10; i++) c.fillRect(rx + 10 + i * 4.5, 76, 3, 3);
      } else if (room.id === 'research') {
        // 월드맵 대형 디스플레이 (핑은 동적)
        c.fillStyle = '#2a3349';
        c.fillRect(rx + 6, 60, 54, 34);
        c.fillStyle = '#070b14';
        c.fillRect(rx + 8, 62, 50, 30);
        c.fillStyle = 'rgba(168,85,247,0.45)';
        const land = [
          [12, 66, 8, 5], [14, 71, 6, 4], [17, 75, 3, 6],   // 아메리카
          [29, 66, 6, 4], [30, 71, 5, 7],                    // 유럽/아프리카
          [37, 65, 12, 6], [41, 71, 7, 3], [49, 79, 5, 3]    // 아시아/오세아니아
        ];
        for (const [lx, ly, lw, lh] of land) {
          for (let y = ly; y < ly + lh; y += 2) {
            for (let x = lx; x < lx + lw; x += 2) c.fillRect(rx + x, y, 1, 1);
          }
        }
        c.fillStyle = 'rgba(168,85,247,0.15)';
        c.fillRect(rx + 8, 77, 50, 1);
        // 스탠드 다리
        c.fillStyle = '#2a3349';
        c.fillRect(rx + 32, 94, 2, 4);
      } else if (room.id === 'meeting') {
        // 화이트보드 옆 벽걸이 시간표
        c.fillStyle = '#2a3349';
        c.fillRect(rx + 22, 98, 24, 14);
        c.fillStyle = '#cbd5e1';
        c.fillRect(rx + 23, 99, 22, 12);
        c.fillStyle = '#94a3b8';
        for (let y = 101; y < 110; y += 3) c.fillRect(rx + 25, y, 18, 1);
        c.fillStyle = '#ef4444';
        c.fillRect(rx + 25, 101, 5, 2);
      } else if (room.id === 'user_desk') {
        // 창문 프레임 (하늘은 시간대 연동 동적 렌더링)
        c.fillStyle = '#2a3349';
        c.fillRect(rx + 8, 60, 46, 36);
        c.fillStyle = '#3a4560';
        c.fillRect(rx + 8, 60, 46, 1);
        c.fillStyle = '#1a2133';
        c.fillRect(rx + 7, 96, 48, 3); // 창틀
        // 액자 사진
        c.fillStyle = '#c27349';
        c.fillRect(rx + 14, 110, 12, 10);
        c.fillStyle = '#7dd3fc';
        c.fillRect(rx + 15, 111, 10, 8);
        c.fillStyle = '#22c55e';
        c.fillRect(rx + 15, 116, 10, 3);
        c.fillStyle = '#fef08a';
        c.fillRect(rx + 21, 112, 2, 2);
      }
    }

    // 시간대 연동 캐시: new Date().getHours()를 30초마다 1회만 호출하여 GC 부담 완화
    let cachedHour = new Date().getHours();
    let lastHourCheckTime = performance.now();
    function getCachedHour() {
      const now = performance.now();
      if (now - lastHourCheckTime >= 30000) {
        cachedHour = new Date().getHours();
        lastHourCheckTime = now;
      }
      return cachedHour;
    }

    // 공기 중 먼지 입자: 매 프레임 rgba 문자열을 동적 생성하지 않고 사전 계산된 문자열 재사용
    const dustParticles = [];
    for (let i = 0; i < 20; i++) {
      const alpha = 0.2 + Math.random() * 0.4;
      dustParticles.push({
        x: Math.random() * 480,
        y: 40 + Math.random() * 160,
        vx: (Math.random() - 0.5) * 0.2,
        vy: (Math.random() - 0.5) * 0.1,
        color: `rgba(255,255,255,${(alpha * 0.4).toFixed(3)})`
      });
    }

    // ----------------------------------------------------
    // G-3. 방 조명: 에이전트가 방에서 일하는 동안 천장 조명이 켜지고 서서히 꺼짐
    // ----------------------------------------------------
    const roomLightLevels = {};
    const roomTintRgb = {};
    for (const key in ROOM_DEFS) {
      roomLightLevels[key] = 0;
      roomTintRgb[key] = hexToRgb(PALETTE[ROOM_DEFS[key].colorIdx]);
    }
    const LIT_STATES = new Set(['WORKING', 'THINKING', 'ASKING', 'REPORTING', 'PONDERING', 'ERROR']);

    function updateRoomLights() {
      const occupied = new Set();
      const agents = Office.getProjectAgents ? Office.getProjectAgents(Office.activeProjectKey) : null;
      if (agents) {
        for (const ag of agents.values()) {
          if (LIT_STATES.has(ag.state)) occupied.add(ag.currentRoom);
        }
      }
      for (const key in roomLightLevels) {
        const target = occupied.has(key) ? 1 : 0;
        const speed = target ? 0.08 : 0.025; // 켜질 땐 빠르게, 꺼질 땐 천천히
        roomLightLevels[key] += (target - roomLightLevels[key]) * speed;
      }
    }

    function drawRoomLight(ctx, room) {
      const level = roomLightLevels[room.id];
      const lampX = Math.round(room.x + (room.w - 2) / 2) - 6;
      // 천장 매입등 (꺼져 있을 땐 어두운 갓만 보임)
      ctx.fillStyle = '#1a2133';
      ctx.fillRect(lampX, 52, 12, 2);
      if (level < 0.02) return;
      ctx.fillStyle = `rgba(255,247,222,${(0.25 + 0.75 * level).toFixed(3)})`;
      ctx.fillRect(lampX + 1, 53, 10, 1);
      const tint = roomTintRgb[room.id];
      const cx = room.x + (room.w - 2) / 2;
      const left = room.x + 1;
      const right = room.x + room.w - 3;

      // 천장 조명 원뿔
      const g = ctx.createLinearGradient(0, 53, 0, FLOOR_Y);
      g.addColorStop(0, rgba(tint, 0.26 * level));
      g.addColorStop(1, rgba(tint, 0.05 * level));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(cx - 9, 53);
      ctx.lineTo(cx + 9, 53);
      ctx.lineTo(right, FLOOR_Y);
      ctx.lineTo(left, FLOOR_Y);
      ctx.closePath();
      ctx.fill();

      // 바닥 빛 웅덩이
      ctx.fillStyle = rgba(tint, 0.22 * level);
      ctx.beginPath();
      ctx.ellipse(cx, FLOOR_Y + 5, (room.w - 6) / 2, 4, 0, 0, Math.PI * 2);
      ctx.fill();

      // 간판 발광
      ctx.fillStyle = rgba(tint, 0.22 * level);
      ctx.fillRect(room.x + 5, 39, room.w - 10, 12);
    }

    function drawEnvironmentPixels(ctx) {
      tickCount++;

      // 1. 정적 배경 (천장, 벽, 징두리, 기둥, 바닥, 벽 장식)
      ctx.drawImage(backgroundCanvas, 0, 0);

      // 2. 실제 시간대 연동 창문 (내 자리, 30초 캐싱)
      drawWindowSky(ctx, ROOM_DEFS.user_desk.x + 10, 62, 42, 32);

      // 3. 각 방 소품 및 동적 장식 (간판 텍스트는 별도 고해상도 패스)
      updateRoomLights();
      for (const key in ROOM_DEFS) {
        const room = ROOM_DEFS[key];
        drawRoomInteriorPixels(ctx, room);
      }
      for (const key in ROOM_DEFS) {
        drawRoomLight(ctx, ROOM_DEFS[key]);
      }

      // 4. 비상구 EXIT 유도등
      ctx.fillStyle = PALETTE[1];
      ctx.fillRect(25, 26, 18, 8);
      ctx.fillStyle = PALETTE[19];
      ctx.fillRect(26, 27, 16, 6);
      ctx.fillStyle = PALETTE[7];
      ctx.font = '6px monospace';
      ctx.fillText('EXIT', 28, 32);

      // 5. 공기 중 먼지 입자 (사전 계산된 p.color 재사용, prefers-reduced-motion 시 이동 정지)
      const isReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      for (const p of dustParticles) {
        if (!isReducedMotion) {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < 0) p.x = 480;
          if (p.x > 480) p.x = 0;
          if (p.y < 40) p.y = 200;
          if (p.y > 200) p.y = 40;
        }
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
      }
    }

    function drawWindowSky(ctx, x, y, w, h) {
      const currentHour = getCachedHour();
      const isNight = currentHour >= 20 || currentHour < 6;
      const isSunset = currentHour >= 17 && currentHour < 20;
      const isDawn = currentHour >= 6 && currentHour < 9;

      const g = ctx.createLinearGradient(0, y, 0, y + h);
      if (isNight) { g.addColorStop(0, '#020617'); g.addColorStop(1, '#1e1b4b'); }
      else if (isSunset) { g.addColorStop(0, '#7c2d12'); g.addColorStop(1, '#f59e0b'); }
      else if (isDawn) { g.addColorStop(0, '#6d28d9'); g.addColorStop(1, '#fda4af'); }
      else { g.addColorStop(0, '#0369a1'); g.addColorStop(1, '#7dd3fc'); }
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);

      if (isNight) {
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(x + 6, y + 4, 1, 1);
        ctx.fillRect(x + 22, y + 8, 1, 1);
        ctx.fillRect(x + 34, y + 3, 1, 1);
        ctx.fillStyle = '#fef9c3';
        ctx.fillRect(x + 30, y + 5, 4, 4); // 달
      } else if (!isSunset) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillRect(x + 8, y + 7, 10, 3); // 구름
        ctx.fillRect(x + 10, y + 5, 5, 2);
      }

      // 도시 스카이라인 실루엣
      ctx.fillStyle = isNight ? '#0b1020' : 'rgba(15,23,42,0.75)';
      ctx.fillRect(x, y + h - 9, 8, 9);
      ctx.fillRect(x + 9, y + h - 15, 9, 15);
      ctx.fillRect(x + 19, y + h - 11, 7, 11);
      ctx.fillRect(x + 27, y + h - 18, 8, 18);
      ctx.fillRect(x + 36, y + h - 8, 6, 8);
      if (isNight) {
        ctx.fillStyle = (tickCount % 90 < 60) ? '#fbbf24' : '#78350f';
        ctx.fillRect(x + 12, y + h - 12, 1, 1);
        ctx.fillRect(x + 30, y + h - 14, 1, 1);
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(x + 15, y + h - 8, 1, 1);
        ctx.fillRect(x + 29, y + h - 9, 1, 1);
      }

      // 창살
      ctx.fillStyle = '#2a3349';
      ctx.fillRect(x + Math.floor(w / 2), y, 2, h);
      ctx.fillRect(x, y + Math.floor(h / 2), w, 1);
      // 유리 반사
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x + 2, y + 2, 1, h - 6);
      ctx.fillRect(x + 3, y + 2, 1, 4);
    }

    function drawRoomInteriorPixels(ctx, room) {
      const rx = room.x;
      const rw = room.w;

      // 상단 방 간판 박스 (텍스트는 고해상도 패스에서 선명하게 렌더링)
      ctx.fillStyle = '#0a0d16';
      ctx.fillRect(rx + 4, 38, rw - 8, 14);
      ctx.strokeStyle = PALETTE[room.colorIdx];
      ctx.lineWidth = 1;
      ctx.strokeRect(rx + 4.5, 38.5, rw - 9, 13);

      // 방별 소품
      if (room.id === 'elevator') {
        ctx.drawImage(PROPS.elevator, rx + 10, FLOOR_Y - 56);
        // 층 표시등: 엘리베이터 이용 중(누군가 엘리베이터 방에 있음)이면 점등
        const busy = roomLightLevels.elevator > 0.3;
        ctx.fillStyle = busy ? '#f59e0b' : '#3f2a0a';
        ctx.fillRect(rx + 19, 141, 3, 3);
        ctx.fillStyle = busy && tickCount % 40 < 20 ? '#fbbf24' : '#3f2a0a';
        ctx.fillRect(rx + 25, 140, 2, 1);
        ctx.fillRect(rx + 24, 141, 4, 1);
        ctx.fillRect(rx + 30, 142, 4, 1);
        ctx.fillRect(rx + 31, 143, 2, 1);
      }
      else if (room.id === 'archive') {
        ctx.drawImage(PROPS.bookshelf, rx + 4, FLOOR_Y - 64);
        ctx.drawImage(PROPS.ladder, rx + 36, FLOOR_Y - 48);
        ctx.drawImage(PROPS.cabinet, rx + rw - 22, FLOOR_Y - 24);
        drawClockHands(ctx, rx + 46, 73);
      }
      else if (room.id === 'dev') {
        ctx.drawImage(PROPS.devDesk, rx + 12, FLOOR_Y - 32);
        ctx.drawImage(PROPS.plant, rx + rw - 14, FLOOR_Y - 18);
        const codeY = (Math.floor(tickCount * 0.1) % 4);
        ctx.fillStyle = PALETTE[19];
        ctx.fillRect(rx + 23, FLOOR_Y - 29 + codeY * 2, 10, 1);
        ctx.fillStyle = PALETTE[23];
        ctx.fillRect(rx + 25, FLOOR_Y - 27 + codeY * 2, 8, 1);
        if (tickCount % 16 < 8) {
          ctx.fillStyle = 'rgba(255,255,255,0.4)';
          ctx.fillRect(rx + 44, FLOOR_Y - 35, 1, 2);
        }
      }
      else if (room.id === 'server') {
        ctx.drawImage(PROPS.rack, rx + 6, FLOOR_Y - 60);
        ctx.drawImage(PROPS.rack, rx + 34, FLOOR_Y - 60);
        ctx.drawImage(PROPS.vent, rx + 20, FLOOR_Y - 6);

        const isBlinkFast = (tickCount % 8 < 4);
        ctx.fillStyle = isBlinkFast ? PALETTE[19] : PALETTE[20];
        ctx.fillRect(rx + 26, FLOOR_Y - 50, 2, 2);
        ctx.fillRect(rx + 54, FLOOR_Y - 42, 2, 2);
        ctx.fillStyle = (!isBlinkFast) ? PALETTE[23] : PALETTE[24];
        ctx.fillRect(rx + 26, FLOOR_Y - 32, 2, 2);
        ctx.fillRect(rx + 54, FLOOR_Y - 22, 2, 2);

        // 패치 패널 포트 LED (작업 중이면 트래픽 증가)
        const busy = roomLightLevels.server > 0.3;
        for (let i = 0; i < 10; i++) {
          const on = ((tickCount >> (busy ? 2 : 4)) + i * 7) % 5 < (busy ? 3 : 1);
          ctx.fillStyle = on ? (i % 3 === 0 ? '#f59e0b' : '#22c55e') : '#14532d';
          ctx.fillRect(rx + 11 + Math.round(i * 4.5), 80, 1, 1);
        }
      }
      else if (room.id === 'research') {
        ctx.drawImage(PROPS.multiScreen, rx + 12, FLOOR_Y - 34);
        ctx.strokeStyle = PALETTE[21];
        ctx.beginPath();
        ctx.arc(rx + 22, FLOOR_Y - 28, 4, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = PALETTE[13];
        ctx.fillRect(rx + rw - 14, FLOOR_Y - 14, 2, 6);
        ctx.fillStyle = PALETTE[22];
        ctx.beginPath();
        ctx.arc(rx + rw - 13, FLOOR_Y - 16, 4, 0, Math.PI * 2);
        ctx.fill();

        // 월드맵 핑 (작업 중이면 여러 지점이 동시에 깜빡임)
        const pings = [[16, 68], [33, 69], [44, 67], [51, 80], [19, 77]];
        const busy = roomLightLevels.research > 0.3;
        const phase = Math.floor(tickCount / 20);
        pings.forEach(([px, py], i) => {
          if (!busy && (phase + i) % 5 !== 0) return;
          const r = (tickCount + i * 9) % 20 < 10;
          ctx.fillStyle = r ? '#f0abfc' : 'rgba(240,171,252,0.4)';
          ctx.fillRect(rx + px, py, 2, 2);
        });
        // 스캔 라인
        ctx.fillStyle = 'rgba(168,85,247,0.25)';
        ctx.fillRect(rx + 8, 62 + (Math.floor(tickCount / 3) % 30), 50, 1);
      }
      else if (room.id === 'meeting') {
        ctx.drawImage(PROPS.whiteboard, rx + 10, 56);
        ctx.fillStyle = PALETTE[4];
        ctx.fillRect(rx + 18, FLOOR_Y - 16, 32, 4);
        ctx.fillStyle = PALETTE[3];
        ctx.fillRect(rx + 32, FLOOR_Y - 12, 4, 12);
        ctx.fillStyle = PALETTE[5];
        ctx.fillRect(rx + 14, FLOOR_Y - 22, 3, 10);
        ctx.fillRect(rx + 51, FLOOR_Y - 22, 3, 10);
      }
      else if (room.id === 'user_desk') {
        ctx.drawImage(PROPS.userDesk, rx + 12, FLOOR_Y - 32);

        ctx.fillStyle = 'rgba(245, 158, 11, 0.08)';
        ctx.beginPath();
        ctx.moveTo(rx + 16, FLOOR_Y - 26);
        ctx.lineTo(rx + 6, FLOOR_Y);
        ctx.lineTo(rx + 36, FLOOR_Y);
        ctx.fill();

        // [토큰 미터] 사용량 정보가 있는 세션만 책상 위에 코인 저금통 & 코인 스택 연출
        if (currentProjectTokenUsage && currentProjectTokenUsage.hasData) {
          drawDeskPiggyBankPixels(ctx, rx + 12, FLOOR_Y - 32, currentProjectTokenUsage);
        }

        if (mainAgent && mainAgent.state === 'ASKING') {
          const bounce = Math.sin(tickCount * 0.2) * 2;
          ctx.fillStyle = PALETTE[14];
          ctx.fillRect(rx + 24, FLOOR_Y - 45 + bounce, 4, 7);
          ctx.fillRect(rx + 24, FLOOR_Y - 36 + bounce, 4, 2);
        }
      }
    }

    // 자료실 벽시계: 실제 시각 시/분침
    let clockCache = { t: 0, h: 0, m: 0 };
    function drawClockHands(ctx, cx, cy) {
      const nowMs = Date.now();
      if (nowMs - clockCache.t > 10000) {
        const d = new Date();
        clockCache = { t: nowMs, h: (d.getHours() % 12) + d.getMinutes() / 60, m: d.getMinutes() };
      }
      const ha = (clockCache.h / 12) * Math.PI * 2 - Math.PI / 2;
      const ma = (clockCache.m / 60) * Math.PI * 2 - Math.PI / 2;
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx + 0.5, cy + 0.5);
      ctx.lineTo(cx + 0.5 + Math.cos(ha) * 3.5, cy + 0.5 + Math.sin(ha) * 3.5);
      ctx.moveTo(cx + 0.5, cy + 0.5);
      ctx.lineTo(cx + 0.5 + Math.cos(ma) * 5.5, cy + 0.5 + Math.sin(ma) * 5.5);
      ctx.stroke();
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(cx, cy, 1, 1);
    }

    // ----------------------------------------------------
    // F-3. 내 자리 책상 위 핑크 돼지 저금통 & 코인 스택 렌더링
    // ----------------------------------------------------
    function drawDeskPiggyBankPixels(ctx, deskX, deskY, usage) {
      if (!usage || !usage.hasData) return;

      const tableY = deskY + 16;
      const piggyX = deskX + 24;
      const piggyY = tableY - 6;

      // 1. 핑크 돼지 저금통 (7x6 픽셀아트)
      ctx.fillStyle = '#f472b6'; // 핑크 몸체
      ctx.fillRect(piggyX + 1, piggyY + 1, 5, 4);
      // 귀 2개
      ctx.fillRect(piggyX + 1, piggyY, 1, 1);
      ctx.fillRect(piggyX + 3, piggyY, 1, 1);
      // 주둥이/코
      ctx.fillStyle = '#fb7185';
      ctx.fillRect(piggyX + 5, piggyY + 2, 2, 2);
      // 눈
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(piggyX + 4, piggyY + 2, 1, 1);
      // 다리 2개
      ctx.fillStyle = '#db2777';
      ctx.fillRect(piggyX + 2, piggyY + 5, 1, 1);
      ctx.fillRect(piggyX + 4, piggyY + 5, 1, 1);
      // 동전 투입구 슬롯
      ctx.fillStyle = '#9d174d';
      ctx.fillRect(piggyX + 2, piggyY + 1, 2, 1);

      // 2. 누적 토큰에 따른 코인 스택 (1만 토큰당 1개, 최대 14개 제한)
      const total = usage.totalTokens || 0;
      let coinCount = Math.floor(total / 10000);
      if (total > 0 && coinCount === 0) coinCount = 1;
      const maxCoins = 14;
      const totalCoins = Math.min(coinCount, maxCoins);

      // 스택 1: 저금통 우측 (deskX + 32, 폭 4px, 최대 8코인)
      const stack1Coins = Math.min(totalCoins, 8);
      const stack1X = deskX + 32;
      for (let i = 0; i < stack1Coins; i++) {
        const coinY = tableY - 1 - i;
        ctx.fillStyle = '#f59e0b'; // 골드
        ctx.fillRect(stack1X, coinY, 4, 1);
        ctx.fillStyle = (i % 2 === 0) ? '#fef08a' : '#fbbf24'; // 하이라이트
        ctx.fillRect(stack1X + 1, coinY, 2, 1);
      }

      // 스택 2: 8개 초과 시 저금통 좌측 (deskX + 20, 폭 3px, 최대 6코인)
      const stack2Coins = Math.max(0, totalCoins - 8);
      const stack2X = deskX + 20;
      for (let i = 0; i < stack2Coins; i++) {
        const coinY = tableY - 1 - i;
        ctx.fillStyle = '#d97706';
        ctx.fillRect(stack2X, coinY, 3, 1);
        ctx.fillStyle = '#fef08a';
        ctx.fillRect(stack2X + 1, coinY, 1, 1);
      }

      // 3. 토큰 발생/활동 중 미세 코인 반짝임 연출
      if (tickCount % 24 < 12 && total > 0) {
        ctx.fillStyle = '#fde047';
        ctx.fillRect(piggyX + 2, piggyY - 2, 2, 1);
      }
    }

    // 960x540 해상도에서 방 이름 간판을 칼같이 선명하게 렌더링
    function drawRoomSignLabels(ctx) {
      ctx.save();
      ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (const key in ROOM_DEFS) {
        const room = ROOM_DEFS[key];
        const cx = Math.round((room.x + room.w / 2) * 2);
        const cy = Math.round(45 * 2); // 38~52 가운데인 45의 2배

        // 미세 그림자
        ctx.fillStyle = '#0a0d18';
        ctx.fillText(room.name, cx + 1, cy + 1);

        // 네온 텍스트 본체
        ctx.fillStyle = PALETTE[room.colorIdx];
        ctx.fillText(room.name, cx, cy);
      }
      ctx.restore();
    }

    // drawBadgeLabel의 measureText 말줄임 루프 캐시 ((텍스트, 최대폭) 키, 최대 200개, 초과 시 LRU 제거)
    const badgeTruncateCache = new Map();
    const MAX_BADGE_CACHE_SIZE = 200;

    function getTruncatedBadgeText(ctx, text, maxW) {
      if (!text) return '';
      const cacheKey = `${text}__${maxW}`;
      if (badgeTruncateCache.has(cacheKey)) {
        const cached = badgeTruncateCache.get(cacheKey);
        badgeTruncateCache.delete(cacheKey);
        badgeTruncateCache.set(cacheKey, cached);
        return cached;
      }

      let displayText = text;
      const targetW = maxW - 12;
      if (ctx.measureText(displayText).width > targetW) {
        while (displayText.length > 3 && ctx.measureText(displayText + '...').width > targetW) {
          displayText = displayText.slice(0, -1);
        }
        displayText += '...';
      }

      if (badgeTruncateCache.size >= MAX_BADGE_CACHE_SIZE) {
        const oldestKey = badgeTruncateCache.keys().next().value;
        badgeTruncateCache.delete(oldestKey);
      }
      badgeTruncateCache.set(cacheKey, displayText);
      return displayText;
    }

    // ----------------------------------------------------
    // G-1. 고해상도 방별 상세 작업 라벨 및 전광판 렌더링
    // ----------------------------------------------------
    function drawBadgeLabel(ctx, cx, cy, text, opts) {
      ctx.save();
      ctx.globalAlpha = opts.alpha || 1;
      ctx.font = opts.font || 'bold 10px -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif';
      ctx.textBaseline = 'middle';

      // 긴 텍스트 말줄임(...) 처리 (결과 캐시 재사용)
      const maxW = opts.maxW || 104;
      const displayText = getTruncatedBadgeText(ctx, text, maxW);

      const tw = ctx.measureText(displayText).width;
      const bw = Math.max(tw + 12, 28);
      const bh = 17;
      const bx = Math.round(cx - bw / 2);
      const by = Math.round(cy - bh / 2);

      // 미세 그림자
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(bx + 1, by + 1, bw, bh);

      // 배지 배경
      ctx.fillStyle = opts.bg || '#0f172a';
      ctx.fillRect(bx, by, bw, bh);

      // 픽셀 테두리
      ctx.strokeStyle = opts.border || '#38bdf8';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);

      // 네이티브 텍스트 렌더링
      ctx.textAlign = 'center';
      ctx.fillStyle = opts.text || '#f8fafc';
      ctx.fillText(displayText, cx, cy);

      ctx.restore();
    }

    // 서버실 랙 위 전자 전광판 (흐르는 글자 / Marquee)
    function drawServerTicker(ctx, x, y, w, h, text, offset, alpha) {
      ctx.save();
      ctx.globalAlpha = alpha;

      // 외곽 베젤
      ctx.fillStyle = '#050a0f';
      ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
      ctx.strokeStyle = '#065f46';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 1.5, y - 1.5, w + 3, h + 3);

      // 전광판 내부 스크린 (매트릭스 딥그린)
      ctx.fillStyle = '#02180e';
      ctx.fillRect(x, y, w, h);

      // 클리핑: 전광판 내부 안에서만 텍스트가 흐르도록
      ctx.beginPath();
      ctx.rect(x + 2, y, w - 4, h);
      ctx.clip();

      ctx.font = 'bold 9.5px "Courier New", Courier, monospace';
      ctx.fillStyle = '#34d399'; // 네온 에메랄드
      ctx.textBaseline = 'middle';

      // 텍스트 앞 50자 슬라이스
      const displayStr = text.length > 50 ? text.slice(0, 50) : text;
      const tw = ctx.measureText(displayStr).width;
      const cy = y + h / 2;

      if (tw <= w - 8) {
        ctx.textAlign = 'center';
        ctx.fillText(displayStr, x + w / 2, cy);
      } else {
        ctx.textAlign = 'left';
        const loopW = tw + 28;
        const scrollX = x + 4 - (offset % loopW);
        ctx.fillText(displayStr, scrollX, cy);
        ctx.fillText(displayStr, scrollX + loopW, cy);
      }

      ctx.restore();
    }

    // 방별 작업 상세 라벨 통합 드로잉 (Pass 2 네이티브 해상도)
    function drawRoomTaskLabels(ctx) {
      const currentTasks = getProjectTaskStates(activeProjectKey);
      if (!currentTasks) return;

      // 1. 자료실 (archive): 책상 위 라벨
      const archive = currentTasks.archive;
      if (archive && archive.opacity > 0 && archive.text) {
        drawBadgeLabel(ctx, 224, 348, archive.prefix + archive.text, {
          bg: '#25170c',
          border: '#d97706',
          text: '#fef3c7',
          alpha: archive.opacity,
          maxW: 104,
          font: 'bold 10px -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif'
        });
      }

      // 2. 개발실 (dev): 아이맥 위 라벨
      const dev = currentTasks.dev;
      if (dev && dev.opacity > 0 && dev.text) {
        drawBadgeLabel(ctx, 296, 336, dev.prefix + dev.text, {
          bg: '#0f172a',
          border: '#38bdf8',
          text: '#e0f2fe',
          alpha: dev.opacity,
          maxW: 108,
          font: 'bold 10px "Courier New", Courier, monospace'
        });
      }

      // 3. 서버실 (server): 랙 위 작은 전광판 흐르는 글자
      const server = currentTasks.server;
      if (server && server.opacity > 0 && server.text) {
        drawServerTicker(ctx, 410, 268, 104, 18, server.prefix + server.text, server.tickerOffset, server.opacity);
      }

      // 4. 정보검색실 (research): 모니터 위 라벨
      const research = currentTasks.research;
      if (research && research.opacity > 0 && research.text) {
        drawBadgeLabel(ctx, 588, 330, research.prefix + research.text, {
          bg: '#1e1b4b',
          border: '#a855f7',
          text: '#f5d0fe',
          alpha: research.opacity,
          maxW: 110,
          font: 'bold 10px -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif'
        });
      }

      // 5. 회의실 (meeting): 화이트보드 및 회의 테이블 상단 계획/사고 라벨
      const meeting = currentTasks.meeting;
      if (meeting && meeting.opacity > 0 && meeting.text) {
        drawBadgeLabel(ctx, 744, 210, meeting.prefix + meeting.text, {
          bg: '#1c1033',
          border: '#a855f7',
          text: '#f3e8ff',
          alpha: meeting.opacity,
          maxW: 114,
          font: 'bold 10px -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif'
        });
      }

      // 6. 내 자리 (user_desk): 토큰 사용량 정보가 있을 때 책상 위 코인 뱃지
      if (currentProjectTokenUsage && currentProjectTokenUsage.hasData) {
        const deskX = (410 + 12 + 28) * 2;
        const deskY = (FLOOR_Y - 32 + 5) * 2;
        const tokenBadgeText = 'TOK ' + formatCompactTokenCount(currentProjectTokenUsage.totalTokens);
        drawBadgeLabel(ctx, deskX, deskY, tokenBadgeText, {
          bg: '#1c1917',
          border: '#f59e0b',
          text: '#fef08a',
          alpha: 0.95,
          maxW: 76,
          font: 'bold 9.5px monospace'
        });
      }
    }

    // 각 방 작업 라벨 상태 갱신 (전광판 스크롤 및 1초 뒤 페이드아웃, 30분 비활성 프로젝트 정리)
    function updateRoomTaskStates(dt, now) {
      for (const [pKey, roomMap] of projectRoomTaskStates.entries()) {
        // 30분 이상 활동 없고 현재 보고 있지 않은 프로젝트 정리
        if (pKey !== activeProjectKey && roomMap.lastActiveTime && (now - roomMap.lastActiveTime > 30 * 60 * 1000)) {
          projectRoomTaskStates.delete(pKey);
          continue;
        }

        for (const r in roomMap) {
          if (r === 'lastActiveTime') continue;
          const task = roomMap[r];
          if (!task.text) continue;
          if (task.active) {
            task.opacity = 1;
            task.tickerOffset += dt * 38; // 38px/s 티커 스크롤
          } else if (task.endTime > 0) {
            const elapsed = now - task.endTime;
            if (elapsed < 1000) {
              task.opacity = 1; // 작업 종료 후 1초 동안 유지
            } else if (elapsed < 1800) {
              // 1초 뒤부터 0.8초 동안 부드럽게 페이드아웃
              task.opacity = Math.max(0, 1 - (elapsed - 1000) / 800);
            } else {
              task.opacity = 0;
              task.text = '';
              task.endTime = 0;
            }
          }
        }
      }
    }

    // ----------------------------------------------------
    // 실시간 24h 조명 사이클 (새벽/주간/일몰/심야 앰비언트 & 나이트 포인트 라이트)
    // ----------------------------------------------------
    function drawAmbientLighting(ctx) {
      const currentHour = getCachedHour();

      // 06:00 ~ 08:59: 새벽 (Dawn) - 은은한 쿨 퍼플/핑크 아침 햇살
      if (currentHour >= 6 && currentHour < 9) {
        ctx.save();
        ctx.fillStyle = 'rgba(168, 85, 247, 0.07)';
        ctx.fillRect(0, 0, 480, 270);
        ctx.restore();
      }
      // 17:00 ~ 19:59: 일몰 (Sunset/Golden Hour) - 따뜻한 황금빛 앰버 글로우
      else if (currentHour >= 17 && currentHour < 20) {
        ctx.save();
        ctx.fillStyle = 'rgba(245, 158, 11, 0.10)';
        ctx.fillRect(0, 0, 480, 270);
        ctx.restore();
      }
      // 20:00 ~ 05:59: 심야 (Night) - 깊은 사이버펑크 미드나잇 틴트 & 룸 포인트 라이트 글로우
      else if (currentHour >= 20 || currentHour < 6) {
        ctx.save();
        ctx.fillStyle = 'rgba(6, 11, 28, 0.28)';
        ctx.fillRect(0, 0, 480, 270);

        // 포인트 라이트 1: 서버실 랙 네온 블루 글로우 (x=230)
        const gradServer = ctx.createRadialGradient(230, FLOOR_Y - 25, 4, 230, FLOOR_Y - 25, 42);
        gradServer.addColorStop(0, 'rgba(56, 189, 248, 0.22)');
        gradServer.addColorStop(1, 'rgba(56, 189, 248, 0)');
        ctx.fillStyle = gradServer;
        ctx.fillRect(180, FLOOR_Y - 65, 100, 75);

        // 포인트 라이트 2: 개발실 모니터 에메랄드 글로우 (x=162)
        const gradDev = ctx.createRadialGradient(162, FLOOR_Y - 20, 2, 162, FLOOR_Y - 20, 36);
        gradDev.addColorStop(0, 'rgba(52, 211, 153, 0.18)');
        gradDev.addColorStop(1, 'rgba(52, 211, 153, 0)');
        ctx.fillStyle = gradDev;
        ctx.fillRect(125, FLOOR_Y - 55, 75, 65);

        // 포인트 라이트 3: 사용자 책상 스탠드 조명 (x=440)
        const gradDesk = ctx.createRadialGradient(442, FLOOR_Y - 22, 2, 442, FLOOR_Y - 22, 38);
        gradDesk.addColorStop(0, 'rgba(251, 191, 36, 0.22)');
        gradDesk.addColorStop(1, 'rgba(251, 191, 36, 0)');
        ctx.fillStyle = gradDesk;
        ctx.fillRect(400, FLOOR_Y - 60, 80, 70);

        ctx.restore();
      }
    }


  Object.assign(Office, {
    ROOM_DEFS,
    FLOOR_Y,
    TOOL_PARAM_MAPPINGS,
    extractBasename,
    maskSensitive,
    extractTaskDetail,
    projectRoomTaskStates,
    getProjectTaskStates,
    setRoomTaskStart,
    setRoomTaskEnd,
    finishAllRoomTasks,
    dustParticles,
    drawEnvironmentPixels,
    drawAmbientLighting,
    drawRoomInteriorPixels,
    drawRoomSignLabels,
    drawBadgeLabel,
    drawServerTicker,
    drawRoomTaskLabels,
    updateRoomTaskStates
  });

  window.ROOM_DEFS = ROOM_DEFS;
  window.FLOOR_Y = FLOOR_Y;
  window.TOOL_PARAM_MAPPINGS = TOOL_PARAM_MAPPINGS;
  window.extractBasename = extractBasename;
  window.maskSensitive = maskSensitive;
  window.extractTaskDetail = extractTaskDetail;
  window.projectRoomTaskStates = projectRoomTaskStates;
  window.getProjectTaskStates = getProjectTaskStates;
  window.setRoomTaskStart = setRoomTaskStart;
  window.setRoomTaskEnd = setRoomTaskEnd;
  window.finishAllRoomTasks = finishAllRoomTasks;
  window.dustParticles = dustParticles;
  window.drawEnvironmentPixels = drawEnvironmentPixels;
  window.drawAmbientLighting = drawAmbientLighting;
  window.drawRoomInteriorPixels = drawRoomInteriorPixels;
  window.drawRoomSignLabels = drawRoomSignLabels;
  window.drawBadgeLabel = drawBadgeLabel;
  window.drawServerTicker = drawServerTicker;
  window.drawRoomTaskLabels = drawRoomTaskLabels;
  window.updateRoomTaskStates = updateRoomTaskStates;

})(window);
