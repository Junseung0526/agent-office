/**
 * 에이전트 오피스 (Agent Office) - 메인 실행 모듈 (public/js/main.js)
 * 캔버스 초기화, 렌더 루프, SSE 실시간 수신 및 이벤트 디스패처
 */

(function(window) {
  'use strict';

  const Office = window.Office = window.Office || {};

  const canvas = document.getElementById('officeCanvas');
  const ctx = canvas.getContext('2d');

  Office.canvas = canvas;
  Office.ctx = ctx;
  window.canvas = canvas;
  window.ctx = ctx;

  // 1. 도트 그래픽 전용 480x270 오프스크린 캔버스 (정수 1x 도트 좌표계 유지)
  const dotCanvas = document.createElement('canvas');
  dotCanvas.width = 480;
  dotCanvas.height = 270;
  const dotCtx = dotCanvas.getContext('2d');

  // 2. 동적 캔버스 버퍼 해상도 관리 (ResizeObserver + 디바운스 100ms)
  let canvasDisplayWidth = 960;
  let canvasDisplayHeight = 540;
  Office.canvasDisplayWidth = canvasDisplayWidth;
  Office.canvasDisplayHeight = canvasDisplayHeight;

  function updateCanvasBufferSize() {
    const rect = canvas.getBoundingClientRect();
    const displayW = Math.round(rect.width) || 960;
    const displayH = Math.round(rect.height) || Math.round(displayW * 9 / 16);
    const dpr = window.devicePixelRatio || 1;

    const targetBufferW = Math.max(480, Math.round(displayW * dpr));
    const targetBufferH = Math.max(270, Math.round(displayH * dpr));

    if (canvas.width !== targetBufferW || canvas.height !== targetBufferH) {
      canvas.width = targetBufferW;
      canvas.height = targetBufferH;
    }
    canvasDisplayWidth = displayW;
    canvasDisplayHeight = displayH;
    Office.canvasDisplayWidth = canvasDisplayWidth;
    Office.canvasDisplayHeight = canvasDisplayHeight;
  }

  // 초기 로드 시 1회 즉시 버퍼 크기 초기화
  updateCanvasBufferSize();

  let resizeDebounceTimer = null;
  const canvasResizeObserver = new ResizeObserver(() => {
    if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
    resizeDebounceTimer = setTimeout(() => {
      updateCanvasBufferSize();
    }, 100);
  });
  if (canvas.parentElement) {
    canvasResizeObserver.observe(canvas.parentElement);
  }
  window.addEventListener('resize', () => {
    if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
    resizeDebounceTimer = setTimeout(() => {
      updateCanvasBufferSize();
    }, 100);
  });

  const mainAgent = getProjectAgents(Office.activeProjectKey).get('main');
  Office.mainAgent = mainAgent;
  window.mainAgent = mainAgent;

  // 3. 작은 화면(표시 폭 520px 미만) 반응형 대응: 캐릭터 이름표 숨김 및 말풍선 최소 폰트 크기 보장
  if (window.PixelAgent && PixelAgent.prototype) {
    const origDrawSharpUI = PixelAgent.prototype.drawSharpUI;
    PixelAgent.prototype.drawSharpUI = function(tCtx) {
      if (this.state === 'GONE') return;
      const displayW = Office.canvasDisplayWidth || 960;

      // 520px 이상 화면에서만 캐릭터 이름표 렌더링
      if (displayW >= 520) {
        const rx = Math.round(this.x * 2);
        const ry = Math.round(this.y * 2);
        tCtx.save();
        tCtx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';
        tCtx.textAlign = 'center';
        tCtx.fillStyle = '#0f172a';
        tCtx.fillText(this.role, rx + 1, ry - 57);
        tCtx.fillStyle = '#cbd5e1';
        tCtx.fillText(this.role, rx, ry - 58);
        tCtx.restore();
      }

      // 말풍선 렌더링
      if (this.speechBubble) {
        const rx = Math.round(this.x * 2);
        const ry = Math.round(this.y * 2);
        this.drawSharpSpeechBubble(tCtx, this.speechBubble, rx, ry - 66);
      }
    };

    const origDrawSpeechBubble = PixelAgent.prototype.drawSharpSpeechBubble;
    PixelAgent.prototype.drawSharpSpeechBubble = function(tCtx, bubble, bx, by) {
      const displayW = Office.canvasDisplayWidth || 960;
      if (displayW >= 520) {
        return origDrawSpeechBubble.call(this, tCtx, bubble, bx, by);
      }
      // 표시 폭 520px 미만 모바일: 최소 10px 이상의 가독성을 보장하도록 논리 폰트 스케일 보정
      const scale = Math.max(0.2, displayW / 960);
      const minScreenPx = 10;
      const logicalFontSize = Math.max(13, Math.round(minScreenPx / scale));

      tCtx.save();
      tCtx.font = `bold ${logicalFontSize}px -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif`;
      let text = bubble.text || '';
      if (text.length > 28) text = text.slice(0, 26) + '...';

      const metrics = tCtx.measureText(text);
      const padding = 10;
      const bw = Math.max(80, Math.min(420, Math.round(metrics.width + padding * 2)));
      const bh = Math.round(logicalFontSize * 2);

      let bgHex = '#111827';
      let borderHex = '#4b5563';
      let textHex = '#f9fafb';
      if (bubble.type === 'think') {
        bgHex = '#1e1035'; borderHex = '#8b5cf6'; textHex = '#f3e8ff';
      } else if (bubble.type === 'tool') {
        bgHex = '#06281e'; borderHex = '#10b981'; textHex = '#ecfdf5';
      } else if (bubble.type === 'ask') {
        bgHex = '#2d1502'; borderHex = '#f59e0b'; textHex = '#fffbeb';
      } else if (bubble.type === 'error') {
        bgHex = '#300808'; borderHex = '#ef4444'; textHex = '#fef2f2';
      }

      const x = Math.max(10, Math.min(950 - bw, Math.round(bx - bw / 2)));
      const y = Math.round(by - bh);

      tCtx.fillStyle = 'rgba(0,0,0,0.6)';
      tCtx.fillRect(x + 2, y + 2, bw, bh);
      tCtx.fillStyle = bgHex;
      tCtx.fillRect(x, y, bw, bh);
      tCtx.strokeStyle = borderHex;
      tCtx.lineWidth = 1.5;
      tCtx.strokeRect(x + 0.5, y + 0.5, bw - 1, bh - 1);

      tCtx.textAlign = 'center';
      tCtx.textBaseline = 'middle';
      tCtx.fillStyle = textHex;
      tCtx.fillText(text, x + bw / 2, y + bh / 2);
      tCtx.restore();
    };
  }

  let lastFrameTime = performance.now();
  function renderLoop(now) {
    const dt = Math.min((now - lastFrameTime) / 1000, 0.1);
    lastFrameTime = now;

    // 1. 현재 활성 프로젝트 층의 에이전트 엔티티 상태 업데이트
    const currentAgents = getProjectAgents(Office.activeProjectKey);
    for (const [_, ag] of currentAgents.entries()) {
      ag.update(dt);
    }

    // 1-1. 각 방 상세 작업 라벨 및 전광판 상태 업데이트 (티커 스크롤 및 페이드아웃)
    updateRoomTaskStates(dt, now);

    // 2. 패스 1: 480x270 오프스크린 캔버스에 도트 그래픽 렌더링 후 메인 버퍼에 확대 복사
    // imageSmoothingEnabled = false로 고전 도트 질감 및 정수 배율 선명도 유지
    dotCtx.imageSmoothingEnabled = false;
    drawEnvironmentPixels(dotCtx);
    for (const [_, ag] of currentAgents.entries()) {
      ag.drawPixels(dotCtx);
    }

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(dotCanvas, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    // 3. 패스 2: 선명한 고해상도 텍스트 (960x540 논리 좌표계를 실제 버퍼 해상도로 스케일링)
    ctx.save();
    const textScale = canvas.width / 960;
    ctx.scale(textScale, textScale);
    ctx.imageSmoothingEnabled = true;

    drawRoomSignLabels(ctx);
    drawRoomTaskLabels(ctx);

    for (const [_, ag] of currentAgents.entries()) {
      ag.drawSharpUI(ctx);
    }
    ctx.restore();

    requestAnimationFrame(renderLoop);
  }
  requestAnimationFrame(renderLoop);


    function handleEvent(ev) {
      if (!ev) return;
      const pKey = ev.projectKey || Office.activeProjectKey || 'default';
      const isCurrentFloor = (pKey === Office.activeProjectKey || !Office.activeProjectKey);

      // 프로젝트별 이벤트 로그 버퍼에 보관 (최대 100개)
      if (!Office.projectLogsMap) Office.projectLogsMap = new Map();
      if (!Office.projectLogsMap.has(pKey)) Office.projectLogsMap.set(pKey, []);
      const logs = Office.projectLogsMap.get(pKey);
      logs.push(ev);
      if (logs.length > 100) logs.shift();

      // 프로젝트별 최신 이벤트 상태 보관
      if (!Office.projectLastEventMap) Office.projectLastEventMap = new Map();
      Office.projectLastEventMap.set(pKey, ev);

      // 알림 매니저 전달 (백그라운드 프로젝트의 ask_user / 에러 감지 및 데스크톱 알림)
      NotificationManager.handleEvent(ev);

      // 토큰 사용량 정보 실시간 갱신
      if (ev.tokenUsage) {
        const p = (Office.projectsList || []).find(x => x.projectKey === pKey);
        if (p) p.tokenUsage = ev.tokenUsage;
        if (isCurrentFloor) {
          currentProjectTokenUsage = ev.tokenUsage;
          Office.currentProjectTokenUsage = ev.tokenUsage;
          updateTokenMeterDisplay(currentProjectTokenUsage);
        }
      }

      // 이벤트 대상 프로젝트의 에이전트 맵 조회
      const targetAgents = getProjectAgents(pKey);
      let targetAgent = targetAgents.get(ev.agentId);
      if (!targetAgent) {
        if (ev.agentId && ev.agentId.startsWith('sub_')) {
          targetAgent = new PixelAgent(ev.agentId, ev.subagentRole || '서브에이전트', 'sub');
          targetAgent.x = ROOM_DEFS.elevator.targetX;
          targetAgents.set(ev.agentId, targetAgent);
        } else {
          targetAgent = targetAgents.get('main');
        }
      }

      if (targetAgent) {
        targetAgent.lastEventTime = Date.now();

        // 1. 퇴근 타이머 레이스 방지: 어떤 새 이벤트라도 오면 퇴근 타이머 즉시 취소
        targetAgent.cancelLeaving();

        // 2. GONE 또는 LEAVING 상태에서 새 이벤트가 오면 엘리베이터에서 즉시 출근시켜 좌표 고착 방지
        const destRoom = ev.room || (ev.action === 'ask_user' || ev.action === 'turn_finish' ? 'user_desk' : 'meeting');
        if (targetAgent.state === 'GONE' || targetAgent.state === 'LEAVING') {
          targetAgent.reviveIfGone(destRoom);
        }

        if (ev.action === 'thinking') {
          if (!ev.replay && isCurrentFloor) playSound('think');
          const thinkMsg = `💭 ${ev.thinkingText?.slice(0, 30) || '생각 중...'}`;

          // WALKING 중이면 멈추지 않고 걸으면서 말풍선만 표시 후 도착 시 THINKING 전이
          if (targetAgent.state === 'WALKING') {
            targetAgent.setSpeech('think', thinkMsg);
            targetAgent.onArrivedAction = 'THINKING';
          } else {
            targetAgent.state = 'THINKING';
            targetAgent.setSpeech('think', thinkMsg);
          }
        } else if (ev.action === 'tool_start') {
          const targetRoom = ev.room || 'research';
          const toolKey = ev.toolUseId || ev.id || `${ev.toolName || 'tool'}_${Date.now()}`;

          // 병렬 도구 호출 추적 등록
          targetAgent.activeTools.set(toolKey, {
            toolName: ev.toolName,
            room: targetRoom,
            startTime: Date.now()
          });
          targetAgent.lastToolActivityTime = Date.now();

          setRoomTaskStart(pKey, targetRoom, ev.toolName, ev.toolArgs, ev.toolSummary);
          const detail = extractTaskDetail(targetRoom, ev.toolName, ev.toolArgs, ev.toolSummary);
          const workSpeech = { type: 'work', text: `⚙️ ${detail.prefix}${detail.text}`, duration: 4500 };

          // 목적지 방으로 이동 (이동 중이면 목적지 갱신)
          targetAgent.moveToRoom(targetRoom, 'WORKING', workSpeech);
        } else if (ev.action === 'tool_end') {
          setRoomTaskEnd(pKey, ev.room || 'dev');

          // 병렬 도구 목록에서 완료된 도구 제거
          const toolKey = ev.toolUseId || ev.id;
          if (toolKey && targetAgent.activeTools.has(toolKey)) {
            targetAgent.activeTools.delete(toolKey);
          } else if (targetAgent.activeTools.size > 0) {
            const firstKey = targetAgent.activeTools.keys().next().value;
            targetAgent.activeTools.delete(firstKey);
          }
          targetAgent.lastToolActivityTime = Date.now();

          if (ev.isError) {
            if (!ev.replay && isCurrentFloor) playSound('error');
            const errorMsg = `⚠️ 에러: ${ev.errorSummary?.slice(0, 26) || '실패'}`;
            targetAgent.errorStartTime = Date.now();

            // WALKING 중 에러 이벤트가 와도 멈추지 않고 도착 후 ERROR 상태 전이
            if (targetAgent.state === 'WALKING') {
              targetAgent.setSpeech('error', errorMsg);
              targetAgent.onArrivedAction = 'ERROR';
            } else {
              targetAgent.state = 'ERROR';
              targetAgent.setSpeech('error', errorMsg);
            }
          } else {
            // 아직 대기/실행 중인 다른 도구가 남아있다면 WORKING 유지
            if (targetAgent.activeTools.size > 0) {
              targetAgent.state = 'WORKING';
            } else {
              // 모든 도구가 완료된 경우에만 IDLE로 복귀
              if (targetAgent.state === 'WALKING') {
                targetAgent.onArrivedAction = 'IDLE';
                targetAgent.clearSpeech();
              } else {
                targetAgent.state = 'IDLE';
                targetAgent.clearSpeech();
              }
            }
          }
        } else if (ev.action === 'ask_user') {
          targetAgent.moveToRoom('user_desk', 'ASKING');
          if (!ev.replay && isCurrentFloor) playSound('ding');
          targetAgent.setSpeech('ask', `❓ ${ev.questionText?.slice(0, 28) || '질문'}`);
        } else if (ev.action === 'user_input') {
          // 새 사용자 입력 수신 시 미완료 도구 및 퇴근 상태 정리
          targetAgent.activeTools.clear();
          targetAgent.cancelLeaving();

          if (targetAgent.state === 'WALKING') {
            targetAgent.onArrivedAction = 'IDLE';
            targetAgent.clearSpeech();
          } else {
            targetAgent.state = 'IDLE';
            targetAgent.clearSpeech();
          }
        } else if (ev.action === 'subagent_spawn') {
          const subId = ev.agentId || 'sub_1';
          let sub = targetAgents.get(subId);
          if (!sub) {
            if (!ev.replay && isCurrentFloor) playSound('ding');
            sub = new PixelAgent(subId, ev.subagentRole || '서브에이전트', 'sub');
            sub.x = ROOM_DEFS.elevator.targetX;
            targetAgents.set(subId, sub);
          } else {
            sub.reviveIfGone('dev');
          }
          sub.moveToRoom('dev', 'WORKING');
          sub.setSpeech('report', `👋 출근: ${ev.subagentName || '지원'}`);
        } else if (ev.action === 'turn_finish') {
          finishAllRoomTasks(pKey);

          // 턴 종료 시 미완료 도구 목록 일괄 정리
          targetAgent.activeTools.clear();
          targetAgent.moveToRoom('user_desk', 'REPORTING');
          if (!ev.replay && isCurrentFloor) playSound('report');
          targetAgent.setSpeech('report', `📋 ${ev.resultSummary?.slice(0, 28) || '업무 완료'}`);

          // 퇴근 예약: 타이머를 targetAgent.leaveTimer에 보관하여 새 이벤트 시 즉시 취소 가능
          if (!ev.replay) {
            targetAgent.leaveTimer = setTimeout(() => {
              targetAgent.leaveTimer = null;
              if (targetAgent.state === 'REPORTING') {
                targetAgent.setSpeech('report', '👋 퇴근합니다~');
                targetAgent.targetX = ROOM_DEFS.elevator.targetX;
                targetAgent.state = 'LEAVING';
                targetAgent.facing = -1;
              }
            }, 3500);
          }
        }
      }

      // 현재 보고 있는 활성 층의 이벤트일 때만 하단 상태창 및 실시간 피드 갱신
      if (isCurrentFloor) {
        appendLog(ev);
        updateStatusDisplay(ev);
      }
    }


    // J. SSE 실시간 스트림 수신 (연결 상태 모니터링 및 재연결 동기화)
    // ----------------------------------------------------
    function initSSE() {
      const evt = new EventSource('/api/events');
      const sseStatusText = document.getElementById('sseStatusText');
      const statusDot = document.querySelector('.status-dot');

      function setConnectionState(connected, message) {
        if (statusDot) {
          statusDot.style.background = connected ? '#10b981' : '#f59e0b';
          statusDot.style.boxShadow = connected ? '0 0 8px #10b981' : '0 0 8px #f59e0b';
        }
        if (sseStatusText) {
          sseStatusText.innerText = message || (connected ? '0.25s 증분 감시 활성' : '서버 재연결 중...');
        }
      }

      evt.onopen = () => {
        setConnectionState(true, '0.25s 증분 감시 활성');
        // 재연결 시 프로젝트 목록 즉시 동기화
        fetch('/api/projects')
          .then(res => res.json())
          .then(list => updateFloorsList(list))
          .catch(() => {});
      };

      evt.onerror = () => {
        setConnectionState(false, '서버 재연결 중...');
      };

      evt.addEventListener('agent_event', (e) => {
        try {
          const data = JSON.parse(e.data);
          handleEvent(data);
        } catch (err) {}
      });

      evt.addEventListener('projects_update', (e) => {
        try {
          const list = JSON.parse(e.data);
          updateFloorsList(list);
        } catch (err) {}
      });

      evt.addEventListener('token_usage_update', (e) => {
        try {
          const data = JSON.parse(e.data);
          const p = projectsList.find(x => x.projectKey === data.projectKey);
          if (p) {
            p.tokenUsage = data.tokenUsage;
          }
          if (data.projectKey === activeProjectKey) {
            currentProjectTokenUsage = data.tokenUsage;
            updateTokenMeterDisplay(currentProjectTokenUsage);
          }
        } catch (err) {}
      });

      evt.addEventListener('token_init_progress', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data && data.text) {
            const detail = document.getElementById('agentStatusDetail');
            if (detail && !activeProjectKey) {
              detail.innerText = data.text;
            }
          }
        } catch (err) {}
      });

      evt.addEventListener('server_shutdown', () => {
        setConnectionState(false, '서버 종료됨');
      });
    }
    initSSE();

    // 초기 프로젝트 목록 및 토큰 정보 즉시 요청
    fetch('/api/projects')
      .then(res => res.json())
      .then(list => updateFloorsList(list))
      .catch(() => {});
    initSSE();

    // 초기 프로젝트 목록 및 토큰 정보 즉시 요청
    fetch('/api/projects')
      .then(res => res.json())
      .then(list => updateFloorsList(list))
      .catch(() => {});

  Object.assign(Office, {
    renderLoop,
    handleEvent,
    initSSE
  });

  window.renderLoop = renderLoop;
  window.handleEvent = handleEvent;
  window.initSSE = initSSE;

})(window);
