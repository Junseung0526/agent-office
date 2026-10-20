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

    const mainAgent = new PixelAgent('main', '메인 에이전트', 'main');
    agentsMap.set('main', mainAgent);

    let lastFrameTime = performance.now();
    function renderLoop(now) {
      const dt = Math.min((now - lastFrameTime) / 1000, 0.1);
      lastFrameTime = now;

      // 1. 엔티티 상태 업데이트
      for (const [_, ag] of agentsMap.entries()) {
        ag.update(dt);
      }

      // 1-1. 각 방 상세 작업 라벨 및 전광판 상태 업데이트 (티커 스크롤 및 페이드아웃)
      updateRoomTaskStates(dt, now);

      // 2. 패스 1: 2x 도트 그래픽 (480x270 픽셀아트를 2배 정수 스케일링)
      ctx.save();
      ctx.scale(2, 2);
      ctx.imageSmoothingEnabled = false;

      drawEnvironmentPixels(ctx);

      for (const [_, ag] of agentsMap.entries()) {
        ag.drawPixels(ctx);
      }
      ctx.restore();

      // 3. 패스 2: 선명한 고해상도 텍스트 (960x540 네이티브 벡터 한글 렌더링)
      ctx.save();
      ctx.imageSmoothingEnabled = true;

      drawRoomSignLabels(ctx);
      drawRoomTaskLabels(ctx);

      for (const [_, ag] of agentsMap.entries()) {
        ag.drawSharpUI(ctx);
      }
      ctx.restore();

      requestAnimationFrame(renderLoop);
    }
    requestAnimationFrame(renderLoop);


  Office.mainAgent = mainAgent;
  window.mainAgent = mainAgent;

    function handleEvent(ev) {
      appendLog(ev);
      updateStatusDisplay(ev);

      // 알림 매니저 전달
      NotificationManager.handleEvent(ev);

      // 토큰 사용량 정보 실시간 갱신
      if (ev.tokenUsage && (ev.projectKey === activeProjectKey || !activeProjectKey)) {
        currentProjectTokenUsage = ev.tokenUsage;
        updateTokenMeterDisplay(currentProjectTokenUsage);
      }

      const targetAgent = agentsMap.get(ev.agentId) || mainAgent;
      targetAgent.lastEventTime = Date.now();

      // 1. 퇴근 타이머 레이스 방지: 어떤 새 이벤트라도 오면 퇴근 타이머 즉시 취소
      targetAgent.cancelLeaving();

      // 2. GONE 또는 LEAVING 상태에서 새 이벤트가 오면 엘리베이터에서 즉시 출근시켜 좌표 고착 방지
      const destRoom = ev.room || (ev.action === 'ask_user' || ev.action === 'turn_finish' ? 'user_desk' : 'meeting');
      if (targetAgent.state === 'GONE' || targetAgent.state === 'LEAVING') {
        targetAgent.reviveIfGone(destRoom);
      }

      if (ev.action === 'thinking') {
        if (!ev.replay) playSound('think');
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
        const pKey = ev.projectKey || activeProjectKey;
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
        const pKey = ev.projectKey || activeProjectKey;
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
          if (!ev.replay) playSound('error');
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
        if (!ev.replay) playSound('ding');
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
        let sub = agentsMap.get(subId);
        if (!sub) {
          if (!ev.replay) playSound('ding');
          sub = new PixelAgent(subId, ev.subagentRole || '서브에이전트', 'sub');
          sub.x = ROOM_DEFS.elevator.targetX;
          agentsMap.set(subId, sub);
        } else {
          sub.reviveIfGone('dev');
        }
        sub.moveToRoom('dev', 'WORKING');
        sub.setSpeech('report', `👋 출근: ${ev.subagentName || '지원'}`);
      } else if (ev.action === 'turn_finish') {
        const pKey = ev.projectKey || activeProjectKey;
        finishAllRoomTasks(pKey);

        // 턴 종료 시 미완료 도구 목록 일괄 정리
        targetAgent.activeTools.clear();
        targetAgent.moveToRoom('user_desk', 'REPORTING');
        if (!ev.replay) playSound('report');
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


    // J. SSE 실시간 스트림 수신
    // ----------------------------------------------------
    function initSSE() {
      const evt = new EventSource('/api/events');

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
    }
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
