/**
 * 에이전트 오피스 (Agent Office) - 사용자 인터페이스 모듈 (public/js/ui.js)
 * 데스크톱 알림, 토큰 미터 패널, 층별 안내 사이드바, 이벤트 피드 관리
 */

(function(window) {
  'use strict';

  const Office = window.Office = window.Office || {};
  const {
    formatTokenCount,
    formatCompactTokenCount,
    calculateEstimatedCost,
    extractTaskDetail,
    escapeHtml,
    playSound
  } = Office;

    // 토큰 미터 패널 UI 갱신 함수 (사용량 정보가 없으면 박스 자체를 숨김)
    function updateTokenMeterDisplay(usage) {
      const box = document.getElementById('tokenMeterBox');
      if (!box) return;

      if (!usage || !usage.hasData) {
        box.style.display = 'none';
        return;
      }

      box.style.display = 'flex';
      const inEl = document.getElementById('tokenInputVal');
      const outEl = document.getElementById('tokenOutputVal');
      const cacheEl = document.getElementById('tokenCacheVal');
      const totalEl = document.getElementById('tokenTotalVal');

      if (inEl) inEl.innerText = formatTokenCount(usage.inputTokens);
      if (outEl) outEl.innerText = formatTokenCount(usage.outputTokens);
      if (cacheEl) cacheEl.innerText = formatTokenCount(usage.cacheTokens);
      if (totalEl) totalEl.innerText = formatTokenCount(usage.totalTokens);

      const modelBadge = document.getElementById('tokenModelBadge');
      if (modelBadge) {
        modelBadge.innerText = usage.model || 'Standard';
        modelBadge.title = usage.model || '';
      }

      const costRow = document.getElementById('tokenCostRow');
      const costVal = document.getElementById('tokenCostVal');
      const cost = calculateEstimatedCost(usage, usage.model);
      if (cost !== null && costRow && costVal) {
        costRow.style.display = 'flex';
        costVal.innerText = `$${cost.toFixed(4)}`;
      } else if (costRow) {
        costRow.style.display = 'none';
      }
    }

    // H-1. 실시간 알림 관리자 (NotificationManager)
    // ----------------------------------------------------
    const NotificationManager = {
      enabled: localStorage.getItem('agent_office_notify_enabled') !== 'false',
      processedEventIds: new Set(),
      consecutiveErrors: new Map(), // sessionId -> count
      unreadQuestionFloors: new Set(), // projectKey Set
      clientStartTime: Date.now(),
      originalTitle: document.title,
      blinkInterval: null,
      blinkState: false,

      init() {
        this.updateButtonUI();
        document.getElementById('btnToggleNotify').addEventListener('click', async () => {
          if (!('Notification' in window)) {
            alert('이 브라우저는 데스크톱 알림을 지원하지 않습니다.');
            return;
          }
          if (Notification.permission === 'default') {
            const perm = await Notification.requestPermission();
            this.enabled = (perm === 'granted');
          } else if (Notification.permission === 'granted') {
            this.enabled = !this.enabled;
          } else {
            alert('브라우저 설정에서 알림 권한이 차단되어 있습니다.');
            this.enabled = false;
          }
          localStorage.setItem('agent_office_notify_enabled', this.enabled ? 'true' : 'false');
          this.updateButtonUI();
          if (this.enabled) playSound('ding');
        });

        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) {
            this.stopTitleBlink();
          }
        });
      },

      updateButtonUI() {
        const btn = document.getElementById('btnToggleNotify');
        const icon = document.getElementById('notifyIcon');
        const text = document.getElementById('notifyText');
        if (this.enabled && window.Notification && Notification.permission === 'granted') {
          icon.innerText = '🔔';
          text.innerText = '알림 켜짐';
          btn.style.borderColor = '#38bdf8';
        } else {
          icon.innerText = '🔕';
          text.innerText = '알림 꺼짐';
          btn.style.borderColor = '#2d3b63';
        }
      },

      handleEvent(ev) {
        if (!ev || !ev.id) return;
        if (ev.replay) return; // Replay 이벤트는 알림/소리/탭 깜빡임 절대 방지

        // 1. 중복 이벤트 필터링
        if (this.processedEventIds.has(ev.id)) return;
        this.processedEventIds.add(ev.id);
        if (this.processedEventIds.size > 500) {
          const iter = this.processedEventIds.values();
          this.processedEventIds.delete(iter.next().value);
        }

        // 2. 과거 로그 필터링 (접속 후 실시간 이벤트만 알림 대상)
        if (ev.timestamp && ev.timestamp < this.clientStartTime - 3000) return;

        const pName = ev.projectName || '오피스';

        // 3. 에러 연속 3회 감지
        if (ev.action === 'tool_end') {
          if (ev.isError) {
            const count = (this.consecutiveErrors.get(ev.sessionId) || 0) + 1;
            this.consecutiveErrors.set(ev.sessionId, count);
            if (count === 3) {
              this.triggerAlert({
                type: 'error',
                title: `🚨 [${pName}] 도구 연속 3회 실패!`,
                body: ev.errorSummary || '작업 중 오류가 3번 연속 발생했습니다.',
                blinkText: '🚨 연속 에러 발생!'
              });
            }
          } else {
            this.consecutiveErrors.set(ev.sessionId, 0);
          }
        }

        // 4. 내 응답 필요 (ask_user)
        if (ev.action === 'ask_user') {
          const pKey = ev.projectKey || (ev.cwd ? ev.cwd : null);
          if (pKey && pKey !== activeProjectKey) {
            this.unreadQuestionFloors.add(pKey);
            updateFloorsList(projectsList);
          }
          this.triggerAlert({
            type: 'ask',
            title: `❓ [${pName}] 내 응답 필요`,
            body: ev.questionText || '에이전트가 질문을 보냈습니다.',
            blinkText: '❓ 응답 필요!'
          });
        }

        // 5. 작업 완료 (turn_finish)
        if (ev.action === 'turn_finish') {
          this.triggerAlert({
            type: 'finish',
            title: `✅ [${pName}] 작업 완료`,
            body: ev.resultSummary || '에이전트가 업무를 마무리했습니다.',
            blinkText: '✅ 작업 완료!'
          });
        }
      },

      triggerAlert({ type, title, body, blinkText }) {
        // 사운드 재생 (기존 soundEnabled 준수)
        if (type === 'ask') {
          playSound('ding');
          setTimeout(() => playSound('ding'), 260);
        } else if (type === 'finish') {
          playSound('report');
        } else if (type === 'error') {
          playSound('error');
          setTimeout(() => playSound('error'), 200);
        }

        // 탭이 백그라운드일 때만 탭 제목 깜빡임 & 브라우저 알림
        if (document.hidden) {
          this.startTitleBlink(blinkText);

          if (this.enabled && 'Notification' in window && Notification.permission === 'granted') {
            try {
              const summary = (body || '').replace(/[\r\n]+/g, ' ').slice(0, 40);
              const notif = new Notification(title, {
                body: summary,
                tag: 'agent-office-alert'
              });
              notif.onclick = () => {
                window.focus();
                notif.close();
              };
            } catch (e) {}
          }
        }
      },

      startTitleBlink(blinkText) {
        if (this.blinkInterval) clearInterval(this.blinkInterval);
        this.blinkState = true;
        document.title = blinkText;

        this.blinkInterval = setInterval(() => {
          this.blinkState = !this.blinkState;
          document.title = this.blinkState ? blinkText : this.originalTitle;
        }, 1000);
      },

      stopTitleBlink() {
        if (this.blinkInterval) {
          clearInterval(this.blinkInterval);
          this.blinkInterval = null;
        }
        document.title = this.originalTitle;
      }
    };

    NotificationManager.init();

    // 모바일 접이식 섹션 (접기/펼치기 토글 및 키보드 접근성)
    function initCollapsibleSections() {
      document.querySelectorAll('.panel-section-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
          const isExpanded = btn.getAttribute('aria-expanded') === 'true';
          btn.setAttribute('aria-expanded', !isExpanded);
          const contentId = btn.getAttribute('aria-controls');
          const contentEl = document.getElementById(contentId);
          if (contentEl) {
            contentEl.classList.toggle('collapsed', isExpanded);
          }
        });
      });
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initCollapsibleSections);
    } else {
      initCollapsibleSections();
    }


    // I. 백화점 층별 안내 사이드바 (최고층이 맨 위!)
    // ----------------------------------------------------
    const floorCardElements = new Map();

    function renderFloorCard(card, p, isActive, hasUnread) {
      const expectedClass = `floor-card ${isActive ? 'active' : ''} ${p.isActive ? 'working' : ''}`;
      if (card.className !== expectedClass) {
        card.className = expectedClass;
      }
      const engineUpper = (p.engine || 'local').toUpperCase();
      const newInnerHtml = `
          <div class="floor-card-top">
            <div class="floor-badge">
              <span class="floor-indicator"></span>
              <span>${escapeHtml(p.floor)}F</span>
              ${hasUnread ? '<span class="floor-badge-alert" title="내 응답 필요!">❓</span>' : ''}
            </div>
            <span class="floor-engine-tag">${escapeHtml(engineUpper)}</span>
          </div>
          <div class="floor-title">${escapeHtml(p.projectName)}</div>
          <div class="floor-cwd">${escapeHtml(p.cwd)}</div>
        `;
      if (card.innerHTML !== newInnerHtml) {
        card.innerHTML = newInnerHtml;
      }
    }

    function updateFloorsList(projects) {
      projectsList = projects;
      const listContainer = document.getElementById('floorsList');
      if (!listContainer) return;

      const activeKeys = new Set();

      // 프로젝트 목록: server.js에서 이미 최고층 내림차순으로 정렬됨!
      // 키 기반 diff: 전체 innerHTML을 날리지 않고 변경된 카드만 갱신하며 DOM 노드 재사용
      for (let i = 0; i < projects.length; i++) {
        const p = projects[i];
        const pKey = p.projectKey;
        activeKeys.add(pKey);

        const isActive = pKey === activeProjectKey;
        const hasUnread = NotificationManager.unreadQuestionFloors.has(pKey);

        let card = floorCardElements.get(pKey);
        if (!card) {
          card = document.createElement('div');
          card.setAttribute('role', 'button');
          card.setAttribute('tabindex', '0');
          card.onclick = () => selectProject(pKey);
          card.onkeydown = (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              selectProject(pKey);
            }
          };
          floorCardElements.set(pKey, card);
        }
        card.title = `${p.floor}F: ${p.projectName} (${p.cwd})`;
        card.setAttribute('aria-label', `${p.floor}층 ${p.projectName}`);

        renderFloorCard(card, p, isActive, hasUnread);

        const currentChildAtPos = listContainer.children[i];
        if (currentChildAtPos !== card) {
          listContainer.insertBefore(card, currentChildAtPos || null);
        }
      }

      // 목록에서 사라진 프로젝트 카드 정리
      for (const [key, card] of floorCardElements.entries()) {
        if (!activeKeys.has(key)) {
          card.remove();
          floorCardElements.delete(key);
        }
      }

      // 첫 접속 시 가장 높은 층(최근 활동 프로젝트) 자동 선택
      if (!activeProjectKey && projects.length > 0) {
        selectProject(projects[0].projectKey);
      } else if (activeProjectKey) {
        const p = projects.find(x => x.projectKey === activeProjectKey);
        if (p) {
          currentProjectTokenUsage = p.tokenUsage || null;
          updateTokenMeterDisplay(currentProjectTokenUsage);
        }
      }
    }

    function selectProject(pKey) {
      activeProjectKey = pKey;
      playSound('ding');

      // 해당 층 선택 시 미확인 질문 뱃지 제거
      NotificationManager.unreadQuestionFloors.delete(pKey);

      const p = projectsList.find(x => x.projectKey === pKey);
      if (p) {
        document.getElementById('currentFloorTag').innerText = `${p.floor}F`;
        document.getElementById('currentProjectTitle').innerText = p.projectName;
        document.getElementById('currentSessionSubtitle').innerText = p.cwd;
        document.getElementById('currentEngineTag').innerText = (p.engine || 'LOCAL').toUpperCase();
        currentProjectTokenUsage = p.tokenUsage || null;
        updateTokenMeterDisplay(currentProjectTokenUsage);
      } else {
        currentProjectTokenUsage = null;
        updateTokenMeterDisplay(null);
      }

      updateFloorsList(projectsList);
    }

    function updateStatusDisplay(ev) {
      const badge = document.getElementById('agentStateBadge');
      const detail = document.getElementById('agentStatusDetail');
      badge.className = `state-badge state-${ev.action.toUpperCase()}`;

      if (ev.action === 'thinking') {
        badge.innerText = '생각 중 (THINKING)';
        badge.className = 'state-badge state-THINKING';
        detail.innerText = ev.thinkingText || '에이전트가 생각하고 있습니다.';
      } else if (ev.action === 'tool_start') {
        const detailObj = extractTaskDetail(ev.room || 'research', ev.toolName, ev.toolArgs, ev.toolSummary);
        badge.innerText = `도구 실행 (${ev.toolName})`;
        badge.className = 'state-badge state-WORKING';
        detail.innerText = `방: [${ROOM_DEFS[ev.room]?.name || '정보검색실'}]\n작업: ${detailObj.prefix}${detailObj.text}`;
      } else if (ev.action === 'tool_end') {
        if (ev.isError) {
          badge.innerText = '도구 실패 (ERROR)';
          badge.className = 'state-badge state-ERROR';
          detail.innerText = `오류: ${ev.errorSummary || '도구 실패'}`;
        } else {
          badge.innerText = '도구 완료 (DONE)';
          badge.className = 'state-badge state-IDLE';
          detail.innerText = `결과 도착: ${ev.resultSummary || '정상 완료'}`;
        }
      } else if (ev.action === 'ask_user') {
        badge.innerText = '사용자 질문 (ASK)';
        badge.className = 'state-badge state-ASKING';
        detail.innerText = `질문: ${ev.questionText || '의견을 확인해주세요.'}`;
      } else if (ev.action === 'subagent_spawn') {
        badge.innerText = '서브에이전트 출근';
        badge.className = 'state-badge state-WORKING';
        detail.innerText = `팀원 출근: ${ev.subagentName} (${ev.subagentRole})`;
      } else if (ev.action === 'turn_finish') {
        badge.innerText = '업무 보고 & 퇴근';
        badge.className = 'state-badge state-REPORTING';
        detail.innerText = `보고서: ${ev.resultSummary || '업무 완료'}`;
      }
    }

    function appendLog(ev) {
      const feed = document.getElementById('eventLogFeed');
      const item = document.createElement('div');
      item.className = 'log-item';
      if (ev.isError) item.classList.add('error');
      if (ev.action === 'thinking') item.classList.add('think');
      if (ev.action === 'ask_user') item.classList.add('ask');
      if (ev.action === 'turn_finish') item.classList.add('done');

      const timeStr = new Date().toTimeString().split(' ')[0];
      const tagStr = `[${(ev.action || 'EVENT').toUpperCase()}]`;
      const detailObj = (ev.action === 'tool_start') ? extractTaskDetail(ev.room || 'research', ev.toolName, ev.toolArgs, ev.toolSummary) : null;
      const msgStr = detailObj ? `${detailObj.prefix}${detailObj.text}` : (ev.toolSummary || ev.thinkingText || ev.questionText || ev.resultSummary || ev.userPrompt || '이벤트');

      const timeSpan = document.createElement('span');
      timeSpan.className = 'log-time';
      timeSpan.textContent = timeStr;

      const tagSpan = document.createElement('span');
      tagSpan.className = 'log-tag';
      tagSpan.textContent = tagStr;

      const msgSpan = document.createElement('span');
      msgSpan.className = 'log-msg';
      msgSpan.textContent = msgStr;

      item.appendChild(timeSpan);
      item.appendChild(tagSpan);
      item.appendChild(msgSpan);
      feed.appendChild(item);
      feed.scrollTop = feed.scrollHeight;
      while (feed.children.length > 80) feed.removeChild(feed.firstChild);
    }


  Object.assign(Office, {
    updateTokenMeterDisplay,
    NotificationManager,
    updateFloorsList,
    selectProject,
    updateStatusDisplay,
    appendLog
  });

  window.updateTokenMeterDisplay = updateTokenMeterDisplay;
  window.NotificationManager = NotificationManager;
  window.updateFloorsList = updateFloorsList;
  window.selectProject = selectProject;
  window.updateStatusDisplay = updateStatusDisplay;
  window.appendLog = appendLog;

})(window);
