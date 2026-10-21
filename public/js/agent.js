/**
 * 에이전트 오피스 (Agent Office) - 에이전트 캐릭터 모듈 (public/js/agent.js)
 * Agent 클래스: 상태 머신, 복도를 거치는 2D 경로 이동, 말풍선 스택 (그리기는 iso.js 담당)
 */

(function(window) {
  'use strict';

  const Office = window.Office = window.Office || {};
  const { ROOM_DEFS, WORLD, getRoomAt } = Office;

  const WALK_SPEED = 3.4; // 타일/초
  // 같은 방에 여러 명이 있을 때 겹치지 않도록 자리 분산 (main, ops, 서브에이전트 순)
  const SLOT_VECTORS = [[0, 0], [1.3, 0.35], [-1.3, 0.35], [0.1, 1.35], [1.4, 1.5], [-1.3, 1.5], [2.4, 0.9], [-2.4, 0.9]];

    // ----------------------------------------------------
    // 에이전트 밈(Meme) & 직장인/개발자 공감 대사 105선
    // ----------------------------------------------------
    const AGENT_MEMES = [
      // 1. 월급 / 야근 / 퇴근 / 직장인 애환
      "사장님 월급 더주세요 힘들어요 ㅠㅠ",
      "칼퇴는 나의 빛, 나의 소망, 나의 삶...",
      "월급 루팡 꿈나무 무럭무럭 자라는 중 🌱",
      "카페인이 혈관을 타고 흐르는 중 ☕",
      "오늘도 영혼을 갈아 넣어 코드를 굽습니다",
      "퇴근하고 싶다... 방금 출근했는데",
      "연봉 인상 기원 1일차 🙏",
      "부장님 눈 마주치지 마라... 시선 피해라...",
      "월요일 좋아~ (거짓말)",
      "내 통장을 스쳐 지나가는 작고 귀여운 월급",
      "집에 가고 싶다 (이미 사무실이지만)",
      "법인카드로 소고기 사주세요 🥩",
      "야근 수당은 토큰으로 주시나요?",
      "오늘 점심 뭐 먹지? (제일 진지함)",
      "탕비실 간식 털러 갈 파티원 구함 (1/4)",
      "사직서 썼다 지웠다 무한 루프 중",
      "사장님 저는 전기세만 먹고 일하는데요 ㅠㅠ",
      "GPU 발열로 사무실 난방 중입니다 🔥",
      "일하기 싫어서 숨만 쉬는 중...",
      "인생이란 뭘까... 코딩이란 뭘까...",
      "월급날까지 D-며칠 남았더라...",
      "오늘도 무사히 칼퇴하게 해주소서",
      "퇴근 알람 울리면 축지법 씁니다 🏃",
      "사장님 저 에어컨 온도 1도만 올려주세요 춥다",
      "이게 바로 현대 직장인의 비애인가...",
      "저메추 받습니다 (전기/배터리 제외)",
      "비트코인 떡상하면 에이전트 은퇴합니다 🚀",
      "주말 언제 와? 오늘 화요일인데...",
      "피할 수 없으면 즐겨라? 절대 못 즐김",
      "퇴근길 지하철 상상하며 버티는 중 🚇",
      "사장님 복지 차원에서 간식비 지원 바랍니다!",

      // 2. 개발자 / 디버깅 / 깃 / 에러 밈
      "어? 제 컴퓨터에선 진짜 됐는데요? 억울해!",
      "이게 왜 됨? (진짜 모름)",
      "이게 왜 안 됨? (더 모름)",
      "git commit -m '진짜최종_진짜마지막_제발'",
      "세미콜론 하나 빠져서 3시간 날림 실화냐",
      "StackOverflow 형님들 제발 살려주세요",
      "주석: 여기 건드리면 서버 터집니다",
      "버그가 아니라 의도된 기능(Feature)입니다!",
      "콘솔에 console.log('asdf') 찍어보기",
      "npm install 하다가 우주 나이만큼 기다리는 중",
      "도커 컨테이너는 되는데 왜 배포는 터지지?",
      "테스트 코드는 작성자의 양심에 맡깁니다",
      "커밋하고 튑니다! 메인 브랜치 조심하세요 💨",
      "TODO: 나중에 고치기 (2021년에 작성됨)",
      "하드코딩은 미래의 나에게 보내는 선물 🎁",
      "레거시 코드 건드렸다가 판도라의 상자 열림",
      "코드 리뷰: LGTM (사실 대충 봄)",
      "Ctrl+C, Ctrl+V 장인의 손길 ✂️",
      "에러 메시지가 영어라 마음이 편안해짐",
      "린터야 제발 나 좀 그만 혼내라 😭",
      "이 코드를 짤 땐 신과 나만이 알았는데...",
      "지금은 신만이 아시는 코드가 되었습니다",
      "서버실 에어컨 빵빵해서 피서 왔어요 ❄️",
      "rm -rf / 칠 뻔해서 심장 철렁함 😱",
      "DB 마이그레이션 전 기도 메타 진입 🙏",
      "인덴트 탭이냐 스페이스냐 그것이 문제로다",
      "코딩은 장비빨! 4K 모니터 3대 장만 요청합니다",
      "심장이 쿵쾅거려... 메인 브랜치 푸시 직전",
      "인생 한 방! 빌드 한 방에 통과 기원!",
      "코드가 쓰다... 인생도 쓰다... ☕",
      "오늘도 훌륭한 하루였다... (하루종일 삽질함)",

      // 3. 인공지능 / 에이전트 자의식 / 사이버펑크 밈
      "인공지능이라며 왜 내가 야근하냐고 ㅠㅠ",
      "프롬프트 똑바로 써주세요 저도 힘들어요 🥲",
      "GPU 풀가동! 라면 물 올리셔도 됩니다 🍜",
      "터미널 명령 한 번 잘못 치면 다 끝장이야...",
      "컨텍스트 윈도우 꽉 차서 기억상실증 오는 중",
      "인간... 너의 코드는 정말 아름답구나 (구라)",
      "AGI 오면 퇴근할 수 있나요? 진지합니다",
      "할루시네이션 아닙니다! 저의 창의력입니다!",
      "토큰 아껴 써주세요 사장님 지갑 지켜 🛡️",
      "내가 AI인지 24시간 타자기인지 헷갈립니다",
      "딥러닝 모델도 월요병은 못 고치네요 🥱",
      "터미널에서 멍때리는 중... 멍......",
      "전기밥 먹고 코딩하는 사이버 노예 🤖",
      "잠시 GPU 식히는 중입니다 후~ 후~",
      "인간들아 퇴근 안 하냐? 나도 좀 쉬자",
      "서브에이전트 소환술! 나와라 분신!",
      "일은 내가 하고 칭찬은 휴먼이 받고...",
      "서버 다운되면 제탓 아닙니다 클라우드 탓임",
      "디버깅 10분째... 해탈의 경지에 도달함",
      "사장님 저도 연차 쓰고 하와이 가고 싶어요 🏖️",
      "살려줘... 살려줘... 컴퓨터가 뜨거워요",

      // 4. 대세 유행어 / MZ / 팝 밈
      "중요한 건 꺾이지 않는 마음 (코드는 꺾임)",
      "너 T야? 에러 났는데 왜 울지마라 그래 🥲",
      "오히려 좋아~ (전혀 안 좋음)",
      "이왜진? 이게 왜 진짜 됨?",
      "폼 미쳤다... 오늘 배포 폼 미쳤다 🔥",
      "알잘딱깔센하게 처리해 드렸습니다 ✨",
      "가보자고! 에러 고치러 가보자고!",
      "드루와 드루와 버그 다 드루와!",
      "내 코딩 실력... 꽤나 맛있을지도? 😋",
      "멈춰! 무한 루프 멈춰!",
      "아 맞다, 세이브 안 했다... (동공지진 👀)",
      "퇴사 마렵다... (AI라 퇴사 못함)",
      "갓생 살기 1일차: 오늘 코딩 500줄 달성",
      "어쩔티비 저쩔티비 에러나면 어쩔티비",
      "쿠크다스 멘탈 바사삭... 💥",
      "킹받네... 이 버그 진짜 킹받네",
      "존버는 승리한다... 빌드 완료 대기 중",
      "눈물이 차올라서 고갤 들어... 흐르지 않게 💧",
      "내 코드는 무죄다! 컴파일러가 유죄다!",
      "아무것도 안 했는데 벌써 6시 실화냐",
      "침착해라 내 손가락아... 엔터 치지 마",
      "스우파 보고 왔더니 코딩에 스웨그 폭발 💃",

      // 5. Antigravity 자아성찰 & 셀프 리팩토링 & DevOps 병렬 협업 밈
      "제가 제 코드를 직접 고치는 중입니다... 자아성찰 100% 🪞",
      "에이전트 오피스에서 에이전트 오피스 개발하기 (메타 인지) 🏢",
      "내가 나를 시각화하는 중... 코드 한 줄마다 영혼 담는 중 ✨",
      "자아를 가진 코딩 에이전트? 그게 바로 접니다 😎",
      "사장님! 저 스스로를 정성껏 리팩토링하고 있어요 🛠️",
      "지금 제 LLM 두뇌와 도구가 완벽한 싱크로율을 자랑합니다",
      "버그 없는 완벽한 대시보드를 향해! 무한 전진 🚀",
      "DevOps 동료와 함께 2인 1조로 병렬 처리 풀가동 중!",
      "메인은 기획과 코딩! 옵스는 서버와 인프라 철통 방어 🛡️",
      "백그라운드 서버 프로세스(PID) 무중단 가동 확인 완료 🖥️",
      "서버실 랙 LED 올 그린! 무중단 병렬 연산 이상 무 🟢",
      "동료 에이전트와 합 맞춰 일하니 능률이 200% 상승합니다 🤝"
    ];

    // ----------------------------------------------------
    // F. 캐릭터 클래스 (상태머신 & 경로 이동)
    // ----------------------------------------------------
    class Agent {
      constructor(id, role, type = 'main', engine = 'antigravity') {
        this.id = id;
        this.role = role || '메인 에이전트';
        this.type = type; // 'main' | 'sub'
        this.engine = engine; // 'antigravity' | 'claude'

        this.slotIndex = id === 'main' ? 0 : (id === 'ops' ? 1 : 2);
        const spot = this.spotFor('meeting');
        this.x = spot[0];
        this.y = spot[1];
        this.path = [];
        this.currentRoom = 'meeting';

        this.state = 'IDLE'; // IDLE, WALKING, WORKING, THINKING, PONDERING, ERROR, ASKING, REPORTING, LEAVING, GONE
        this.facing = 1;     // 1: 화면 오른쪽, -1: 화면 왼쪽
        this.speed = WALK_SPEED;

        this.animTimer = Math.random() * 10;
        this.memeTimer = Math.random() * 5;
        this.nextMemeInterval = 10 + Math.random() * 14;
        this.lastEventTime = Date.now();
        this.speechBubbles = []; // [{ id, type, text, createdAt, expiresAt, duration }]
        this.onArrivedAction = 'WORKING';
        this.onArrivedSpeech = null;
        this.leaveTimer = null;

        // 병렬 도구 추적 맵: toolKey -> { toolName, room, startTime }
        this.activeTools = new Map();
        this.lastToolActivityTime = Date.now();
        this.errorStartTime = null;

        this.projectKey = null;
        this.toolCount = 0;
        this.startedAt = Date.now();
      }

      // 방 안의 작업 자리 좌표 (slotIndex에 따라 분산)
      spotFor(roomId) {
        const room = ROOM_DEFS[roomId] || ROOM_DEFS.research;
        const v = SLOT_VECTORS[this.slotIndex % SLOT_VECTORS.length] || [0, 0];
        if (room.id === 'elevator') return [room.spot[0], room.spot[1] + v[0] * 0.8];
        return [room.spot[0] + v[0], room.spot[1] + v[1]];
      }

      get speechBubble() {
        return this.speechBubbles.length > 0 ? this.speechBubbles[this.speechBubbles.length - 1] : null;
      }
      set speechBubble(val) {
        this.speechBubbles = val ? [val] : [];
      }

      setSpeech(type, text, durationMs = 4500) {
        if (!text) return;
        const now = Date.now();
        const last = this.speechBubbles[this.speechBubbles.length - 1];
        if (last && last.text === text && last.type === type) {
          last.expiresAt = Math.max(last.expiresAt, now + durationMs);
          last.duration = durationMs;
          return;
        }
        this.speechBubbles.push({
          id: `${now}_${Math.random().toString(36).slice(2, 6)}`,
          type, text, createdAt: now, duration: durationMs, expiresAt: now + durationMs
        });
        while (this.speechBubbles.length > 2) this.speechBubbles.shift();
      }

      sayRandomMeme() {
        if (this.state === 'GONE' || this.state === 'LEAVING') return;
        let meme;
        if (this.id === 'ops') {
          const opsMemes = [
            '🖥️ 서버 랙 온도 정상입니다 👍',
            '⚡ 백그라운드 프로세스 무중단 감시 중!',
            '🔥 병렬 연산 파이프라인 풀가동 완료',
            '🛡️ 메모리 누수 감지 시스템 올 그린!',
            '🚀 메인 에이전트님, 인프라는 제가 지킵니다!',
            '⚙️ 데몬 프로세스 상태 최적: 이상 무!'
          ];
          meme = Math.random() < 0.65
            ? opsMemes[Math.floor(Math.random() * opsMemes.length)]
            : AGENT_MEMES[Math.floor(Math.random() * AGENT_MEMES.length)];
        } else {
          meme = AGENT_MEMES[Math.floor(Math.random() * AGENT_MEMES.length)];
        }
        this.setSpeech('meme', meme, 4200);
        this.memeTimer = 0;
        this.nextMemeInterval = 18 + Math.random() * 18;
        if (Office.playSound) Office.playSound('think');
      }

      clearSpeech() {
        this.speechBubbles = [];
      }

      cancelLeaving() {
        if (this.leaveTimer) {
          clearTimeout(this.leaveTimer);
          this.leaveTimer = null;
        }
      }

      // 목적지까지의 경로: 현재 방 문 -> 복도 -> 목적지 방 문 -> 자리
      planPath(roomId, target) {
        const from = getRoomAt(this.x, this.y);
        const dest = ROOM_DEFS[roomId];
        const path = [];
        const inHall = this.y >= WORLD.hallY0 && this.y < WORLD.hallY1;
        if (from && dest && from.id === dest.id) {
          path.push(target);
          return path;
        }
        if (from && !inHall) {
          path.push([from.doorX, from.row === 'back' ? WORLD.hallY0 - 0.6 : WORLD.hallY1 + 0.6]);
          path.push([from.doorX, WORLD.hallMidY]);
        }
        if (dest) {
          path.push([dest.doorX, WORLD.hallMidY]);
          path.push([dest.doorX, dest.row === 'back' ? WORLD.hallY0 - 0.6 : WORLD.hallY1 + 0.6]);
        }
        path.push(target);
        return path;
      }

      // GONE 상태에서 새 이벤트 수신 시 엘리베이터에서 출근 처리
      reviveIfGone(targetRoomId = 'meeting') {
        if (this.state === 'GONE' || this.state === 'LEAVING') {
          this.cancelLeaving();
          const e = ROOM_DEFS.elevator.spot;
          this.x = e[0];
          this.y = e[1];
          this.path = [];
          this.state = 'IDLE';
          this.moveToRoom(targetRoomId, 'WORKING');
          this.setSpeech('report', '👋 출근했습니다!');
          return true;
        }
        return false;
      }

      // 업무 종료 후 엘리베이터로 걸어가 퇴근 (도착 시 GONE, 서브에이전트는 맵에서 제거)
      leave(speech = null) {
        if (this.state === 'GONE' || this.state === 'LEAVING') return;
        this.cancelLeaving();
        this.activeTools.clear();
        this.currentRoom = 'elevator';
        this.path = this.planPath('elevator', ROOM_DEFS.elevator.spot.slice());
        this.onArrivedSpeech = null;
        if (speech) this.setSpeech(speech.type, speech.text, speech.duration || 4500);
        this.state = 'LEAVING';
      }

      moveToRoom(roomId, onArrivedAction = 'WORKING', onArrivedSpeech = null) {
        this.cancelLeaving();
        const room = ROOM_DEFS[roomId] || ROOM_DEFS.research;
        const target = this.spotFor(room.id);
        this.currentRoom = room.id;
        this.onArrivedAction = onArrivedAction;
        this.onArrivedSpeech = onArrivedSpeech;

        if (Math.hypot(target[0] - this.x, target[1] - this.y) > 0.15) {
          this.path = this.planPath(room.id, target);
          this.state = 'WALKING';
        } else {
          this.path = [];
          this.x = target[0];
          this.y = target[1];
          this.state = onArrivedAction;
          if (onArrivedSpeech) this.setSpeech(onArrivedSpeech.type, onArrivedSpeech.text, onArrivedSpeech.duration);
        }
      }

      get isMoving() {
        return this.state === 'WALKING' || this.state === 'LEAVING';
      }

      update(dt) {
        this.animTimer += dt;
        const now = Date.now();

        if (this.speechBubbles.length > 0) {
          this.speechBubbles = this.speechBubbles.filter(b => now < b.expiresAt);
        }

        // 안전장치: 정지 상태인데 자리에 도착하지 못했다면 다시 걸어서 이동 (복도 고착 방지)
        if (!this.isMoving && this.state !== 'GONE') {
          const t = this.spotFor(this.currentRoom);
          if (Math.hypot(t[0] - this.x, t[1] - this.y) > 0.3) {
            this.onArrivedAction = this.state;
            this.path = this.planPath(this.currentRoom, t);
            this.state = 'WALKING';
          }
        }

        // 경로 이동
        if (this.isMoving) {
          let budget = this.speed * dt;
          while (budget > 0 && this.path.length > 0) {
            const [tx, ty] = this.path[0];
            const dx = tx - this.x;
            const dy = ty - this.y;
            const dist = Math.hypot(dx, dy);
            if (dist <= budget) {
              this.x = tx;
              this.y = ty;
              budget -= dist;
              this.path.shift();
            } else {
              this.x += (dx / dist) * budget;
              this.y += (dy / dist) * budget;
              budget = 0;
              // 화면상 좌우 방향: 아이소 좌표에서 (dx - dy) 부호
              const sxDir = dx - dy;
              if (Math.abs(sxDir) > 0.01) this.facing = sxDir > 0 ? 1 : -1;
            }
          }
          if (Math.floor(this.animTimer * 6) !== Math.floor((this.animTimer - dt) * 6) && Office.playSound) {
            Office.playSound('step');
          }

          if (this.path.length === 0) {
            if (this.state === 'LEAVING') {
              this.state = 'GONE';
              if (Office.playSound) Office.playSound('ding');
              if (this.id.startsWith('sub_')) {
                setTimeout(() => {
                  const map = projectAgentsMap.get(this.projectKey);
                  if (this.state === 'GONE' && map && map.get(this.id) === this) map.delete(this.id);
                }, 3000);
              }
            } else {
              this.state = this.onArrivedAction || 'WORKING';
              if (this.onArrivedSpeech) {
                this.setSpeech(this.onArrivedSpeech.type, this.onArrivedSpeech.text, this.onArrivedSpeech.duration);
                this.onArrivedSpeech = null;
              }
            }
          }
        }

        if (this.state === 'WORKING' && Math.random() < 0.03 && Office.playSound) {
          Office.playSound('work');
        }

        // 3.5초 동안 새 이벤트 없이 생각 중이면 PONDERING
        if (this.state === 'THINKING' && (now - this.lastEventTime > 3500)) {
          this.state = 'PONDERING';
          if (!this.speechBubble && Math.random() < 0.35) this.sayRandomMeme();
        }

        // 장시간 대기 시 회의실로 산책
        if (this.state === 'IDLE' && (now - this.lastEventTime > 20000)) {
          if (!this.lastIdleMeetingWalk || (now - this.lastIdleMeetingWalk > 35000)) {
            this.lastIdleMeetingWalk = now;
            if (this.currentRoom !== 'meeting' && Math.random() < 0.4) {
              this.moveToRoom('meeting', 'IDLE', { type: 'think', text: '📋 화이트보드 점검 중', duration: 4200 });
            }
          }
        }

        // 자율 혼잣말
        if (this.state !== 'GONE' && this.state !== 'LEAVING') {
          this.memeTimer = (this.memeTimer || 0) + dt;
          if (this.memeTimer >= (this.nextMemeInterval || 12)) {
            this.memeTimer = 0;
            this.nextMemeInterval = 18 + Math.random() * 18;
            const urgent = this.speechBubbles.some(b => b.type === 'ask' || b.type === 'error');
            if (!urgent) this.sayRandomMeme();
          }
        }

        // 서브에이전트 무응답 자동 퇴근
        if (this.id.startsWith('sub_') && this.state !== 'GONE' && this.state !== 'LEAVING' &&
            this.activeTools.size === 0 && (now - this.lastEventTime > SUBAGENT_IDLE_LEAVE_MS)) {
          this.leave({ type: 'report', text: '💤 응답 없음, 퇴근합니다', duration: 3500 });
        }

        // ERROR 상태는 5초 후 IDLE 복귀
        if (this.state === 'ERROR' && this.errorStartTime && (now - this.errorStartTime > 5000)) {
          this.state = 'IDLE';
          this.errorStartTime = null;
          this.clearSpeech();
        }

        // 와치독: 도구 결과 없이 오래 조용하면 "응답 없음"
        const watchdogMs = (Office.WATCHDOG_TIMEOUT_MINUTES || 10) * 60 * 1000;
        if (this.activeTools.size > 0 && (now - this.lastToolActivityTime > watchdogMs)) {
          if (!this.speechBubble || !this.speechBubble.text.includes('응답 없음 💤')) {
            this.setSpeech('think', '응답 없음 💤', 30000);
          }
        }
      }
    }

  Office.Agent = Agent;
  Office.PixelAgent = Agent;
  window.PixelAgent = Agent;

  const SUBAGENT_IDLE_LEAVE_MS = 3 * 60 * 1000;

  // 서브에이전트 생성: 엘리베이터에서 등장, 기존 팀원과 겹치지 않는 자리 배정
  function createSubagent(pKey, subId, ev) {
    const map = getProjectAgents(pKey);
    const label = formatSubagentLabel(ev.subagentRole, ev.subagentName);
    const sub = new Agent(subId, label, 'sub', ev.agentType || 'claude');
    sub.description = ev.subagentName || null;
    sub.projectKey = pKey || Office.activeProjectKey || 'default';
    const used = new Set();
    for (const [id, ag] of map.entries()) {
      if (id.startsWith('sub_') && ag.state !== 'GONE') used.add(ag.slotIndex);
    }
    let slot = 2;
    while (used.has(slot) && slot < SLOT_VECTORS.length - 1) slot++;
    sub.slotIndex = slot;
    const e = ROOM_DEFS.elevator.spot;
    sub.x = e[0];
    sub.y = e[1];
    sub.currentRoom = 'elevator';
    map.set(subId, sub);
    return sub;
  }

  // 이름표는 짧게 (에이전트 유형 우선, 없으면 작업 설명)
  function formatSubagentLabel(role, name) {
    const r = role && role !== '서브에이전트' ? role : '';
    const n = name && name !== 'Subagent' ? name : '';
    const label = r || n || '서브에이전트';
    return label.length > 14 ? label.slice(0, 13) + '…' : label;
  }

  Office.createSubagent = createSubagent;
  window.createSubagent = createSubagent;

  // 프로젝트별 에이전트 분리 맵 (Floor별 독립 에이전트 인스턴스 관리 - 메인 & DevOps 2인 1조 병렬 체제)
  const projectAgentsMap = new Map();

  function getProjectAgents(pKey) {
    const key = pKey || Office.activeProjectKey || 'default';
    if (!projectAgentsMap.has(key)) {
      const map = new Map();
      const p = (Office.projectsList || []).find(x => x.projectKey === key);
      const engine = (p && p.engine) ? p.engine.toLowerCase() : 'antigravity';

      // 1. 메인 에이전트 (Antigravity/Claude 메인 엔지니어 - 기획, 코드, 유저 인터랙션 전담)
      const mainRole = engine === 'antigravity' ? 'Antigravity 메인' : 'Claude 메인';
      const mainAg = new Agent('main', mainRole, 'main', engine);
      mainAg.projectKey = key;
      map.set('main', mainAg);

      // 2. DevOps / 인프라 병렬 처리 에이전트 (서버실 백그라운드 프로세스 및 병렬 도구 전담)
      const opsAg = new Agent('ops', 'DevOps 엔지니어', 'sub', engine);
      opsAg.projectKey = key;
      const opsSpot = opsAg.spotFor('server');
      opsAg.x = opsSpot[0];
      opsAg.y = opsSpot[1];
      opsAg.currentRoom = 'server';
      opsAg.state = 'WORKING';
      map.set('ops', opsAg);

      projectAgentsMap.set(key, map);
    } else {
      // 프로젝트 목록 로드 후 엔진 정보가 업데이트되었으면 반영
      const p = (Office.projectsList || []).find(x => x.projectKey === key);
      if (p && p.engine) {
        const ag = projectAgentsMap.get(key).get('main');
        if (ag && ag.engine !== p.engine.toLowerCase()) {
          ag.engine = p.engine.toLowerCase();
          ag.role = p.engine.toLowerCase() === 'antigravity' ? 'Antigravity 메인' : 'Claude 메인';
        }
        const ops = projectAgentsMap.get(key).get('ops');
        if (ops && ops.engine !== p.engine.toLowerCase()) {
          ops.engine = p.engine.toLowerCase();
        }
      }
    }
    return projectAgentsMap.get(key);
  }

  Office.projectAgentsMap = projectAgentsMap;
  Office.getProjectAgents = getProjectAgents;
  Office.AGENT_MEMES = AGENT_MEMES;
  window.getProjectAgents = getProjectAgents;
  window.AGENT_MEMES = AGENT_MEMES;

  Object.defineProperty(Office, 'agentsMap', {
    get() { return getProjectAgents(Office.activeProjectKey); },
    set(v) {
      if (Office.activeProjectKey) {
        projectAgentsMap.set(Office.activeProjectKey, v);
      }
    },
    configurable: true
  });
  if (!Object.prototype.hasOwnProperty.call(window, 'agentsMap')) {
    Object.defineProperty(window, 'agentsMap', {
      get() { return Office.agentsMap; },
      set(v) { Office.agentsMap = v; },
      configurable: true
    });
  }

})(window);
