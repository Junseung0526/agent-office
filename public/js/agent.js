/**
 * 에이전트 오피스 (Agent Office) - 에이전트 캐릭터 모듈 (public/js/agent.js)
 * PixelAgent 클래스, 상태 머신 및 오프스크린 스프라이트 Blitting
 */

(function(window) {
  'use strict';

  const Office = window.Office = window.Office || {};
  const {
    ROOM_DEFS,
    FLOOR_Y,
    SPRITE_FRAMES,
    PALETTE
  } = Office;

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
    // F. 캐릭터 클래스 (오프스크린 스프라이트 Blitting & 상태머신)
    // ----------------------------------------------------
    class PixelAgent {
      constructor(id, role, type = 'main', engine = 'antigravity') {
        this.id = id;
        this.role = role || '메인 에이전트';
        this.type = type; // 'main' | 'sub'
        this.engine = engine; // 'antigravity' | 'claude'

        this.x = ROOM_DEFS.meeting.targetX;
        this.y = FLOOR_Y;
        this.targetX = ROOM_DEFS.meeting.targetX;
        this.currentRoom = 'meeting';

        this.state = 'IDLE'; // IDLE, WALKING, WORKING, THINKING, PONDERING, ERROR, ASKING, REPORTING, LEAVING, GONE
        this.facing = 1; // 1: 우측, -1: 좌측
        this.speed = 1.6;

        this.animTimer = 0;
        this.memeTimer = Math.random() * 5;
        this.nextMemeInterval = 8 + Math.random() * 8; // 8~16초 후 혼자서 첫 밈 대사 발화
        this.lastEventTime = Date.now();
        this.speechBubbles = []; // 스택형 말풍선 목록 [{ id, type, text, createdAt, expiresAt, duration }]
        this.onArrivedAction = 'WORKING';
        this.onArrivedSpeech = null;

        // 퇴근 예약 타이머 참조
        this.leaveTimer = null;

        // 병렬 도구 추적 맵: toolKey -> { toolName, room, startTime }
        this.activeTools = new Map();
        this.lastToolActivityTime = Date.now();

        // ERROR 상태 자동 복구 타이머 추적
        this.errorStartTime = null;

        // 엘리베이터 문 애니메이션 상태
        this.elevatorDoorOpen = 0; // 0 ~ 1
      }

      // 하위 호환용 단일 speechBubble getter/setter
      get speechBubble() {
        return this.speechBubbles.length > 0 ? this.speechBubbles[this.speechBubbles.length - 1] : null;
      }
      set speechBubble(val) {
        if (!val) {
          this.speechBubbles = [];
        } else {
          this.speechBubbles = [val];
        }
      }

      setSpeech(type, text, durationMs = 4500) {
        if (!text) return;
        const now = Date.now();
        const last = this.speechBubbles[this.speechBubbles.length - 1];
        // 동일한 텍스트가 연속으로 들어오면 수명만 갱신
        if (last && last.text === text && last.type === type) {
          last.expiresAt = Math.max(last.expiresAt, now + durationMs);
          last.duration = durationMs;
          return;
        }

        this.speechBubbles.push({
          id: `${now}_${Math.random().toString(36).slice(2, 6)}`,
          type,
          text,
          createdAt: now,
          duration: durationMs,
          expiresAt: now + durationMs
        });

        // 위로 쌓이는 말풍선 스택은 최대 3개(화면 가림 방지 및 최적 가독성) 유지
        while (this.speechBubbles.length > 3) {
          this.speechBubbles.shift();
        }
      }

      sayRandomMeme() {
        if (this.state === 'GONE' || this.state === 'LEAVING') return;
        let meme;
        if (this.id === 'ops') {
          const opsMemes = [
            "🖥️ 서버 랙 온도 정상입니다 👍",
            "⚡ 백그라운드 프로세스 무중단 감시 중!",
            "🔥 병렬 연산 파이프라인 풀가동 완료",
            "🛡️ 메모리 누수 감지 시스템 올 그린 (Green)!",
            "📊 실시간 SSE 스트림 버퍼 안정적 동기화",
            "🚀 메인 에이전트님, 인프라는 제가 지킵니다!",
            "⚙️ 데몬 프로세스 상태 최적: 이상 무!"
          ];
          meme = Math.random() < 0.65
            ? opsMemes[Math.floor(Math.random() * opsMemes.length)]
            : AGENT_MEMES[Math.floor(Math.random() * AGENT_MEMES.length)];
        } else {
          meme = AGENT_MEMES[Math.floor(Math.random() * AGENT_MEMES.length)];
        }
        this.setSpeech('meme', meme, 4200);
        this.memeTimer = 0;
        this.nextMemeInterval = 9 + Math.random() * 9;
        if (Office.playSound) Office.playSound('think');
      }

      clearSpeech() {
        this.speechBubbles = [];
      }

      // 퇴근 타이머 취소 (보고 중 새 작업 수신 시 퇴근 방지)
      cancelLeaving() {
        if (this.leaveTimer) {
          clearTimeout(this.leaveTimer);
          this.leaveTimer = null;
        }
      }

      // GONE 상태에서 새 이벤트 수신 시 엘리베이터에서 출근 처리 (좌표 고착 방지)
      reviveIfGone(targetRoomId = 'meeting') {
        if (this.state === 'GONE' || this.state === 'LEAVING') {
          this.cancelLeaving();
          this.x = ROOM_DEFS.elevator.targetX;
          this.y = FLOOR_Y;
          this.state = 'IDLE';
          this.moveToRoom(targetRoomId, 'WORKING');
          this.setSpeech('report', '👋 출근했습니다!');
          return true;
        }
        return false;
      }

      moveToRoom(roomId, onArrivedAction = 'WORKING', onArrivedSpeech = null) {
        this.cancelLeaving();
        const room = ROOM_DEFS[roomId] || ROOM_DEFS.research;
        this.currentRoom = room.id;
        this.targetX = room.targetX;
        this.onArrivedAction = onArrivedAction;
        this.onArrivedSpeech = onArrivedSpeech;

        if (Math.abs(this.targetX - this.x) > 3) {
          this.state = 'WALKING';
          this.facing = this.targetX > this.x ? 1 : -1;
        } else {
          this.x = this.targetX;
          this.state = onArrivedAction;
          if (onArrivedSpeech) {
            this.setSpeech(onArrivedSpeech.type, onArrivedSpeech.text, onArrivedSpeech.duration);
          }
        }
      }

      update(dt) {
        this.animTimer += dt;
        const now = Date.now();

        // 수명이 만료된 말풍선 자동 정리 (스택 페이드아웃 완료 후 소멸)
        if (this.speechBubbles && this.speechBubbles.length > 0) {
          this.speechBubbles = this.speechBubbles.filter(b => now < b.expiresAt);
        }

        // 이동 로직
        if (this.state === 'WALKING' || this.state === 'LEAVING') {
          const dx = this.targetX - this.x;
          if (Math.abs(dx) > 1.5) {
            this.x += Math.sign(dx) * Math.min(Math.abs(dx), this.speed);
            if (Math.floor(this.animTimer * 12) % 4 === 0) playSound('step');
          } else {
            this.x = this.targetX;
            if (this.state === 'LEAVING') {
              this.state = 'GONE';
              playSound('ding');
              if (this.type === 'sub') {
                setTimeout(() => {
                  if (this.state === 'GONE') {
                    agentsMap.delete(this.id);
                  }
                }, 3000);
              }
            } else {
              this.state = this.onArrivedAction || 'WORKING';
              if (this.onArrivedSpeech) {
                this.setSpeech(this.onArrivedSpeech.type, this.onArrivedSpeech.text);
                this.onArrivedSpeech = null;
              }
            }
          }
        }

        // 작업 소리
        if (this.state === 'WORKING' && Math.random() < 0.03) {
          playSound('work');
        }

        // 3.5초 동안 새 이벤트 없이 생각 중이면 PONDERING (턱 괴기)
        if (this.state === 'THINKING' && (now - this.lastEventTime > 3500)) {
          this.state = 'PONDERING';
          if (!this.speechBubble && Math.random() < 0.35) {
            this.sayRandomMeme();
          }
        }

        // 장시간(20초 이상) 대기(IDLE) 시 회의실 화이트보드로 걸어가서 로드맵 점검 (회의실 자연스러운 활용)
        if (this.state === 'IDLE' && (now - this.lastEventTime > 20000)) {
          if (!this.lastIdleMeetingWalk || (now - this.lastIdleMeetingWalk > 35000)) {
            this.lastIdleMeetingWalk = now;
            if (this.currentRoom !== 'meeting' && Math.random() < 0.4) {
              this.moveToRoom('meeting', 'IDLE', {
                type: 'think',
                text: '📋 회의실 화이트보드 점검 중',
                duration: 4200
              });
            }
          }
        }

        // ----------------------------------------------------
        // 에이전트 자율 혼잣말 루프: 클릭하지 않아도 혼자서 8~16초마다 밈/직장인 넋두리 대사 발화
        // ----------------------------------------------------
        if (this.state !== 'GONE' && this.state !== 'LEAVING') {
          this.memeTimer = (this.memeTimer || 0) + dt;
          if (this.memeTimer >= (this.nextMemeInterval || 12)) {
            this.memeTimer = 0;
            this.nextMemeInterval = 9 + Math.random() * 9; // 다음 발화는 9 ~ 18초 뒤
            // 사용자 질문(ask)이나 에러(error)가 활성화되어 있지 않을 때만 넋두리/밈 발화
            const hasUrgentBubble = this.speechBubbles && this.speechBubbles.some(b => b.type === 'ask' || b.type === 'error');
            if (!hasUrgentBubble) {
              this.sayRandomMeme();
            }
          }
        }

        // ERROR 상태는 5초 후 IDLE로 자동 복귀
        if (this.state === 'ERROR' && this.errorStartTime && (now - this.errorStartTime > 5000)) {
          this.state = 'IDLE';
          this.errorStartTime = null;
          this.clearSpeech();
        }

        // 와치독: 도구 결과 없이 N분(기본 10분) 동안 조용하면 "응답 없음 💤" 표시
        const watchdogMinutes = Office.WATCHDOG_TIMEOUT_MINUTES || 10;
        const watchdogMs = watchdogMinutes * 60 * 1000;
        if (this.activeTools.size > 0 && (now - this.lastToolActivityTime > watchdogMs)) {
          if (!this.speechBubble || !this.speechBubble.text.includes('응답 없음 💤')) {
            this.setSpeech('think', '응답 없음 💤', 30000);
          }
        }
      }

      drawPixels(ctx) {
        if (this.state === 'GONE') return;

        let prefix = 'antigravity_';
        if (this.type === 'sub') {
          prefix = 'sub_';
        } else if (this.engine === 'claude') {
          prefix = 'claude_';
        }
        let frameKey = `${prefix}idle0`;

        if (this.state === 'WALKING' || this.state === 'LEAVING') {
          const step = Math.floor(this.animTimer * 8) % 4;
          frameKey = `${prefix}walk${step}`;
        } else if (this.state === 'PONDERING') {
          frameKey = `${prefix}ponder`;
        } else if (this.state === 'ERROR') {
          frameKey = `${prefix}sweat`;
        } else if (this.state === 'REPORTING') {
          frameKey = `${prefix}report`;
        } else if (this.state === 'THINKING' || this.state === 'IDLE' || this.state === 'WORKING') {
          const b = Math.floor(this.animTimer * 2) % 2;
          frameKey = `${prefix}idle${b}`;
        }

        const sprite = SPRITE_FRAMES[frameKey] || SPRITE_FRAMES[`${prefix}idle0`];

        ctx.save();
        const rx = Math.round(this.x);
        const ry = Math.round(this.y);

        // 1. 발밑 그림자 (타원형 픽셀)
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath();
        ctx.ellipse(rx, ry + 1, 8, 3, 0, 0, Math.PI * 2);
        ctx.fill();

        // 2. 캐릭터 스프라이트 블리팅 (좌우 반전)
        ctx.translate(rx, ry - 24);
        if (this.facing < 0) {
          ctx.scale(-1, 1);
          ctx.drawImage(sprite, -8, 0);
        } else {
          ctx.drawImage(sprite, -8, 0);
        }
        ctx.restore();
      }

      // 960x540 네이티브 해상도에서 칼같이 또렷한 한국어 텍스트 및 말풍선 스택 렌더링
      drawSharpUI(ctx) {
        if (this.state === 'GONE') return;

        const displayW = Office.canvasDisplayWidth || 960;
        const rx = Math.round(this.x * 2);
        const ry = Math.round(this.y * 2);

        // 1. 캐릭터 이름표 (520px 이상 화면에서만 렌더링하여 모바일 가독성 확보)
        if (displayW >= 520) {
          ctx.save();
          ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#0f172a'; // 외곽 그림자
          ctx.fillText(this.role, rx + 1, ry - 57);
          ctx.fillStyle = '#cbd5e1'; // 텍스트 본체
          ctx.fillText(this.role, rx, ry - 58);
          ctx.restore();
        }

        // 2. 고해상도 픽셀 말풍선 스택 렌더링 (아래에서 위로 쌓이며 차차 페이드아웃)
        if (this.speechBubbles && this.speechBubbles.length > 0) {
          this.drawStackedSpeechBubbles(ctx, rx, ry);
        }
      }

      drawStackedSpeechBubbles(ctx, rx, ry) {
        const bubbles = this.speechBubbles;
        if (!bubbles || bubbles.length === 0) return;

        const now = Date.now();
        const displayW = Office.canvasDisplayWidth || 960;
        const isMobile = displayW < 520;

        // 모바일 소형 화면에서는 폰트 가독성을 보장하기 위해 폰트와 높이를 살짝 확대
        const fontStr = isMobile
          ? 'bold 13.5px -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif'
          : 'bold 12.5px -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';
        const bh = isMobile ? 28 : 26;
        const gap = 5;
        const maxChars = isMobile ? 26 : 36;

        // 스택 렌더링: newest (index = bubbles.length - 1)가 최하단 (stackIdx = 0)
        // 이전 말풍선들은 위로 차례대로 쌓임 (stackIdx = 1, 2)
        const total = bubbles.length;
        for (let stackIdx = 0; stackIdx < total; stackIdx++) {
          const bubble = bubbles[total - 1 - stackIdx];
          if (!bubble) continue;

          // 수명 만료 페이드아웃 계산 (종료 700ms 전부터 부드럽게 감쇄)
          const remaining = bubble.expiresAt - now;
          if (remaining <= 0) continue;
          const fadeAlpha = remaining < 700 ? Math.max(0, remaining / 700) : 1.0;

          // 상위 스택일수록 은은한 투명도 적용 (최하단 최신 1.0 -> 0.85 -> 0.70)
          const stackBaseAlpha = stackIdx === 0 ? 1.0 : (stackIdx === 1 ? 0.85 : 0.70);
          const alpha = stackBaseAlpha * fadeAlpha;
          if (alpha <= 0.02) continue;

          // Y 위치 계산: 최하단은 캐릭터 머리 위(ry - 66), 상위 말풍선은 위로 누적
          const baseY = Math.max(20 + bh, (ry - 66) - stackIdx * (bh + gap));

          ctx.save();
          ctx.font = fontStr;

          let text = bubble.text || '';
          if (text.length > maxChars) {
            text = text.slice(0, maxChars - 2) + '...';
          }

          const metrics = ctx.measureText(text);
          const bw = Math.max(76, Math.min(340, Math.round(metrics.width + 20)));

          let bgHex = '#111827';
          let borderHex = '#4b5563';
          let textHex = '#f9fafb';

          if (bubble.type === 'think') {
            bgHex = '#2b1045'; borderHex = '#a855f7'; textHex = '#f3e8ff';
          } else if (bubble.type === 'ask') {
            bgHex = '#3d1603'; borderHex = '#f59e0b'; textHex = '#fef08a';
          } else if (bubble.type === 'error') {
            bgHex = '#3b0a0a'; borderHex = '#ef4444'; textHex = '#fecaca';
          } else if (bubble.type === 'report') {
            bgHex = '#053e2e'; borderHex = '#10b981'; textHex = '#d1fae5';
          } else if (bubble.type === 'meme') {
            bgHex = '#270e2d'; borderHex = '#ec4899'; textHex = '#fdf2f8';
          } else if (bubble.type === 'work') {
            bgHex = '#082e26'; borderHex = '#14b8a6'; textHex = '#ccfbf1';
          }

          let bx = rx;
          if (bubble.type === 'error' && stackIdx === 0) {
            bx += (Math.random() - 0.5) * 2;
          }

          const x = Math.max(10, Math.min(950 - bw, Math.round(bx - bw / 2)));
          const y = Math.round(baseY - bh);

          ctx.globalAlpha = alpha;

          // 그림자
          ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
          ctx.fillRect(x + 2, y + 2, bw, bh);

          // 말풍선 본체
          ctx.fillStyle = bgHex;
          ctx.fillRect(x, y, bw, bh);

          // 네온 테두리
          ctx.strokeStyle = borderHex;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x + 0.5, y + 0.5, bw - 1, bh - 1);

          // 말풍선 꼬리 (오직 최하단 최신 말풍선만 화자 머리를 향함)
          if (stackIdx === 0) {
            const tailX = Math.max(x + 10, Math.min(x + bw - 10, bx));
            ctx.fillStyle = bgHex;
            ctx.beginPath();
            ctx.moveTo(tailX - 4, y + bh - 0.5);
            ctx.lineTo(tailX, y + bh + 5);
            ctx.lineTo(tailX + 4, y + bh - 0.5);
            ctx.fill();

            ctx.strokeStyle = borderHex;
            ctx.beginPath();
            ctx.moveTo(tailX - 4, y + bh - 0.5);
            ctx.lineTo(tailX, y + bh + 5);
            ctx.lineTo(tailX + 4, y + bh - 0.5);
            ctx.stroke();
          }

          // 텍스트 출력
          ctx.fillStyle = textHex;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(text, x + bw / 2, y + bh / 2);

          ctx.restore();
        }
      }

      // 하위 호환용 단일 말풍선 렌더 함수 유지
      drawSharpSpeechBubble(ctx, bubble, bx, by) {
        if (!bubble) return;
        this.drawStackedSpeechBubbles(ctx, bx, by + 66);
      }
    }

  Office.PixelAgent = PixelAgent;
  window.PixelAgent = PixelAgent;

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
      const mainAg = new PixelAgent('main', mainRole, 'main', engine);
      map.set('main', mainAg);

      // 2. DevOps / 인프라 병렬 처리 에이전트 (서버실 백그라운드 프로세스 및 병렬 도구 전담)
      const opsAg = new PixelAgent('ops', 'DevOps 엔지니어', 'sub', engine);
      opsAg.x = ROOM_DEFS.server.targetX;
      opsAg.targetX = ROOM_DEFS.server.targetX;
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
