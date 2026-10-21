/**
 * 에이전트 오피스 (Agent Office) - 사무실 평면도 & 작업 상태 모듈 (public/js/rooms.js)
 * 아이소메트릭 평면도의 방 배치(타일 좌표), 도구 인자 매핑, 방별 실시간 작업 상태
 */

(function(window) {
  'use strict';

  const Office = window.Office = window.Office || {};

    // ----------------------------------------------------
    // E. 평면도 (타일 좌표계: x = 오른쪽 아래, y = 왼쪽 아래 방향)
    // ----------------------------------------------------
    // 뒤쪽 줄: 자료실 | 개발실 | 서버실
    // 가운데: 복도 (y 7 ~ 9)
    // 앞쪽 줄: 엘리베이터 | 정보검색실 | 회의실 | 내 자리
    const WORLD = { w: 26, d: 18, hallY0: 7, hallY1: 9, hallMidY: 8 };

    const ROOM_DEFS = {
      archive:   { id: 'archive',   name: '자료실',     sub: '파일 읽기 · 검색',   x0: 0,  y0: 0, x1: 8,  y1: 7,  doorX: 4,    spot: [4, 5.9],      floor: '#eadbc8', accent: '#d97706', row: 'back' },
      dev:       { id: 'dev',       name: '개발실',     sub: '코드 작성 · 수정',   x0: 8,  y0: 0, x1: 17, y1: 7,  doorX: 12.5, spot: [12.5, 3.6],  floor: '#dbe3f1', accent: '#4f6bed', row: 'back' },
      server:    { id: 'server',    name: '서버실',     sub: '명령 실행 · git',    x0: 17, y0: 0, x1: 26, y1: 7,  doorX: 21.5, spot: [21.5, 3.3],  floor: '#d6dae4', accent: '#475569', row: 'back' },
      elevator:  { id: 'elevator',  name: '엘리베이터', sub: '출퇴근 · 위임',      x0: 0,  y0: 9, x1: 4,  y1: 18, doorX: 2,    spot: [1.1, 12],    floor: '#e2e5ec', accent: '#64748b', row: 'front' },
      research:  { id: 'research',  name: '정보검색실', sub: '웹 · MCP 도구',      x0: 4,  y0: 9, x1: 11, y1: 18, doorX: 7.5,  spot: [7.5, 13.3],  floor: '#d5eee6', accent: '#0f9f7a', row: 'front' },
      meeting:   { id: 'meeting',   name: '회의실',     sub: '계획 · 생각',        x0: 11, y0: 9, x1: 19, y1: 18, doorX: 15,   spot: [15, 15.2],   floor: '#e5ddf6', accent: '#7c5cdb', row: 'front' },
      user_desk: { id: 'user_desk', name: '내 자리',    sub: '질문 · 보고',        x0: 19, y0: 9, x1: 26, y1: 18, doorX: 22.5, spot: [22.5, 12.9], floor: '#f3e4d4', accent: '#e8853a', row: 'front' }
    };

    // 하위 호환: 방 이름 조회용 (예전 코드가 ROOM_DEFS[id].name 사용)
    function getRoomAt(x, y) {
      for (const key in ROOM_DEFS) {
        const r = ROOM_DEFS[key];
        if (x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1) return r;
      }
      return null;
    }

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

    // mcp__Claude_Browser__computer → "Claude Browser · computer"
    function prettyToolName(name) {
      if (!name || typeof name !== 'string') return '';
      const m = name.match(/^mcp__(.+?)__(.+)$/);
      if (!m) return name;
      const server = m[1].replace(/^plugin_[^_]+_/, '').replace(/[_-]+/g, ' ').trim();
      return `${server} · ${m[2].replace(/_/g, ' ')}`;
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
        detail = prettyToolName(toolName);
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
      const key = pKey || Office.activeProjectKey || 'default';
      if (!projectRoomTaskStates.has(key)) {
        projectRoomTaskStates.set(key, {
          lastActiveTime: performance.now(),
          dev: { text: '', prefix: '', active: false, endTime: 0, opacity: 0, tickerOffset: 0 },
          server: { text: '', prefix: '', active: false, endTime: 0, opacity: 0, tickerOffset: 0 },
          archive: { text: '', prefix: '', active: false, endTime: 0, opacity: 0, tickerOffset: 0 },
          research: { text: '', prefix: '', active: false, endTime: 0, opacity: 0, tickerOffset: 0 },
          meeting: { text: '', prefix: '', active: false, endTime: 0, opacity: 0, tickerOffset: 0 },
          user_desk: { text: '', prefix: '', active: false, endTime: 0, opacity: 0, tickerOffset: 0 },
          elevator: { text: '', prefix: '', active: false, endTime: 0, opacity: 0, tickerOffset: 0 }
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


    function updateRoomTaskStates(dt, now) {
      for (const [pKey, roomMap] of projectRoomTaskStates.entries()) {
        // 30분 이상 활동 없고 현재 보고 있지 않은 프로젝트 정리
        if (pKey !== Office.activeProjectKey && roomMap.lastActiveTime && (now - roomMap.lastActiveTime > 30 * 60 * 1000)) {
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


  Object.assign(Office, {
    WORLD,
    ROOM_DEFS,
    getRoomAt,
    TOOL_PARAM_MAPPINGS,
    extractBasename,
    prettyToolName,
    maskSensitive,
    extractTaskDetail,
    projectRoomTaskStates,
    getProjectTaskStates,
    setRoomTaskStart,
    setRoomTaskEnd,
    finishAllRoomTasks,
    updateRoomTaskStates
  });

  window.ROOM_DEFS = ROOM_DEFS;
  window.extractTaskDetail = extractTaskDetail;
  window.getProjectTaskStates = getProjectTaskStates;
  window.setRoomTaskStart = setRoomTaskStart;
  window.setRoomTaskEnd = setRoomTaskEnd;
  window.finishAllRoomTasks = finishAllRoomTasks;
  window.updateRoomTaskStates = updateRoomTaskStates;

})(window);
