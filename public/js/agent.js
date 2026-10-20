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
    // F. 캐릭터 클래스 (오프스크린 스프라이트 Blitting)
    // ----------------------------------------------------
    class PixelAgent {
      constructor(id, role, type = 'main') {
        this.id = id;
        this.role = role || '메인 에이전트';
        this.type = type; // 'main' | 'sub'

        this.x = ROOM_DEFS.meeting.targetX;
        this.y = FLOOR_Y;
        this.targetX = ROOM_DEFS.meeting.targetX;
        this.currentRoom = 'meeting';

        this.state = 'IDLE'; // IDLE, WALKING, WORKING, THINKING, PONDERING, ERROR, ASKING, REPORTING, LEAVING, GONE
        this.facing = 1; // 1: 우측, -1: 좌측
        this.speed = 1.6;

        this.animTimer = 0;
        this.lastEventTime = Date.now();
        this.speechBubble = null; // { type, text, expiresAt }

        // 엘리베이터 문 애니메이션 상태
        this.elevatorDoorOpen = 0; // 0 ~ 1
      }

      setSpeech(type, text, durationMs = 4500) {
        this.speechBubble = { type, text, expiresAt: Date.now() + durationMs };
      }

      clearSpeech() {
        this.speechBubble = null;
      }

      moveToRoom(roomId, onArrivedAction = 'WORKING') {
        const room = ROOM_DEFS[roomId] || ROOM_DEFS.research;
        this.currentRoom = room.id;
        this.targetX = room.targetX;
        this.onArrivedAction = onArrivedAction;
        if (Math.abs(this.targetX - this.x) > 3) {
          this.state = 'WALKING';
          this.facing = this.targetX > this.x ? 1 : -1;
        } else {
          this.state = onArrivedAction;
        }
      }

      update(dt) {
        this.animTimer += dt;
        const now = Date.now();

        if (this.speechBubble && now > this.speechBubble.expiresAt) {
          this.speechBubble = null;
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
        }
      }

      drawPixels(ctx) {
        if (this.state === 'GONE') return;

        const prefix = this.type === 'sub' ? 'sub_' : 'main_';
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

      // 960x540 네이티브 해상도에서 칼같이 또렷한 한국어 텍스트 및 말풍선 렌더링
      drawSharpUI(ctx) {
        if (this.state === 'GONE') return;

        const rx = Math.round(this.x * 2);
        const ry = Math.round(this.y * 2);

        // 1. 캐릭터 이름표 (선명한 고해상도 텍스트)
        ctx.save();
        ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#0f172a'; // 외곽 그림자
        ctx.fillText(this.role, rx + 1, ry - 57);
        ctx.fillStyle = '#cbd5e1'; // 텍스트 본체
        ctx.fillText(this.role, rx, ry - 58);
        ctx.restore();

        // 2. 고해상도 픽셀 말풍선 렌더링
        if (this.speechBubble) {
          this.drawSharpSpeechBubble(ctx, this.speechBubble, rx, ry - 66);
        }
      }

      drawSharpSpeechBubble(ctx, bubble, bx, by) {
        ctx.save();
        ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';
        let text = bubble.text || '';
        if (text.length > 38) text = text.slice(0, 36) + '...';

        const metrics = ctx.measureText(text);
        const padding = 10;
        const bw = Math.max(80, Math.min(320, Math.round(metrics.width + padding * 2)));
        const bh = 28;

        let bgHex = '#111827';
        let borderHex = '#4b5563';
        let textHex = '#f9fafb';

        if (bubble.type === 'think') {
          bgHex = '#31104b'; borderHex = '#a855f7'; textHex = '#f3e8ff';
        } else if (bubble.type === 'ask') {
          bgHex = '#451a03'; borderHex = '#f59e0b'; textHex = '#fef08a';
        } else if (bubble.type === 'error') {
          bgHex = '#450a0a'; borderHex = '#ef4444'; textHex = '#fecaca';
          // 에러 지터 효과
          bx += (Math.random() - 0.5) * 3;
          by += (Math.random() - 0.5) * 3;
        } else if (bubble.type === 'report') {
          bgHex = '#064e3b'; borderHex = '#10b981'; textHex = '#d1fae5';
        }

        const x = Math.round(bx - bw / 2);
        const y = Math.round(by - bh);

        // 픽셀 테두리 상자
        ctx.fillStyle = bgHex;
        ctx.fillRect(x, y, bw, bh);
        ctx.strokeStyle = borderHex;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, bw, bh);

        // 말풍선 꼬리
        ctx.fillStyle = bgHex;
        ctx.beginPath();
        ctx.moveTo(bx - 4, y + bh);
        ctx.lineTo(bx, y + bh + 5);
        ctx.lineTo(bx + 4, y + bh);
        ctx.fill();

        ctx.strokeStyle = borderHex;
        ctx.beginPath();
        ctx.moveTo(bx - 4, y + bh);
        ctx.lineTo(bx, y + bh + 5);
        ctx.lineTo(bx + 4, y + bh);
        ctx.stroke();

        // 한글 텍스트 (초고화질 선명 렌더링)
        ctx.fillStyle = textHex;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, bx, y + Math.round(bh / 2));

        ctx.restore();
      }
    }


  Office.PixelAgent = PixelAgent;
  window.PixelAgent = PixelAgent;

})(window);
