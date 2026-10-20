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
            updateHotJumpBanner();
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
      card.setAttribute('aria-selected', isActive ? 'true' : 'false');
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

    let currentFilter = 'all'; // 'all' | 'working' | 'question'
    let searchQuery = '';

    function filterProjects(projects) {
      if (!projects) return [];
      return projects.filter(p => {
        // 1. 상태 필터
        if (currentFilter === 'working' && !p.isActive) return false;
        if (currentFilter === 'question' && !NotificationManager.unreadQuestionFloors.has(p.projectKey)) return false;

        // 2. 검색어 필터
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          const matchName = (p.projectName || '').toLowerCase().includes(q);
          const matchCwd = (p.cwd || '').toLowerCase().includes(q);
          const matchFloor = `${p.floor}f`.includes(q) || `${p.floor}` === q;
          if (!matchName && !matchCwd && !matchFloor) return false;
        }
        return true;
      });
    }

    function updateFilterCounts(projects) {
      const all = projects ? projects.length : 0;
      let working = 0;
      let question = 0;
      if (projects) {
        for (const p of projects) {
          if (p.isActive) working++;
          if (NotificationManager.unreadQuestionFloors.has(p.projectKey)) question++;
        }
      }
      const elAll = document.getElementById('countAll');
      const elWorking = document.getElementById('countWorking');
      const elQuestion = document.getElementById('countQuestion');
      if (elAll) elAll.innerText = all;
      if (elWorking) elWorking.innerText = working;
      if (elQuestion) elQuestion.innerText = question;
    }

    function updateHotJumpBanner() {
      const banner = document.getElementById('hotJumpBanner');
      const text = document.getElementById('hotJumpText');
      if (!banner || !text) return;
      if (NotificationManager.unreadQuestionFloors.size === 0) {
        banner.style.display = 'none';
        return;
      }
      const firstUnreadKey = NotificationManager.unreadQuestionFloors.values().next().value;
      const p = (projectsList || []).find(x => x.projectKey === firstUnreadKey);
      const floorStr = p ? `${p.floor}F ` : '';
      text.innerText = `${floorStr}응답 필요`;
      banner.style.display = 'inline-flex';
      banner.onclick = () => {
        selectProject(firstUnreadKey);
      };
    }

    function updateFloorsList(projects) {
      projectsList = projects;
      const listContainer = document.getElementById('floorsList');
      if (!listContainer) return;

      updateFilterCounts(projects);
      updateHotJumpBanner();

      if (!projects || projects.length === 0) {
        listContainer.innerHTML = `
          <div style="padding:20px 12px; text-align:center; color:#64748b; font-size:11px; line-height:1.5;">
            <div style="font-size:22px; margin-bottom:8px;">🏢</div>
            <div style="font-weight:700; color:#94a3b8; margin-bottom:4px;">감지된 세션 없음</div>
            <div>Claude Code 또는 Antigravity CLI 세션을 실행하면 자동으로 층이 생성됩니다.</div>
          </div>
        `;
        return;
      }

      const visibleProjects = filterProjects(projects);

      if (visibleProjects.length === 0) {
        listContainer.innerHTML = `
          <div style="padding:20px 12px; text-align:center; color:#64748b; font-size:11px; line-height:1.5;">
            <div style="font-size:18px; margin-bottom:6px;">🔍</div>
            <div style="font-weight:700; color:#94a3b8; margin-bottom:4px;">일치하는 층이 없습니다</div>
            <div>검색어나 필터 조건을 변경해보세요.</div>
          </div>
        `;
        return;
      } else {
        // 일치하지 않는 메시지가 남아있다면 제거
        const emptyMsg = listContainer.querySelector('div:not(.floor-card)');
        if (emptyMsg) listContainer.innerHTML = '';
      }

      const activeKeys = new Set();

      // 프로젝트 목록: server.js에서 이미 최고층 내림차순으로 정렬됨!
      // 키 기반 diff: 전체 innerHTML을 날리지 않고 변경된 카드만 갱신하며 DOM 노드 재사용
      for (let i = 0; i < visibleProjects.length; i++) {
        const p = visibleProjects[i];
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
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              const prev = card.previousElementSibling;
              if (prev && prev.getAttribute('role') === 'button') {
                prev.focus();
                prev.click();
              }
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              const next = card.nextElementSibling;
              if (next && next.getAttribute('role') === 'button') {
                next.focus();
                next.click();
              }
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

      // 목록에서 사라진 프로젝트 카드 정리 (필터/검색으로 숨겨진 카드도 화면에서 제거)
      for (const [key, card] of floorCardElements.entries()) {
        if (!activeKeys.has(key)) {
          card.remove();
        }
      }

      // 첫 접속 시 가장 높은 층(최근 활동 프로젝트) 자동 선택
      if (!activeProjectKey && visibleProjects.length > 0) {
        selectProject(visibleProjects[0].projectKey);
      } else if (activeProjectKey) {
        const p = projects.find(x => x.projectKey === activeProjectKey);
        if (p) {
          currentProjectTokenUsage = p.tokenUsage || null;
          updateTokenMeterDisplay(currentProjectTokenUsage);
        }
      }
    }

    function renderProjectLogs(pKey) {
      const feed = document.getElementById('eventLogFeed');
      if (!feed) return;
      feed.innerHTML = '';
      const logs = (Office.projectLogsMap && Office.projectLogsMap.get(pKey)) || [];
      if (logs.length === 0) {
        const item = document.createElement('div');
        item.className = 'log-item';
        item.innerHTML = `<span class="log-time">${new Date().toTimeString().split(' ')[0]}</span><span class="log-tag">[READY]</span><span class="log-msg">이 층의 새로운 에이전트 이벤트를 대기하고 있습니다.</span>`;
        feed.appendChild(item);
        return;
      }
      for (const ev of logs) {
        appendLog(ev, false);
      }
      feed.scrollTop = feed.scrollHeight;
    }

    function resetStatusDisplayToIdle() {
      const badge = document.getElementById('agentStateBadge');
      const detail = document.getElementById('agentStatusDetail');
      if (badge) {
        badge.className = 'state-badge state-IDLE';
        badge.innerText = '대기 중 (IDLE)';
      }
      if (detail) {
        detail.innerText = '에이전트가 새로운 도구 호출이나 질문을 대기하고 있습니다.';
      }
    }

    function selectProject(pKey) {
      activeProjectKey = pKey;
      Office.activeProjectKey = pKey;
      window.activeProjectKey = pKey;
      playSound('ding');

      // 해당 층 선택 시 미확인 질문 뱃지 제거
      NotificationManager.unreadQuestionFloors.delete(pKey);
      updateHotJumpBanner();

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

      // 층 변경 시 해당 층의 최근 이벤트 로그 피드 렌더링
      renderProjectLogs(pKey);

      // 층 변경 시 해당 층의 상태 표시 갱신
      const lastEv = Office.projectLastEventMap ? Office.projectLastEventMap.get(pKey) : null;
      if (lastEv) {
        updateStatusDisplay(lastEv);
      } else {
        resetStatusDisplayToIdle();
      }

      updateFloorsList(projectsList);

      const activeCard = floorCardElements.get(pKey);
      if (activeCard && typeof activeCard.scrollIntoView === 'function') {
        activeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    function updateStatusDisplay(ev) {
      const badge = document.getElementById('agentStateBadge');
      const detail = document.getElementById('agentStatusDetail');
      if (!badge || !detail || !ev) return;
      badge.className = `state-badge state-${(ev.action || 'IDLE').toUpperCase()}`;

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
      } else if (ev.action === 'user_input') {
        badge.innerText = '사용자 입력 (INPUT)';
        badge.className = 'state-badge state-IDLE';
        detail.innerText = `입력 수신: ${ev.userPrompt || '새로운 지시'}`;
      }
    }

    function appendLog(ev, smartScroll = true) {
      const feed = document.getElementById('eventLogFeed');
      if (!feed || !ev) return;

      const isScrolledToBottom = (feed.scrollHeight - feed.scrollTop - feed.clientHeight) < 40;

      const item = document.createElement('div');
      item.className = 'log-item';
      if (ev.isError) item.classList.add('error');
      if (ev.action === 'thinking') item.classList.add('think');
      if (ev.action === 'ask_user') item.classList.add('ask');
      if (ev.action === 'turn_finish') item.classList.add('done');

      const timeStr = ev.timestamp ? new Date(ev.timestamp).toTimeString().split(' ')[0] : new Date().toTimeString().split(' ')[0];
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

      while (feed.children.length > 80) feed.removeChild(feed.firstChild);

      if (!smartScroll || isScrolledToBottom) {
        feed.scrollTop = feed.scrollHeight;
      }
    }

    // 층 검색 인풋 및 필터 칩 초기화
    function initSearchAndFilter() {
      const input = document.getElementById('floorSearchInput');
      const clearBtn = document.getElementById('floorSearchClear');
      if (input) {
        input.addEventListener('input', (e) => {
          searchQuery = e.target.value.trim();
          if (clearBtn) clearBtn.style.display = searchQuery ? 'block' : 'none';
          updateFloorsList(projectsList);
        });
      }
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          if (input) input.value = '';
          searchQuery = '';
          clearBtn.style.display = 'none';
          updateFloorsList(projectsList);
          if (input) input.focus();
        });
      }

      document.querySelectorAll('.filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          currentFilter = chip.getAttribute('data-filter') || 'all';
          updateFloorsList(projectsList);
        });
      });

      // 단축키 '/'로 검색창 포커스, 'Escape'로 검색 취소 및 초기화
      window.addEventListener('keydown', (e) => {
        if (e.key === '/' && document.activeElement !== input) {
          const tag = (document.activeElement && document.activeElement.tagName) || '';
          if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
            e.preventDefault();
            if (input) input.focus();
          }
        } else if (e.key === 'Escape' && document.activeElement === input) {
          if (input) {
            input.value = '';
            searchQuery = '';
            if (clearBtn) clearBtn.style.display = 'none';
            input.blur();
            updateFloorsList(projectsList);
          }
        }
      });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initSearchAndFilter);
    } else {
      initSearchAndFilter();
    }


  Object.assign(Office, {
    updateTokenMeterDisplay,
    NotificationManager,
    updateFloorsList,
    selectProject,
    updateStatusDisplay,
    renderProjectLogs,
    resetStatusDisplayToIdle,
    updateHotJumpBanner,
    appendLog
  });

  window.updateTokenMeterDisplay = updateTokenMeterDisplay;
  window.NotificationManager = NotificationManager;
  window.updateFloorsList = updateFloorsList;
  window.selectProject = selectProject;
  window.updateStatusDisplay = updateStatusDisplay;
  window.renderProjectLogs = renderProjectLogs;
  window.resetStatusDisplayToIdle = resetStatusDisplayToIdle;
  window.updateHotJumpBanner = updateHotJumpBanner;
  window.appendLog = appendLog;

})(window);
