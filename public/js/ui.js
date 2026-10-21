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
    prettyToolName,
    escapeHtml,
    playSound
  } = Office;

    // 값이 바뀔 때만 DOM에 쓰기 (같은 값 재기록도 mutation/스타일 무효화를 일으킴). textContent 비교라 레이아웃 강제 없음
    function setText(el, v) {
      v = String(v);
      if (el && el.textContent !== v) el.textContent = v;
    }
    function setAttr(el, name, v) {
      if (el.getAttribute(name) !== v) el.setAttribute(name, v);
    }

    // 토큰 사용량 카드 갱신 (사용량 정보가 없으면 숨김)
    function updateTokenMeterDisplay(usage) {
      const box = document.getElementById('tokenMeterBox');
      if (!box) return;

      if (!usage || !usage.hasData) {
        box.style.display = 'none';
        return;
      }

      box.style.display = 'block';
      const inEl = document.getElementById('tokenInputVal');
      const outEl = document.getElementById('tokenOutputVal');
      const cacheEl = document.getElementById('tokenCacheVal');
      const totalEl = document.getElementById('tokenTotalVal');


      const modelBadge = document.getElementById('tokenModelBadge');
      if (modelBadge) {
        setText(modelBadge, usage.model || '-');
        setAttr(modelBadge, 'title', usage.model || '');
      }

      const costRow = document.getElementById('tokenCostRow');
      const costVal = document.getElementById('tokenCostVal');
      const cost = calculateEstimatedCost(usage, usage.model);
      if (cost !== null && costRow && costVal) {
        costRow.style.display = 'inline';
        setText(costVal, `$${cost.toFixed(4)}`);
      } else if (costRow) {
        costRow.style.display = 'none';
      }

      const total = Math.max(1, (usage.inputTokens || 0) + (usage.outputTokens || 0) + (usage.cacheTokens || 0));
      const setBar = (id, v) => {
        const el = document.getElementById(id);
        if (el) el.style.width = `${Math.max(2, Math.round(((v || 0) / total) * 100))}%`;
      };
      setBar('tokenInputBar', usage.inputTokens);
      setBar('tokenOutputBar', usage.outputTokens);
      setBar('tokenCacheBar', usage.cacheTokens);
      setText(inEl, formatCompactTokenCount(usage.inputTokens));
      setText(outEl, formatCompactTokenCount(usage.outputTokens));
      setText(cacheEl, formatCompactTokenCount(usage.cacheTokens));
      if (totalEl) {
        setText(totalEl, formatCompactTokenCount(usage.totalTokens));
        setAttr(totalEl, 'title', formatTokenCount(usage.totalTokens));
      }
      updateBurnRate(Office.activeProjectKey, usage.totalTokens);
    }

    // 토큰 소모 속도 (최근 20개 샘플 기준)
    const projectTokenHistory = new Map();

    function updateBurnRate(projectKey, totalTokens) {
      const rateVal = document.getElementById('tokenBurnRateVal');
      if (!rateVal || !totalTokens) return;
      const pKey = projectKey || 'default';
      if (!projectTokenHistory.has(pKey)) projectTokenHistory.set(pKey, []);
      const history = projectTokenHistory.get(pKey);
      const now = Date.now();
      const last = history[history.length - 1];
      if (!last || last.total !== totalTokens || (now - last.time >= 3000)) {
        history.push({ time: now, total: totalTokens });
        if (history.length > 20) history.shift();
      }
      let rate = 0;
      if (history.length >= 2) {
        const first = history[0];
        const latest = history[history.length - 1];
        const dt = (latest.time - first.time) / 1000;
        if (dt > 0.5 && latest.total >= first.total) rate = Math.round((latest.total - first.total) / dt);
      }
      setText(rateVal, `${formatCompactTokenCount(rate)}/s`);
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
        const isGranted = this.enabled && window.Notification && Notification.permission === 'granted';
        if (icon) {
          icon.innerHTML = isGranted
            ? '<svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>'
            : '<svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M13.73 21a2 2 0 0 1-3.46 0"></path><path d="M18.63 13A17.89 17.89 0 0 1 18 8"></path><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"></path><path d="M18 8a6 6 0 0 0-9.33-5"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
        }
        if (btn) {
          btn.classList.toggle('is-on', Boolean(isGranted));
          btn.title = isGranted ? '데스크톱 알림 켜짐' : '데스크톱 알림 꺼짐';
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
                title: `[${pName}] 도구 연속 3회 오류`,
                body: ev.errorSummary || '작업 중 오류가 3번 연속 발생했습니다.',
                blinkText: '[ERROR] 연속 에러 발생'
              });
            }
          } else {
            this.consecutiveErrors.set(ev.sessionId, 0);
          }
        }

        // 4. 내 응답 필요 (ask_user)
        if (ev.action === 'ask_user') {
          const pKey = ev.projectKey || (ev.cwd ? ev.cwd : null);
          if (pKey) {
            this.unreadQuestionFloors.add(pKey);
            updateFloorsList(projectsList);
            updateHotJumpBanner();
          }
          this.triggerAlert({
            type: 'ask',
            title: `[${pName}] 내 응답 필요`,
            body: ev.questionText || '에이전트가 질문을 보냈습니다.',
            blinkText: '[INPUT] 응답 필요'
          });
        }

        // 5. 작업 완료 (turn_finish) -> 사용자 다음 지시/응답 대기 플래그 등록
        if (ev.action === 'turn_finish') {
          const pKey = ev.projectKey || (ev.cwd ? ev.cwd : null);
          if (pKey) {
            this.unreadQuestionFloors.add(pKey);
            updateFloorsList(projectsList);
            updateHotJumpBanner();
          }
          this.triggerAlert({
            type: 'finish',
            title: `[${pName}] 작업 완료`,
            body: ev.resultSummary || '에이전트가 업무를 마무리했습니다.',
            blinkText: '[DONE] 작업 완료'
          });
        }

        // 6. 사용자 입력 수신 (user_input) -> 응답 필요 상태 해제
        if (ev.action === 'user_input') {
          const pKey = ev.projectKey || (ev.cwd ? ev.cwd : null);
          if (pKey) {
            this.unreadQuestionFloors.delete(pKey);
            updateFloorsList(projectsList);
            updateHotJumpBanner();
          }
        }
      },

      markFloorQuestion(pKey, isWaiting) {
        if (!pKey) return;
        // 매 tool_start마다 호출되므로 상태가 그대로면 층 목록을 다시 그리지 않음
        if (this.unreadQuestionFloors.has(pKey) === Boolean(isWaiting)) return;
        if (isWaiting) {
          this.unreadQuestionFloors.add(pKey);
        } else {
          this.unreadQuestionFloors.delete(pKey);
        }
        updateFloorsList(projectsList);
        updateHotJumpBanner();
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

    // I. 백화점 층별 안내 사이드바 (최고층이 맨 위!)
    // ----------------------------------------------------
    const floorCardElements = new Map();

    function relativeTime(ts) {
      if (!ts) return '';
      const diff = Math.max(0, Date.now() - ts);
      const m = Math.floor(diff / 60000);
      if (m < 1) return '방금';
      if (m < 60) return `${m}분 전`;
      const h = Math.floor(m / 60);
      if (h < 24) return `${h}시간 전`;
      return `${Math.floor(h / 24)}일 전`;
    }

    function renderFloorCard(card, p, isActive, hasUnread) {
      const cls = ['floor-card'];
      if (isActive) cls.push('active');
      if (p.isActive) cls.push('working');
      if (hasUnread) cls.push('awaiting');
      const expectedClass = cls.join(' ');
      if (card.className !== expectedClass) card.className = expectedClass;
      setAttr(card, 'aria-selected', isActive ? 'true' : 'false');

      const sessions = p.sessions || [];
      const now = Date.now();
      const dots = sessions.slice(0, 6).map(sx => {
        const idle = now - sx.lastActiveTime > 15 * 60 * 1000 ? ' idle' : '';
        return `<span class="floor-dot ${escapeHtml(sx.engine || '')}${idle}" title="${escapeHtml(sx.engine || '')}"></span>`;
      }).join('') + (p.activeSubagents > 0 ? '<span class="floor-dot sub" title="서브에이전트"></span>'.repeat(Math.min(3, p.activeSubagents)) : '');

      let badge = '';
      if (hasUnread) badge = '<span class="floor-badge">💬 답변 대기</span>';
      else if (p.isActive) badge = '<span class="floor-badge working">● 일하는 중</span>';

      const html = `
          <span class="floor-num">${escapeHtml(p.floor)}F</span>
          <div class="floor-info">
            <div class="floor-title">${escapeHtml(p.projectName)}</div>
            <div class="floor-meta">세션 ${sessions.length}개 · ${escapeHtml(relativeTime(p.lastActiveTime))}</div>
            ${badge || `<div class="floor-dots">${dots}</div>`}
          </div>
        `;
      if (card.__html !== html) {
        card.__html = html;
        card.innerHTML = html;
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
      setText(elAll, all);
      setText(elWorking, working);
      setText(elQuestion, question);
    }

    function updateHotJumpBanner() {
      const banner = document.getElementById('hotJumpBanner');
      const text = document.getElementById('hotJumpText');
      if (!banner || !text) return;
      if (NotificationManager.unreadQuestionFloors.size === 0) {
        banner.style.display = 'none';
        return;
      }
      // 현재 보고 있는 층이 응답 대기 상태인 경우
      if (NotificationManager.unreadQuestionFloors.has(activeProjectKey)) {
        const p = (projectsList || []).find(x => x.projectKey === activeProjectKey);
        const floorStr = p ? `${p.floor}F ` : '';
        setText(text, `${floorStr}내 응답 필요 (대기 중)`);
        banner.style.display = 'inline-flex';
        banner.onclick = () => {
          const detail = document.getElementById('agentStatusDetail');
          if (detail) detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        };
        return;
      }
      // 다른 층이 응답 대기 상태인 경우 빠른 점프 제공
      const firstUnreadKey = NotificationManager.unreadQuestionFloors.values().next().value;
      const p = (projectsList || []).find(x => x.projectKey === firstUnreadKey);
      const floorStr = p ? `${p.floor}F ` : '';
      setText(text, `${floorStr}응답 필요`);
      banner.style.display = 'inline-flex';
      banner.onclick = () => {
        selectProject(firstUnreadKey);
      };
    }

    // SSE(projects_update, 알림 상태 변경)가 몰려도 층 목록은 프레임당 한 번만 그림
    let floorsRenderPending = false;
    function updateFloorsList(projects) {
      projectsList = projects;
      if (floorsRenderPending) return;
      floorsRenderPending = true;
      requestAnimationFrame(() => {
        floorsRenderPending = false;
        renderFloorsListNow(projectsList);
      });
    }

    function renderFloorsListNow(projects) {
      projectsList = projects;
      const listContainer = document.getElementById('floorsList');
      if (!listContainer) return;

      if (projects && Array.isArray(projects)) {
        for (const p of projects) {
          if (p.isAwaitingUser) {
            NotificationManager.unreadQuestionFloors.add(p.projectKey);
          }
        }
      }

      updateFilterCounts(projects);
      updateHotJumpBanner();

      const footer = document.getElementById('buildingFooter');
      setText(footer, `층 ${projects ? projects.length : 0}개`);

      if (!projects || projects.length === 0) {
        listContainer.innerHTML = '<div class="floor-empty"><b>아직 입주한 층이 없어요</b>Claude Code나 Antigravity 세션을 실행하면 자동으로 층이 생겨요.</div>';
        return;
      }

      const visibleProjects = filterProjects(projects);

      if (visibleProjects.length === 0) {
        listContainer.innerHTML = '<div class="floor-empty"><b>찾는 층이 없어요</b>검색어나 필터를 바꿔 보세요.</div>';
        return;
      } else {
        const emptyMsg = listContainer.querySelector('.floor-empty');
        if (emptyMsg) emptyMsg.remove();
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
        setAttr(card, 'title', `${p.floor}F: ${p.projectName} (${p.cwd})`);
        setAttr(card, 'aria-label', `${p.floor}층 ${p.projectName}`);

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
          renderFloorHeader(p);
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
        feed.innerHTML = '<div class="log-empty">아직 기록이 없어요. 이 층에서 Claude나 Antigravity가 움직이면 여기에 쌓여요.</div>';
        return;
      }
      for (const ev of logs) appendLog(ev);
    }

    function resetStatusDisplayToIdle() {
      const badge = document.getElementById('agentStateBadge');
      const detail = document.getElementById('agentStatusDetail');
      if (badge) {
        badge.className = 'state-badge state-IDLE';
        badge.innerText = '대기 중';
      }
      if (detail) {
        detail.innerHTML = '<div class="status-empty">최근 활동이 없습니다.</div>';
      }
    }

    function renderFloorHeader(p) {
      const set = (id, v, title) => {
        const el = document.getElementById(id);
        if (!el) return;
        setText(el, v);
        if (title !== undefined) setAttr(el, 'title', String(title));
      };
      const sessions = p.sessions || [];
      const latest = sessions.slice().sort((a, b) => b.lastActiveTime - a.lastActiveTime)[0];
      const engine = (p.engine || 'local').toLowerCase();
      set('currentFloorTag', `${p.floor}F`);
      set('currentProjectTitle', p.projectName, p.projectName);
      set('currentSessionSubtitle', p.cwd, p.cwd);
      set('sessionPill', `세션 ${sessions.length}개`);
      set('currentEngineTag', engine === 'claude' ? 'Claude' : (engine === 'antigravity' ? 'Antigravity' : engine));
      const enginePill = document.getElementById('currentEngineTag');
      if (enginePill && enginePill.className !== `engine-pill ${engine}`) enginePill.className = `engine-pill ${engine}`;
      set('journalFolder', p.cwd, p.cwd);
      set('journalSession', latest ? latest.sessionId.slice(0, 8) : '-', latest ? latest.sessionId : '');
      set('journalEngine', engine === 'claude' ? 'Claude Code' : (engine === 'antigravity' ? 'Antigravity CLI' : engine));
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
        renderFloorHeader(p);
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

      renderFloorsListNow(projectsList);

      const activeCard = floorCardElements.get(pKey);
      if (activeCard && typeof activeCard.scrollIntoView === 'function') {
        activeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    // 상태 상세 영역을 라벨/값 행으로 렌더링 (내보내기용 innerText도 "라벨 값" 형태로 유지)
    function renderStatusRows(detail, rows) {
      detail.textContent = '';
      for (const [label, value] of rows) {
        if (value === undefined || value === null || value === '') continue;
        const row = document.createElement('div');
        row.className = 'status-row';
        const k = document.createElement('span');
        k.className = 'status-key';
        k.textContent = label;
        const v = document.createElement('span');
        v.className = 'status-val';
        v.textContent = String(value);
        v.title = String(value);
        row.append(k, v);
        detail.appendChild(row);
      }
    }

    function agentLabel(ev) {
      if (typeof ev.agentId === 'string' && ev.agentId.startsWith('sub_')) {
        return ev.subagentRole || ev.subagentName || '서브에이전트';
      }
      return ev.agentId === 'ops' ? 'DevOps' : '메인';
    }

    function updateStatusDisplay(ev) {
      const badge = document.getElementById('agentStateBadge');
      const detail = document.getElementById('agentStatusDetail');
      if (!badge || !detail || !ev) return;

      const roomName = ROOM_DEFS[ev.room]?.name;
      const agent = agentLabel(ev);
      let state = 'IDLE';
      let label = '대기 중';
      let rows = [];

      if (ev.action === 'thinking') {
        state = 'THINKING'; label = '생각 중';
        rows = [['에이전트', agent], ['내용', ev.thinkingText || '-']];
      } else if (ev.action === 'tool_start') {
        const detailObj = extractTaskDetail(ev.room || 'research', ev.toolName, ev.toolArgs, ev.toolSummary);
        state = 'WORKING'; label = '도구 실행';
        rows = [['에이전트', agent], ['도구', prettyToolName(ev.toolName)], ['위치', roomName], ['작업', `${detailObj.prefix}${detailObj.text}`]];
      } else if (ev.action === 'tool_end') {
        if (ev.isError) {
          state = 'ERROR'; label = '오류';
          rows = [['에이전트', agent], ['위치', roomName], ['오류', ev.errorSummary || '도구 실행 실패']];
        } else {
          state = 'IDLE'; label = '도구 완료';
          rows = [['에이전트', agent], ['위치', roomName], ['결과', ev.resultSummary || '정상 완료']];
        }
      } else if (ev.action === 'ask_user') {
        state = 'ASKING'; label = '응답 필요';
        rows = [['질문', ev.questionText || '사용자 확인이 필요합니다']];
      } else if (ev.action === 'subagent_spawn') {
        state = 'WORKING'; label = '서브에이전트 시작';
        rows = [['유형', ev.subagentRole], ['작업', ev.subagentName]];
      } else if (ev.action === 'subagent_finish') {
        state = 'REPORTING'; label = '서브에이전트 완료';
        rows = [['유형', ev.subagentRole], ['작업', ev.subagentName], ['보고', ev.resultSummary || '작업 완료']];
      } else if (ev.action === 'turn_finish') {
        state = 'ASKING'; label = '턴 완료';
        rows = [['요약', ev.resultSummary || '작업이 끝났습니다. 다음 지시를 기다립니다.']];
      } else if (ev.action === 'user_input') {
        state = 'WORKING'; label = '입력 수신';
        rows = [['입력', ev.userPrompt || '새로운 지시']];
      } else {
        return;
      }

      badge.className = `state-badge state-${state}`;
      badge.innerText = label;
      renderStatusRows(detail, rows);
    }

    // 이벤트 로그 배지 라벨 및 색상 분류
    const LOG_KINDS = {
      tool_start: { label: '도구', cls: 'k-tool' },
      tool_end: { label: '결과', cls: 'k-result' },
      thinking: { label: '생각', cls: 'k-think' },
      ask_user: { label: '질문', cls: 'k-ask' },
      turn_finish: { label: '완료', cls: 'k-done' },
      user_input: { label: '지시', cls: 'k-user' },
      subagent_spawn: { label: '위임', cls: 'k-sub' },
      subagent_finish: { label: '보고', cls: 'k-sub' }
    };

    function appendLog(ev, smartScroll = true) {
      const feed = document.getElementById('eventLogFeed');
      if (!feed || !ev) return;

      const empty = feed.querySelector('.log-empty');
      if (empty) empty.remove();

      // 성공한 결과는 새 줄 대신 해당 도구 줄에 한 줄로 붙여 일지를 짧게 유지
      if (ev.action === 'tool_end' && !ev.isError && ev.toolUseId) {
        const owner = feed.querySelector(`:scope > [data-tool-use-id="${CSS.escape(ev.toolUseId)}"]`);
        if (owner && !owner.querySelector('.log-result')) {
          const res = document.createElement('span');
          res.className = 'log-result';
          res.textContent = String(ev.resultSummary || '정상 완료').replace(/\s+/g, ' ').trim();
          res.title = res.textContent;
          owner.classList.add('is-done');
          owner.appendChild(res);
          return;
        }
      }

      const kind = ev.isError ? { label: '오류', cls: 'k-error' } : (LOG_KINDS[ev.action] || { label: (ev.action || 'EVENT').toUpperCase(), cls: 'k-system' });
      const item = document.createElement('div');
      item.className = `log-item ${kind.cls}`;
      if (ev.action === 'tool_start' && ev.toolUseId) item.dataset.toolUseId = ev.toolUseId;
      const isSubagentEvent = typeof ev.agentId === 'string' && ev.agentId.startsWith('sub_');

      const timeStr = new Date(ev.timestamp || Date.now()).toTimeString().slice(0, 5);
      const detailObj = (ev.action === 'tool_start') ? extractTaskDetail(ev.room || 'research', ev.toolName, ev.toolArgs, ev.toolSummary) : null;
      const msgStr = (detailObj ? `${detailObj.prefix}${detailObj.text}` : (ev.toolSummary || ev.thinkingText || ev.questionText || ev.errorSummary || ev.resultSummary || ev.userPrompt || ev.subagentName || '이벤트'))
        .replace(/\s+/g, ' ').trim();

      const timeSpan = document.createElement('span');
      timeSpan.className = 'log-time';
      timeSpan.textContent = timeStr;

      const tagSpan = document.createElement('span');
      tagSpan.className = 'log-tag';
      tagSpan.textContent = ev.action === 'tool_start' && ev.toolName ? `${kind.label} · ${prettyToolName(ev.toolName)}` : kind.label;

      item.append(timeSpan, tagSpan);

      if (isSubagentEvent || ev.agentId === 'ops') {
        const who = document.createElement('span');
        who.className = 'log-agent';
        who.textContent = agentLabel(ev);
        item.appendChild(who);
      }

      const msgSpan = document.createElement('span');
      msgSpan.className = 'log-msg';
      msgSpan.textContent = msgStr;
      msgSpan.title = msgStr;
      item.appendChild(msgSpan);
      feed.insertBefore(item, feed.firstChild);

      while (feed.children.length > 80) feed.removeChild(feed.lastChild);
      void smartScroll;
    }

    // ----------------------------------------------------
    // 방/에이전트 인터랙티브 인스펙터 모달 (Room Inspector)
    // ----------------------------------------------------
    const ROOM_ICONS = {
      elevator: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><polyline points="7 10 12 5 17 10"/><polyline points="7 14 12 19 17 14"/></svg>',
      archive: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
      dev: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
      server: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>',
      research: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
      meeting: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
      user_desk: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>'
    };

    function openRoomInspector(roomId) {
      const { ROOM_DEFS, getProjectTaskStates } = Office;
      const modal = document.getElementById('roomInspectorModal');
      if (!modal || !ROOM_DEFS || !ROOM_DEFS[roomId]) return;

      const pKey = Office.activeProjectKey || 'default';
      const p = (projectsList || []).find(x => x.projectKey === pKey);
      const floorStr = p ? `${p.floor}F ${escapeHtml(p.projectName)}` : 'Office Inspector';
      const def = ROOM_DEFS[roomId];
      const tasks = getProjectTaskStates ? getProjectTaskStates(pKey) : null;
      const rState = tasks ? tasks[roomId] : null;

      const iconEl = document.getElementById('inspectorIcon');
      if (iconEl) {
        iconEl.innerHTML = ROOM_ICONS[roomId] || '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>';
      }
      document.getElementById('inspectorTitle').innerText = `${def.name} 상세 인스펙터`;
      document.getElementById('inspectorSubtitle').innerText = floorStr;

      let fullTarget = '';
      let fullTargetLabel = '상세 정보';
      if (roomId === 'dev') {
        fullTargetLabel = '수정 중인 파일 전체 경로';
        if (rState && rState.currentArgs) {
          fullTarget = rState.currentArgs.Path || rState.currentArgs.file_path || rState.currentArgs.TargetFile || rState.currentArgs.path || rState.text;
        } else {
          fullTarget = (rState && rState.text) ? rState.text : '대기 중 (수정된 파일 없음)';
        }
      } else if (roomId === 'server') {
        fullTargetLabel = '실행 명령어 전체';
        if (rState && rState.currentArgs) {
          fullTarget = rState.currentArgs.CommandLine || rState.currentArgs.command || rState.currentArgs.cmd || rState.text;
        } else {
          fullTarget = (rState && rState.text) ? rState.text : '대기 중 (실행 중인 명령어 없음)';
        }
      } else if (roomId === 'archive') {
        fullTargetLabel = '읽은 파일 경로 / 검색 패턴';
        if (rState && rState.currentArgs) {
          fullTarget = rState.currentArgs.Path || rState.currentArgs.file_path || rState.currentArgs.pattern || rState.currentArgs.glob || rState.text;
        } else {
          fullTarget = (rState && rState.text) ? rState.text : '대기 중 (검색/참조 내역 없음)';
        }
      } else if (roomId === 'research') {
        fullTargetLabel = '검색 질의어 / MCP 도구명';
        if (rState && rState.currentArgs) {
          fullTarget = rState.currentArgs.query || rState.currentArgs.Url || rState.currentArgs.url || rState.currentArgs.ToolName || rState.text;
        } else {
          fullTarget = (rState && rState.text) ? rState.text : '대기 중 (검색 활동 없음)';
        }
      } else if (roomId === 'meeting') {
        fullTargetLabel = '에이전트 실시간 사고 (Thinking)';
        fullTarget = (rState && rState.history && rState.history[0]?.detailText) || '회의 및 종합 계획 대기 중';
      } else if (roomId === 'user_desk') {
        fullTargetLabel = '사용자 질문 및 인터랙션';
        fullTarget = (rState && rState.history && rState.history[0]?.detailText) || '새로운 질문 대기 중';
      } else {
        fullTargetLabel = '상태';
        fullTarget = '서브에이전트 위임 및 프로세스 출퇴근 통로';
      }

      const isActive = rState && rState.active;
      const historyList = (rState && rState.history) || [];

      let historyHtml = '';
      if (historyList.length > 0) {
        historyHtml = historyList.map(item => `
          <div class="inspector-history-item">
            <div class="inspector-history-top">
              <span class="inspector-history-tool">${escapeHtml(item.toolName || 'ACTION')}</span>
              <span>${escapeHtml(item.time || '')}</span>
            </div>
            <div class="inspector-history-text">${escapeHtml(item.detailText || item.summary || '')}</div>
          </div>
        `).join('');
      } else {
        historyHtml = '<div style="color:#64748b; font-size:10.5px; padding:6px 0;">최근 작업 이력이 없습니다.</div>';
      }

      const bodyEl = document.getElementById('inspectorBody');
      bodyEl.innerHTML = `
        <div>
          <div class="inspector-section-label">
            <span>방 상태 (ROOM STATUS)</span>
            <span class="state-badge ${isActive ? 'state-WORKING' : 'state-IDLE'}">${isActive ? '작업 진행 중' : '대기 중'}</span>
          </div>
          <div class="inspector-section-label" style="margin-top:10px;">
            <span>${escapeHtml(fullTargetLabel)}</span>
            <button type="button" class="btn-copy-code" id="btnCopyInspectorTarget">
              <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              <span>복사</span>
            </button>
          </div>
          <div class="inspector-code-box" id="inspectorCodeBox">${escapeHtml(fullTarget)}</div>
        </div>

        <div>
          <div class="inspector-section-label">최근 방 작업 이력 (RECENT HISTORY)</div>
          <div class="inspector-history-list">
            ${historyHtml}
          </div>
        </div>
      `;

      const btnCopy = document.getElementById('btnCopyInspectorTarget');
      if (btnCopy) {
        btnCopy.addEventListener('click', () => {
          if (navigator.clipboard) {
            navigator.clipboard.writeText(fullTarget).then(() => {
              btnCopy.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> <span>복사됨</span>';
              setTimeout(() => {
                btnCopy.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> <span>복사</span>';
              }, 1800);
            }).catch(() => {});
          }
        });
      }

      modal.style.display = 'flex';
      playSound('ding');
    }

    function closeRoomInspector() {
      const modal = document.getElementById('roomInspectorModal');
      if (modal) modal.style.display = 'none';
    }

    function initRoomInspectorModal() {
      const closeBtn = document.getElementById('btnInspectorClose');
      const backdrop = document.getElementById('inspectorBackdrop');
      if (closeBtn) closeBtn.addEventListener('click', closeRoomInspector);
      if (backdrop) backdrop.addEventListener('click', closeRoomInspector);

      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          const modal = document.getElementById('roomInspectorModal');
          if (modal && modal.style.display !== 'none') {
            closeRoomInspector();
          }
        }
      });

    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initRoomInspectorModal);
    } else {
      initRoomInspectorModal();
    }

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

    // 세션 마크다운 업무 리포트 1-Click 클립보드 복사
    function showToast(message, type = 'info') {
      const container = document.getElementById('toastContainer');
      if (!container) return;
      const toast = document.createElement('div');
      toast.className = `toast-message toast-${type}`;
      toast.textContent = message;
      container.appendChild(toast);

      setTimeout(() => {
        toast.classList.add('toast-leaving');
        setTimeout(() => {
          if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 300);
      }, 2800);
    }

    function exportSessionMarkdownReport() {
      const pKey = Office.activeProjectKey;
      const project = (Office.projectsList || []).find(p => p.projectKey === pKey);
      const now = new Date();
      const timeStr = now.toLocaleString('ko-KR', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
      });

      const projName = project ? project.projectName : (document.getElementById('currentProjectTitle')?.innerText || 'Unknown');
      const floor = project ? `${project.floor}F` : (document.getElementById('currentFloorTag')?.innerText || '-');
      const cwd = project ? (project.cwd || '-') : '-';
      const engine = project ? (project.engine || 'LOCAL').toUpperCase() : 'LOCAL';
      const sessionId = (project && project.sessions && project.sessions[0]) ? project.sessions[0].sessionId : '-';

      const stateBadge = document.getElementById('agentStateBadge')?.innerText || '대기 중';
      const stateDetail = document.getElementById('agentStatusDetail')?.innerText || '작업 대기 중';

      const model = document.getElementById('tokenModelBadge')?.innerText || '-';
      const inTok = document.getElementById('tokenInputVal')?.innerText || '0';
      const outTok = document.getElementById('tokenOutputVal')?.innerText || '0';
      const cacheTok = document.getElementById('tokenCacheVal')?.innerText || '0';
      const totalTok = document.getElementById('tokenTotalVal')?.innerText || '0';
      const cost = document.getElementById('tokenCostVal')?.innerText || '-';

      let report = `# 에이전트 오피스 (Agent Office) - 업무 세션 보고서\n\n`;
      report += `> 생성 일시: ${timeStr}\n\n`;
      report += `### 프로젝트 개요\n`;
      report += `- **프로젝트명**: ${projName}\n`;
      report += `- **위치**: ${floor}\n`;
      report += `- **실행 엔진**: ${engine}\n`;
      report += `- **작업 경로**: \`${cwd}\`\n`;
      report += `- **세션 ID**: \`${sessionId}\`\n\n`;

      report += `### 에이전트 상태\n`;
      report += `- **상태**: ${stateBadge}\n`;
      report += `- **상세 활동**: ${stateDetail}\n\n`;

      report += `### 리소스 및 토큰 사용량\n`;
      report += `- **사용 모델**: \`${model}\`\n`;
      report += `- **입력 토큰 (Prompt)**: ${inTok}\n`;
      report += `- **출력 토큰 (Completion)**: ${outTok}\n`;
      report += `- **캐시 토큰 (Cache)**: ${cacheTok}\n`;
      report += `- **총 토큰 합계**: ${totalTok}\n`;
      if (cost !== '-') {
        report += `- **예상 비용**: ${cost}\n`;
      }
      report += `\n`;

      report += `### 각 룸별 최근 수행 작업\n`;
      const roomNames = {
        dev: '개발실 (코드 편집/생성)',
        server: '서버실 (명령어/터미널)',
        research: '정보검색실 (웹/문서 탐색)',
        archive: '자료실 (파일 인덱싱)',
        meeting: '회의실 (상태 브리핑)',
        user_desk: '사용자 데스크 (인터뷰/질문)',
        elevator: '엘리베이터 (세션 진입)'
      };

      const roomStates = Office.getProjectTaskStates ? Office.getProjectTaskStates(pKey) : {};
      let hasRoomData = false;
      for (const [rId, name] of Object.entries(roomNames)) {
        const st = roomStates[rId];
        if (st && (st.text || st.currentSummary || (st.history && st.history.length > 0))) {
          hasRoomData = true;
          report += `#### ${name}\n`;
          if (st.currentSummary) {
            report += `- **현재/최근 작업**: ${st.currentSummary}\n`;
          }
          if (st.currentTool) {
            report += `- **실행 도구**: \`${st.currentTool}\`\n`;
          }
          if (st.history && st.history.length > 0) {
            report += `- **최근 작업 이력** (${st.history.length}건):\n`;
            st.history.slice(0, 5).forEach(h => {
              report += `  - [${h.time}] \`${h.toolName || '-'}\` ${h.detailText || h.summary || ''}\n`;
            });
          }
          report += `\n`;
        }
      }

      if (!hasRoomData) {
        report += `*(기록된 룸 작업 내역이 없습니다)*\n\n`;
      }

      report += `---\n*Generated automatically by Agent Office Workstation*\n`;

      navigator.clipboard.writeText(report).then(() => {
        const btn = document.getElementById('btnExportReport');
        if (btn) {
          btn.classList.add('btn-copied');
          const origHtml = btn.innerHTML;
          btn.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> <span class="btn-action-text">복사 완료</span>`;
          setTimeout(() => {
            btn.classList.remove('btn-copied');
            btn.innerHTML = origHtml;
          }, 2500);
        }
        showToast('세션 마크다운 업무 보고서가 클립보드에 복사되었습니다.', 'success');
        if (Office.playSound) Office.playSound('report');
      }).catch(err => {
        console.error('Failed to copy report:', err);
        showToast('클립보드 복사 권한 오류가 발생했습니다.', 'error');
      });
    }

    function initReportExport() {
      const btn = document.getElementById('btnExportReport');
      if (btn) {
        btn.onclick = exportSessionMarkdownReport;
      }
    }

    initReportExport();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initSearchAndFilter);
    } else {
      initSearchAndFilter();
    }


    // ----------------------------------------------------
    // 에이전트 카드 (현재 층 메인 에이전트의 상태 요약)
    // ----------------------------------------------------
    const AVATAR_STYLE = {
      claude: { shirt: '#d97757', hair: '#5b3a29', bg: '#fff1ea' },
      antigravity: { shirt: '#38a3e8', hair: '#1e293b', bg: '#e8f4fd' }
    };

    function describeAgentState(ag) {
      const room = (Office.ROOM_DEFS[ag.currentRoom] || {}).name || '';
      switch (ag.state) {
        case 'WALKING': return { text: `${room}(으)로 가는 중`, cls: 's-walking' };
        case 'WORKING': return { text: `${room}에서 일하는 중`, cls: 's-working' };
        case 'THINKING':
        case 'PONDERING': return { text: `${room}에서 생각 중`, cls: '' };
        case 'ASKING': return { text: `${room}에서 답 기다리는 중`, cls: 's-asking' };
        case 'REPORTING': return { text: '보고 완료 · 다음 지시 대기', cls: 's-asking' };
        case 'ERROR': return { text: '오류 확인 중', cls: 's-error' };
        case 'LEAVING': return { text: '퇴근하는 중', cls: 's-walking' };
        case 'GONE': return { text: '퇴근함', cls: '' };
        default: return { text: '대기 중', cls: '' };
      }
    }

    function formatDuration(ms) {
      const m = Math.floor(ms / 60000);
      if (m < 1) return '방금 출근';
      if (m < 60) return `${m}분째 근무`;
      const h = Math.floor(m / 60);
      return `${h}시간 ${m % 60}분째 근무`;
    }

    function updateAgentCard() {
      if (document.hidden) return;
      const agents = Office.getProjectAgents ? Office.getProjectAgents(Office.activeProjectKey) : null;
      if (!agents) return;
      const main = agents.get('main');
      if (!main) return;

      const style = AVATAR_STYLE[main.engine] || AVATAR_STYLE.antigravity;
      const avatar = document.getElementById('agentAvatar');
      if (avatar) {
        avatar.style.background = style.bg;
        avatar.style.setProperty('--avatar-shirt', style.shirt);
        avatar.style.setProperty('--avatar-hair', style.hair);
      }
      const nameEl = document.getElementById('agentName');
      setText(nameEl, main.role);

      const st = describeAgentState(main);
      const pill = document.getElementById('agentStatusPill');
      if (pill) {
        setText(pill, st.text);
        if (pill.className !== `agent-status ${st.cls}`) pill.className = `agent-status ${st.cls}`;
      }

      let tools = 0;
      for (const ag of agents.values()) tools += ag.toolCount || 0;
      const first = Office.projectFirstEventTime ? Office.projectFirstEventTime.get(Office.activeProjectKey) : null;
      const meta = document.getElementById('agentMeta');
      setText(meta, `도구 ${tools}회 · ${first ? formatDuration(Date.now() - first) : '대기 중'}`);

      const team = document.getElementById('agentTeam');
      if (team) {
        const chips = [];
        for (const ag of agents.values()) {
          if (ag.id === 'main' || ag.state === 'GONE') continue;
          const on = ag.state === 'WORKING' || ag.isMoving;
          chips.push(`<span class="team-chip${on ? ' on' : ''}" title="${escapeHtml(describeAgentState(ag).text)}">${escapeHtml(ag.role)}</span>`);
        }
        const html = chips.join('');
        if (team.__html !== html) {
          team.__html = html;
          team.innerHTML = html;
        }
      }
    }
    setInterval(updateAgentCard, 500);

    // ----------------------------------------------------
    // 사무실 도구 버튼 (확대/축소/맞춤/낮밤)
    // ----------------------------------------------------
    const ICON_MOON = '<svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
    const ICON_SUN = '<svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.5"></circle><line x1="12" y1="2" x2="12" y2="4"></line><line x1="12" y1="20" x2="12" y2="22"></line><line x1="4.9" y1="4.9" x2="6.3" y2="6.3"></line><line x1="17.7" y1="17.7" x2="19.1" y2="19.1"></line><line x1="2" y1="12" x2="4" y2="12"></line><line x1="20" y1="12" x2="22" y2="12"></line><line x1="4.9" y1="19.1" x2="6.3" y2="17.7"></line><line x1="17.7" y1="6.3" x2="19.1" y2="4.9"></line></svg>';

    function updateNightButton() {
      const btn = document.getElementById('btnNight');
      const icon = document.getElementById('nightIcon');
      const night = Office.Iso && Office.Iso.isNight();
      if (icon) icon.innerHTML = night ? ICON_MOON : ICON_SUN;
      if (btn) {
        btn.classList.toggle('is-night', Boolean(night));
        btn.title = night ? '밤 (클릭하면 낮으로)' : '낮 (클릭하면 밤으로)';
      }
    }

    function initStageTools() {
      const on = (id, fn) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', fn);
      };
      on('btnZoomIn', () => Office.Iso && Office.Iso.zoomIn());
      on('btnZoomOut', () => Office.Iso && Office.Iso.zoomOut());
      on('btnFit', () => Office.Iso && Office.Iso.fit());
      on('btnNight', () => {
        if (!Office.Iso) return;
        Office.Iso.toggleNight();
        updateNightButton();
      });
      updateNightButton();
    }

  Object.assign(Office, {
    initStageTools,
    updateNightButton,
    updateTokenMeterDisplay,
    NotificationManager,
    updateFloorsList,
    selectProject,
    updateStatusDisplay,
    renderProjectLogs,
    resetStatusDisplayToIdle,
    updateHotJumpBanner,
    openRoomInspector,
    closeRoomInspector,
    appendLog,
    showToast,
    exportSessionMarkdownReport,
    updateAgentCard
  });

  window.updateTokenMeterDisplay = updateTokenMeterDisplay;
  window.NotificationManager = NotificationManager;
  window.updateFloorsList = updateFloorsList;
  window.selectProject = selectProject;
  window.updateStatusDisplay = updateStatusDisplay;
  window.renderProjectLogs = renderProjectLogs;
  window.resetStatusDisplayToIdle = resetStatusDisplayToIdle;
  window.updateHotJumpBanner = updateHotJumpBanner;
  window.openRoomInspector = openRoomInspector;
  window.closeRoomInspector = closeRoomInspector;
  window.appendLog = appendLog;
  window.showToast = showToast;
  window.exportSessionMarkdownReport = exportSessionMarkdownReport;

})(window);
