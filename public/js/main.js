/**
 * 에이전트 오피스 (Agent Office) - 메인 실행 모듈 (public/js/main.js)
 * 캔버스 초기화, 렌더 루프, SSE 실시간 수신 및 이벤트 디스패처
 */

(function(window) {
  'use strict';

  const Office = window.Office = window.Office || {};

  const canvas = document.getElementById('officeCanvas');
  Office.canvas = canvas;
  Office.Iso.init(canvas);
  if (Office.initStageTools) Office.initStageTools();

  // 렌더 루프: 현재 층 에이전트 상태 갱신 → 방 작업 라벨 페이드 → 아이소메트릭 장면 그리기
  let lastFrameTime = performance.now();
  function renderLoop(now) {
    const dt = Math.min((now - lastFrameTime) / 1000, 0.1);
    lastFrameTime = now;

    const currentAgents = getProjectAgents(Office.activeProjectKey);
    for (const ag of currentAgents.values()) ag.update(dt);
    updateRoomTaskStates(dt, now);
    Office.Iso.render(currentAgents.values(), dt);

    requestAnimationFrame(renderLoop);
  }
  requestAnimationFrame(renderLoop);

  Office.projectFirstEventTime = new Map();

    // 도구 호출 ID -> 담당 에이전트 기록 (tool_end를 시작한 에이전트에게 귀속)
    const toolOwners = new Map();
    function rememberToolOwner(pKey, toolKey, agentId) {
      if (!toolKey) return;
      toolOwners.set(`${pKey}|${toolKey}`, agentId);
      if (toolOwners.size > 500) toolOwners.delete(toolOwners.keys().next().value);
    }
    function takeToolOwner(pKey, toolKey) {
      if (!toolKey) return null;
      const k = `${pKey}|${toolKey}`;
      const id = toolOwners.get(k);
      toolOwners.delete(k);
      return id || null;
    }

    // 도구 ID가 없는 결과(Antigravity)는 가장 오래 실행 중인 도구를 가진 에이전트에게 귀속
    function oldestBusyAgent(agents) {
      let best = null;
      let bestTime = Infinity;
      for (const ag of agents) {
        if (!ag) continue;
        for (const t of ag.activeTools.values()) {
          if (t.startTime < bestTime) { bestTime = t.startTime; best = ag; }
        }
      }
      return best;
    }

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

      if (!Office.projectFirstEventTime.has(pKey)) Office.projectFirstEventTime.set(pKey, ev.timestamp || Date.now());

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

      // 이벤트 대상 프로젝트의 에이전트 맵 조회 (메인 & DevOps 병렬 협업 체제)
      const targetAgents = getProjectAgents(pKey);
      let targetAgent = null;

      if (ev.agentId && ev.agentId.startsWith('sub_')) {
        targetAgent = targetAgents.get(ev.agentId);
        if (!targetAgent) {
          // 이미 퇴근 처리된 서브에이전트의 늦은 종료 이벤트로 다시 출근시키지 않음
          if (ev.action === 'subagent_finish') return;
          // 재접속 리플레이에서는 출근 이벤트가 아닌 한 서브에이전트를 새로 만들지 않음 (퇴근한 팀원 재등장 방지)
          if (ev.replay && ev.action !== 'subagent_spawn') return;
          targetAgent = createSubagent(pKey, ev.agentId, ev);
        }
      } else {
        // 메인 세션 이벤트는 메인과 DevOps가 나눠 처리:
        // 1) 서버실(터미널/명령어) 도구는 DevOps 전담
        // 2) 메인이 다른 방에서 도구 실행 중일 때 들어온 병렬 도구는 DevOps가 지원 (DevOps가 한가할 때)
        // 3) tool_end는 해당 도구를 시작한 에이전트에게 전달
        const mainAg = targetAgents.get('main');
        const opsAg = targetAgents.get('ops');
        if (ev.action === 'tool_start') {
          const mainBusy = mainAg && mainAg.activeTools.size > 0 && mainAg.currentRoom !== ev.room;
          const opsFree = opsAg && opsAg.activeTools.size === 0;
          if (opsAg && (ev.room === 'server' || (mainBusy && opsFree))) {
            targetAgent = opsAg;
          } else {
            targetAgent = mainAg;
          }
          rememberToolOwner(pKey, ev.toolUseId, targetAgent.id);
        } else if (ev.action === 'tool_end') {
          const ownerId = ev.toolUseId ? takeToolOwner(pKey, ev.toolUseId) : null;
          targetAgent = (ownerId && targetAgents.get(ownerId)) || oldestBusyAgent([mainAg, opsAg]) || mainAg;
        } else {
          targetAgent = mainAg;
          // 턴 경계에서는 DevOps의 미완료 도구도 정리 (서버실 복귀)
          if (opsAg && (ev.action === 'turn_finish' || ev.action === 'user_input') && opsAg.activeTools.size > 0) {
            opsAg.activeTools.clear();
            opsAg.moveToRoom('server', 'WORKING');
          }
        }
      }

      if (targetAgent) {
        targetAgent.lastEventTime = Date.now();

        // 1. 퇴근 타이머 레이스 방지: 어떤 새 이벤트라도 오면 퇴근 타이머 즉시 취소
        targetAgent.cancelLeaving();

        // 2. GONE 또는 LEAVING 상태에서 새 이벤트가 오면 엘리베이터에서 즉시 출근시켜 좌표 고착 방지
        const destRoom = ev.room || (ev.action === 'ask_user' || ev.action === 'turn_finish' ? 'user_desk' : 'meeting');
        if ((targetAgent.state === 'GONE' || targetAgent.state === 'LEAVING') && ev.action !== 'subagent_finish') {
          targetAgent.reviveIfGone(destRoom);
        }

        if (ev.action === 'thinking') {
          if (!ev.replay && isCurrentFloor) playSound('think');
          const thinkMsg = `💭 ${ev.thinkingText?.slice(0, 30) || '생각 중...'}`;
          const thinkSpeech = { type: 'think', text: thinkMsg, duration: 4500 };

          // 회의실(meeting) 화이트보드로 이동하여 사고 및 브레인스토밍 수행 (회의실 적극 활용)
          setRoomTaskStart(pKey, 'meeting', 'thinking', null, ev.thinkingText || '아이디어 구상');
          targetAgent.moveToRoom('meeting', 'THINKING', thinkSpeech);
        } else if (ev.action === 'tool_start') {
          // 이전 회의실 사고 작업 완료 처리
          setRoomTaskEnd(pKey, 'meeting');
          if (typeof NotificationManager !== 'undefined' && NotificationManager.markFloorQuestion) {
            NotificationManager.markFloorQuestion(pKey, false);
          }

          const targetRoom = ev.room || 'research';
          const toolKey = ev.toolUseId || ev.id || `${ev.toolName || 'tool'}_${Date.now()}`;

          // 병렬 도구 호출 추적 등록
          targetAgent.activeTools.set(toolKey, {
            toolName: ev.toolName,
            room: targetRoom,
            startTime: Date.now()
          });
          targetAgent.lastToolActivityTime = Date.now();

          if (!ev.replay) targetAgent.toolCount = (targetAgent.toolCount || 0) + 1;
          setRoomTaskStart(pKey, targetRoom, ev.toolName, ev.toolArgs, ev.toolSummary);
          const detail = extractTaskDetail(targetRoom, ev.toolName, ev.toolArgs, ev.toolSummary);
          const workSpeech = { type: 'work', text: `⚙️ ${detail.prefix}${detail.text}`, duration: 4500 };

          // 목적지 방으로 이동 (이동 중이면 목적지 갱신)
          targetAgent.moveToRoom(targetRoom, 'WORKING', workSpeech);
        } else if (ev.action === 'tool_end') {
          setRoomTaskEnd(pKey, ev.room || 'dev');

          // 병렬 도구 목록에서 완료된 도구 제거
          const toolKey = ev.toolUseId;
          if (toolKey && targetAgent.activeTools.has(toolKey)) {
            targetAgent.activeTools.delete(toolKey);
          } else if (!toolKey && targetAgent.activeTools.size > 0) {
            // 도구 ID가 없는 엔진만 가장 오래된 도구를 완료 처리
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
              // 이동 중이면 도착 후 WORKING (걷는 도중 상태를 덮어써 복도에 멈춰 서는 문제 방지)
              if (targetAgent.state === 'WALKING') targetAgent.onArrivedAction = 'WORKING';
              else targetAgent.state = 'WORKING';
            } else {
              // DevOps 에이전트는 도구 완료 시 기본적으로 서버실로 복귀하여 모니터링 지속
              if (targetAgent.id === 'ops') {
                targetAgent.moveToRoom('server', 'WORKING', { type: 'meme', text: '🖥️ 백그라운드 서버 정상 가동 중', duration: 3500 });
              } else {
                if (targetAgent.state === 'WALKING') {
                  targetAgent.onArrivedAction = 'IDLE';
                  targetAgent.clearSpeech();
                } else {
                  targetAgent.state = 'IDLE';
                  targetAgent.clearSpeech();
                }
              }
            }
          }
        } else if (ev.action === 'ask_user') {
          targetAgent.moveToRoom('user_desk', 'ASKING');
          if (!ev.replay && isCurrentFloor) playSound('ding');
          targetAgent.setSpeech('ask', `❓ ${ev.questionText?.slice(0, 28) || '질문'}`);
          if (typeof NotificationManager !== 'undefined' && NotificationManager.markFloorQuestion) {
            NotificationManager.markFloorQuestion(pKey, true);
          }
        } else if (ev.action === 'user_input') {
          // 새 사용자 입력 수신 시 미완료 도구 및 퇴근 상태 정리
          targetAgent.activeTools.clear();
          targetAgent.cancelLeaving();
          if (typeof NotificationManager !== 'undefined' && NotificationManager.markFloorQuestion) {
            NotificationManager.markFloorQuestion(pKey, false);
          }

          if (targetAgent.state === 'WALKING') {
            targetAgent.onArrivedAction = 'IDLE';
            targetAgent.clearSpeech();
          } else {
            targetAgent.state = 'IDLE';
            targetAgent.clearSpeech();
          }
        } else if (ev.action === 'subagent_spawn') {
          // targetAgent는 위에서 조회/생성된 서브에이전트 본인 (엘리베이터에서 등장 후 회의실에서 브리핑)
          if (!ev.replay && isCurrentFloor) playSound('ding');
          targetAgent.moveToRoom('meeting', 'THINKING');
          targetAgent.setSpeech('report', `👋 출근: ${ev.subagentName || '지원'}`);
        } else if (ev.action === 'subagent_finish') {
          if (!ev.replay && isCurrentFloor) playSound('report');
          targetAgent.leave({ type: 'report', text: `📦 보고 완료: ${ev.resultSummary?.slice(0, 22) || ev.subagentName || '작업 완료'}`, duration: 4000 });
        } else if (ev.action === 'turn_finish') {
          finishAllRoomTasks(pKey);

          // 턴 종료 시 미완료 도구 목록 일괄 정리
          targetAgent.activeTools.clear();
          targetAgent.moveToRoom('user_desk', 'REPORTING');
          if (!ev.replay && isCurrentFloor) playSound('report');
          targetAgent.setSpeech('report', `📋 ${ev.resultSummary?.slice(0, 28) || '업무 완료, 다음 지시 대기'}`);

          // 응답 대기 상태 활성화 (사용자 지시를 기다리므로 오피스를 퇴근해 비우지 않고 책상에서 대기)
          if (typeof NotificationManager !== 'undefined' && NotificationManager.markFloorQuestion) {
            NotificationManager.markFloorQuestion(pKey, true);
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

      function setConnectionState(connected, message) {
        const pillEl = document.querySelector('.live-pill');
        if (pillEl) pillEl.classList.toggle('connected', connected);
        if (sseStatusText) {
          sseStatusText.innerText = message || (connected ? 'LIVE' : '재연결 중');
        }
      }

      evt.onopen = () => {
        setConnectionState(true, 'LIVE');
        // 재연결 시 프로젝트 목록 즉시 동기화
        fetch('/api/projects')
          .then(res => res.json())
          .then(list => updateFloorsList(list))
          .catch(() => {});
      };

      evt.onerror = () => {
        setConnectionState(false, '재연결 중');
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

  Object.assign(Office, {
    renderLoop,
    handleEvent,
    initSSE
  });

  window.renderLoop = renderLoop;
  window.handleEvent = handleEvent;
  window.initSSE = initSSE;

})(window);
