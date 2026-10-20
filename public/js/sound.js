/**
 * 에이전트 오피스 (Agent Office) - 사운드 모듈 (public/js/sound.js)
 * Web Audio API 기반 8-bit 레트로 사운드 신디사이저
 */

(function(window) {
  'use strict';

  const Office = window.Office = window.Office || {};

    // ----------------------------------------------------
    // D. 오디오 신디사이저 (Web Audio API)
    // ----------------------------------------------------
    let soundEnabled = true;
    let hasUserInteracted = false;
    try {
      soundEnabled = localStorage.getItem('agent_office_sound_enabled') !== 'false';
    } catch (e) {
      soundEnabled = true;
    }
    let audioCtx = null;

    function initAudio() {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
    }

    function playSound(type) {
      if (!soundEnabled || !hasUserInteracted) return;
      try {
        initAudio();
        if (audioCtx.state === 'suspended') return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        const now = audioCtx.currentTime;

        if (type === 'step') {
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(120, now);
          osc.frequency.exponentialRampToValueAtTime(30, now + 0.04);
          gain.gain.setValueAtTime(0.04, now);
          gain.gain.linearRampToValueAtTime(0.001, now + 0.04);
          osc.start(now); osc.stop(now + 0.04);
        } else if (type === 'work') {
          osc.type = 'square';
          osc.frequency.setValueAtTime(480 + Math.random() * 240, now);
          gain.gain.setValueAtTime(0.03, now);
          gain.gain.linearRampToValueAtTime(0.001, now + 0.05);
          osc.start(now); osc.stop(now + 0.05);
        } else if (type === 'think') {
          osc.type = 'sine';
          osc.frequency.setValueAtTime(440, now);
          osc.frequency.linearRampToValueAtTime(660, now + 0.12);
          gain.gain.setValueAtTime(0.05, now);
          gain.gain.linearRampToValueAtTime(0.001, now + 0.12);
          osc.start(now); osc.stop(now + 0.12);
        } else if (type === 'error') {
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(200, now);
          osc.frequency.setValueAtTime(140, now + 0.08);
          gain.gain.setValueAtTime(0.1, now);
          gain.gain.linearRampToValueAtTime(0.001, now + 0.2);
          osc.start(now); osc.stop(now + 0.2);
        } else if (type === 'ding') {
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(880, now);
          osc.frequency.setValueAtTime(1174, now + 0.15);
          gain.gain.setValueAtTime(0.12, now);
          gain.gain.linearRampToValueAtTime(0.001, now + 0.5);
          osc.start(now); osc.stop(now + 0.5);
        } else if (type === 'report') {
          osc.type = 'square';
          osc.frequency.setValueAtTime(523, now);
          osc.frequency.setValueAtTime(659, now + 0.08);
          osc.frequency.setValueAtTime(784, now + 0.16);
          osc.frequency.setValueAtTime(1046, now + 0.24);
          gain.gain.setValueAtTime(0.08, now);
          gain.gain.linearRampToValueAtTime(0.001, now + 0.4);
          osc.start(now); osc.stop(now + 0.4);
        }
      } catch (e) {}
    }

    function updateSoundButtonUI() {
      const btn = document.getElementById('btnToggleSound');
      if (!btn) return;
      const icon = document.getElementById('soundIcon');
      const text = btn.querySelector('.btn-sound-text');
      if (icon) icon.innerText = soundEnabled ? '🔊' : '🔇';
      if (text) text.innerText = soundEnabled ? '효과음 켜짐' : '효과음 꺼짐';
      btn.style.borderColor = soundEnabled ? '#38bdf8' : '#2d3b63';
      btn.setAttribute('aria-pressed', soundEnabled ? 'true' : 'false');
      btn.title = `8-bit 레트로 사운드 (${soundEnabled ? '켜짐' : '꺼짐'})`;
    }

    const btnSound = document.getElementById('btnToggleSound');
    if (btnSound) {
      btnSound.addEventListener('click', () => {
        hasUserInteracted = true;
        soundEnabled = !soundEnabled;
        try {
          localStorage.setItem('agent_office_sound_enabled', soundEnabled ? 'true' : 'false');
        } catch (e) {}
        updateSoundButtonUI();
        if (soundEnabled) playSound('ding');
      });
      updateSoundButtonUI();
    }

    function unlockAudioOnGesture() {
      hasUserInteracted = true;
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
    }
    window.addEventListener('click', unlockAudioOnGesture, { passive: true });
    window.addEventListener('keydown', unlockAudioOnGesture, { passive: true });
    window.addEventListener('touchstart', unlockAudioOnGesture, { passive: true });


  Object.defineProperty(Office, 'soundEnabled', {
    get() { return soundEnabled; },
    set(v) {
      soundEnabled = v;
      try { localStorage.setItem('agent_office_sound_enabled', soundEnabled ? 'true' : 'false'); } catch (e) {}
      updateSoundButtonUI();
    },
    configurable: true
  });
  if (!Object.prototype.hasOwnProperty.call(window, 'soundEnabled')) {
    Object.defineProperty(window, 'soundEnabled', {
      get() { return Office.soundEnabled; },
      set(v) { Office.soundEnabled = v; },
      configurable: true
    });
  }

  Office.initAudio = initAudio;
  Office.playSound = playSound;
  window.initAudio = initAudio;
  window.playSound = playSound;

})(window);
