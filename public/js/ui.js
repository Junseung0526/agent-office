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

      // 미니 네온 스파크라인 번레이트 차트 업데이트
      updateTokenSparkline(Office.activeProjectKey, usage.totalTokens);
    }

    // 세션별 토큰 소모율 미니 네온 스파크라인 그래프
    const projectTokenHistory = new Map();

    function updateTokenSparkline(projectKey, totalTokens) {
      const row = document.getElementById('tokenSparklineRow');
      const canvas = document.getElementById('tokenSparkline');
      const rateVal = document.getElementById('tokenBurnRateVal');
      if (!row || !canvas) return;

      if (!totalTokens || totalTokens <= 0) {
        row.style.display = 'none';
        return;
      }
      row.style.display = 'flex';

      const pKey = projectKey || Office.activeProjectKey || 'default';
      if (!projectTokenHistory.has(pKey)) {
        projectTokenHistory.set(pKey, []);
      }
      const history = projectTokenHistory.get(pKey);
      const now = Date.now();

      const last = history[history.length - 1];
      if (!last || last.total !== totalTokens || (now - last.time >= 3000)) {
        history.push({ time: now, total: totalTokens });
        if (history.length > 20) history.shift();
      }

      let burnRateStr = '0 tok/s';
      if (history.length >= 2) {
        const first = history[0];
        const latest = history[history.length - 1];
        const dt = (latest.time - first.time) / 1000;
        const dTokens = latest.total - first.total;
        if (dt > 0.5 && dTokens >= 0) {
          const r = Math.round(dTokens / dt);
          burnRateStr = `${formatTokenCount(r)}/s`;
        }
      }
      if (rateVal) rateVal.innerText = burnRateStr;

      const sCtx = canvas.getContext('2d');
      const W = canvas.width;
      const H = canvas.height;
      sCtx.clearRect(0, 0, W, H);

      sCtx.strokeStyle = 'rgba(255,255,255,0.06)';
      sCtx.lineWidth = 1;
      sCtx.beginPath();
      sCtx.moveTo(0, H / 2);
      sCtx.lineTo(W, H / 2);
      sCtx.stroke();

      if (history.length === 1) {
        sCtx.strokeStyle = '#38bdf8';
        sCtx.lineWidth = 1.5;
        sCtx.beginPath();
        sCtx.moveTo(4, H / 2);
        sCtx.lineTo(W - 4, H / 2);
        sCtx.stroke();

        sCtx.beginPath();
        sCtx.arc(W - 4, H / 2, 2.5, 0, Math.PI * 2);
        sCtx.fillStyle = '#10b981';
        sCtx.fill();
        return;
      }

      const totals = history.map(h => h.total);
      const minVal = Math.min(...totals);
      const maxVal = Math.max(...totals);
      const range = (maxVal === minVal) ? 1 : (maxVal - minVal);

      const padX = 6;
      const padY = 5;
      const usableW = W - padX * 2;
      const usableH = H - padY * 2;

      const points = history.map((h, idx) => {
        const x = padX + (idx / (history.length - 1)) * usableW;
        const norm = (h.total - minVal) / range;
        const y = padY + usableH - norm * usableH;
        return { x, y };
      });

      const grad = sCtx.createLinearGradient(0, padY, 0, H);
      grad.addColorStop(0, 'rgba(56, 189, 248, 0.35)');
      grad.addColorStop(1, 'rgba(56, 189, 248, 0)');

      sCtx.beginPath();
      sCtx.moveTo(points[0].x, H);
      points.forEach(pt => sCtx.lineTo(pt.x, pt.y));
      sCtx.lineTo(points[points.length - 1].x, H);
      sCtx.closePath();
      sCtx.fillStyle = grad;
      sCtx.fill();

      sCtx.beginPath();
      points.forEach((pt, idx) => {
        if (idx === 0) sCtx.moveTo(pt.x, pt.y);
        else sCtx.lineTo(pt.x, pt.y);
      });
      sCtx.strokeStyle = '#38bdf8';
      sCtx.lineWidth = 1.5;
      sCtx.stroke();

      const lastPt = points[points.length - 1];
      sCtx.beginPath();
      sCtx.arc(lastPt.x, lastPt.y, 2.5, 0, Math.PI * 2);
      sCtx.fillStyle = '#10b981';
      sCtx.fill();
      sCtx.strokeStyle = '#ecfdf5';
      sCtx.lineWidth = 1;
      sCtx.stroke();
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
        const isGranted = this.enabled && window.Notification && Notification.permission === 'granted';
        if (icon) {
          icon.innerHTML = isGranted
            ? '<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>'
            : '<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M13.73 21a2 2 0 0 1-3.46 0"></path><path d="M18.63 13A17.89 17.89 0 0 1 18 8"></path><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"></path><path d="M18 8a6 6 0 0 0-9.33-5"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
        }
        if (text) text.innerText = isGranted ? '알림 켜짐' : '알림 꺼짐';
        if (btn) btn.style.borderColor = isGranted ? 'rgba(56, 189, 248, 0.4)' : 'rgba(255, 255, 255, 0.08)';
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
              ${hasUnread ? '<span class="floor-badge-alert" title="내 응답 필요!"><svg viewBox="0 0 24 24" width="10" height="10" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg></span>' : ''}
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
      // 현재 보고 있는 층이 응답 대기 상태인 경우
      if (NotificationManager.unreadQuestionFloors.has(activeProjectKey)) {
        const p = (projectsList || []).find(x => x.projectKey === activeProjectKey);
        const floorStr = p ? `${p.floor}F ` : '';
        text.innerText = `${floorStr}내 응답 필요 (대기 중)`;
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

      if (projects && Array.isArray(projects)) {
        for (const p of projects) {
          if (p.isAwaitingUser) {
            NotificationManager.unreadQuestionFloors.add(p.projectKey);
          }
        }
      }

      updateFilterCounts(projects);
      updateHotJumpBanner();

      if (!projects || projects.length === 0) {
        listContainer.innerHTML = `
          <div style="padding:28px 12px; text-align:center; color:#64748b; font-size:11px; line-height:1.5;">
            <svg viewBox="0 0 24 24" width="28" height="28" stroke="#475569" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:8px;"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><line x1="9" y1="22" x2="9" y2="22.01"></line><line x1="15" y1="22" x2="15" y2="22.01"></line><line x1="9" y1="6" x2="9.01" y2="6"></line><line x1="15" y1="6" x2="15.01" y2="6"></line><line x1="9" y1="10" x2="9.01" y2="10"></line><line x1="15" y1="10" x2="15.01" y2="10"></line><line x1="9" y1="14" x2="9.01" y2="14"></line><line x1="15" y1="14" x2="15.01" y2="14"></line><line x1="9" y1="18" x2="9.01" y2="18"></line><line x1="15" y1="18" x2="15.01" y2="18"></line></svg>
            <div style="font-weight:700; color:#94a3b8; margin-bottom:4px;">감지된 활성 세션 없음</div>
            <div>Claude Code 또는 Antigravity CLI 세션을 실행하면 자동으로 워크스페이스가 감지됩니다.</div>
          </div>
        `;
        return;
      }

      const visibleProjects = filterProjects(projects);

      if (visibleProjects.length === 0) {
        listContainer.innerHTML = `
          <div style="padding:28px 12px; text-align:center; color:#64748b; font-size:11px; line-height:1.5;">
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="#475569" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:6px;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <div style="font-weight:700; color:#94a3b8; margin-bottom:4px;">일치하는 워크스페이스 없음</div>
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
        badge.innerText = '응답 필요 (ASK)';
        badge.className = 'state-badge state-ASKING';
        detail.innerText = `질문: ${ev.questionText || '사용자 의견을 확인하고 있습니다.'}`;
      } else if (ev.action === 'subagent_spawn') {
        badge.innerText = '서브에이전트 배치';
        badge.className = 'state-badge state-WORKING';
        detail.innerText = `팀원 출근: ${ev.subagentName} (${ev.subagentRole})`;
      } else if (ev.action === 'turn_finish') {
        badge.innerText = '업무 완료 (AWAITING)';
        badge.className = 'state-badge state-ASKING';
        detail.innerText = `보고서: ${ev.resultSummary || '업무가 완료되었습니다. 다음 지시를 기다립니다.'}`;
      } else if (ev.action === 'user_input') {
        badge.innerText = '사용자 입력 (INPUT)';
        badge.className = 'state-badge state-WORKING';
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

      const canvas = document.getElementById('officeCanvas');
      if (canvas) {
        canvas.addEventListener('click', (e) => {
          const rect = canvas.getBoundingClientRect();
          const scaleX = 480 / rect.width;
          const scaleY = 270 / rect.height;
          const clickX = (e.clientX - rect.left) * scaleX;
          const clickY = (e.clientY - rect.top) * scaleY;

          // 캐릭터 직접 클릭 감지 (반경 18px x 24px) -> 재미있는 밈 대사 즉시 출력
          const currentAgents = Office.getProjectAgents ? Office.getProjectAgents(Office.activeProjectKey) : null;
          if (currentAgents) {
            for (const [_, ag] of currentAgents.entries()) {
              if (ag.state !== 'GONE' && Math.abs(ag.x - clickX) <= 18 && Math.abs(ag.y - 12 - clickY) <= 24) {
                if (typeof ag.sayRandomMeme === 'function') {
                  ag.sayRandomMeme();
                  return;
                }
              }
            }
          }

          const { ROOM_DEFS } = Office;
          if (!ROOM_DEFS) return;
          for (const rId in ROOM_DEFS) {
            const def = ROOM_DEFS[rId];
            if (clickX >= def.x && clickX <= def.x + def.w) {
              openRoomInspector(rId);
              break;
            }
          }
        });
      }
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

      const roomStates = Office.roomTaskStates || {};
      let hasRoomData = false;
      for (const [rId, name] of Object.entries(roomNames)) {
        const st = roomStates[rId];
        if (st && (st.taskText || st.currentSummary || (st.history && st.history.length > 0))) {
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
            st.history.slice(-5).forEach(h => {
              report += `  - [${h.time}] \`${h.tool}\` ${h.summary || ''}\n`;
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
          btn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> <span class="btn-action-text">복사 완료</span>`;
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

    // 레트로 CRT 스캔라인 화면 모드 토글
    function initCrtMode() {
      const btn = document.getElementById('btnToggleCrt');
      const wrapper = document.querySelector('.canvas-wrapper');
      const crtText = document.getElementById('crtStatusText');
      if (!btn || !wrapper) return;

      let isCrt = localStorage.getItem('agent_office_crt') === '1';

      function applyCrt(active) {
        if (active) {
          wrapper.classList.add('crt-active');
          btn.classList.add('crt-active');
          if (crtText) crtText.innerText = 'CRT ON';
          btn.title = '레트로 CRT 모드 켜짐 (클릭 시 끄기)';
        } else {
          wrapper.classList.remove('crt-active');
          btn.classList.remove('crt-active');
          if (crtText) crtText.innerText = 'CRT OFF';
          btn.title = '레트로 CRT 모드 꺼짐 (클릭 시 켜기)';
        }
      }

      applyCrt(isCrt);

      function toggleCrt() {
        isCrt = !isCrt;
        localStorage.setItem('agent_office_crt', isCrt ? '1' : '0');
        applyCrt(isCrt);
        if (Office.playSound) Office.playSound('work');
        showToast(isCrt ? 'CRT 스캔라인 모드가 켜졌습니다.' : 'CRT 모드가 꺼졌습니다.');
      }

      btn.onclick = toggleCrt;
    }

    // VS Code 스타일 라이브 스트림 하단 패널 리사이저 (드래그 조절 & 로컬 저장 & 더블 클릭 복원)
    function initPanelResizer() {
      const resizer = document.getElementById('panelResizer');
      const panel = document.getElementById('bottomPanel');
      if (!resizer || !panel) return;

      const DEFAULT_HEIGHT = 165;
      const MIN_HEIGHT = 80;
      const STORAGE_KEY = 'agent_office_panel_height';

      // 저장된 사용자 지정 패널 높이 복원
      const savedHeight = parseInt(localStorage.getItem(STORAGE_KEY), 10);
      if (!isNaN(savedHeight) && savedHeight >= MIN_HEIGHT && window.innerWidth >= 700) {
        panel.style.height = `${savedHeight}px`;
      }

      let isDragging = false;
      let startY = 0;
      let startHeight = DEFAULT_HEIGHT;

      function onPointerDown(e) {
        if (window.innerWidth < 700) return;
        isDragging = true;
        startY = e.clientY;
        startHeight = panel.offsetHeight;
        resizer.classList.add('is-resizing');
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerUp);
      }

      function onPointerMove(e) {
        if (!isDragging) return;
        const delta = startY - e.clientY;
        const maxHeight = Math.round(window.innerHeight * 0.72);
        const newHeight = Math.min(Math.max(startHeight + delta, MIN_HEIGHT), maxHeight);
        panel.style.height = `${newHeight}px`;
        localStorage.setItem(STORAGE_KEY, newHeight);

        if (typeof window.updateCanvasBufferSize === 'function') {
          window.updateCanvasBufferSize();
        }
      }

      function onPointerUp() {
        if (!isDragging) return;
        isDragging = false;
        resizer.classList.remove('is-resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);

        if (typeof window.updateCanvasBufferSize === 'function') {
          window.updateCanvasBufferSize();
        }
      }

      resizer.addEventListener('pointerdown', onPointerDown);

      // 더블 클릭 시 VS Code처럼 기본 크기(165px)로 즉시 복원
      resizer.addEventListener('dblclick', () => {
        panel.style.height = `${DEFAULT_HEIGHT}px`;
        localStorage.setItem(STORAGE_KEY, DEFAULT_HEIGHT);
        if (typeof window.updateCanvasBufferSize === 'function') {
          window.updateCanvasBufferSize();
        }
        if (Office.playSound) Office.playSound('ding');
        showToast('하단 패널 높이가 기본 크기(165px)로 초기화되었습니다.');
      });
    }

    initReportExport();
    initCrtMode();
    initPanelResizer();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        initSearchAndFilter();
        initReportExport();
        initCrtMode();
        initPanelResizer();
      });
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
    openRoomInspector,
    closeRoomInspector,
    appendLog,
    showToast,
    exportSessionMarkdownReport,
    updateTokenSparkline
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
  window.updateTokenSparkline = updateTokenSparkline;

})(window);
