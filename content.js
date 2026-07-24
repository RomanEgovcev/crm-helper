(() => {
  const DEFAULT_SETTINGS = {
    lineTimerEnabled: true,
    lineTimerThreshold: 90,
    dialTimerEnabled: true,
    dialTimerThreshold: 30,
    soundType: 'alarm',
    volume: 80
  };

  let settings = { ...DEFAULT_SETTINGS };
  let lastLineAction = 0;
  let lastDialAction = 0;
  let lineCooldown = 10000;
  let dialCooldown = 10000;

  chrome.storage.local.get(['settings'], (result) => {
    if (result.settings) {
      settings = { ...DEFAULT_SETTINGS, ...result.settings };
    }
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings) {
      settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
    }
  });

  function findButtonByText(text) {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.textContent.trim().includes(text)) return btn;
    }
    return null;
  }

  function parseTimer(text) {
    const match = text.match(/(\d+):(\d{2})/);
    if (!match) return -1;
    return parseInt(match[1]) * 60 + parseInt(match[2]);
  }

  function findLineTimer() {
    const pElements = document.querySelectorAll('p');
    for (const p of pElements) {
      const text = p.textContent.trim();
      if (/^\d{1,2}:\d{2}$/.test(text)) {
        return p;
      }
    }
    return null;
  }

  function findDialTimer() {
    const fixedDivs = document.querySelectorAll('div[style*="position: fixed"]');
    for (const div of fixedDivs) {
      if (div.style.zIndex === '9999' || div.innerHTML.includes('Набор номера')) {
        const pElements = div.querySelectorAll('p');
        for (const p of pElements) {
          const text = p.textContent.trim();
          if (text.includes('Набор номера')) return p;
        }
      }
    }
    return null;
  }

  function playSound() {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const vol = settings.volume / 100;

      switch (settings.soundType) {
        case 'beep': {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.frequency.value = 880;
          osc.type = 'sine';
          gain.gain.setValueAtTime(vol, audioCtx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
          osc.start(audioCtx.currentTime);
          osc.stop(audioCtx.currentTime + 0.5);
          break;
        }
        case 'double_beep': {
          [0, 0.2].forEach((delay) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.frequency.value = 880;
            osc.type = 'sine';
            gain.gain.setValueAtTime(vol, audioCtx.currentTime + delay);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + delay + 0.15);
            osc.start(audioCtx.currentTime + delay);
            osc.stop(audioCtx.currentTime + delay + 0.15);
          });
          break;
        }
        case 'alarm': {
          [0, 0.15, 0.3, 0.45, 0.6].forEach((delay) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.frequency.value = 1000;
            osc.type = 'square';
            gain.gain.setValueAtTime(vol * 0.6, audioCtx.currentTime + delay);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + delay + 0.1);
            osc.start(audioCtx.currentTime + delay);
            osc.stop(audioCtx.currentTime + delay + 0.1);
          });
          break;
        }
        case 'siren': {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.type = 'sine';
          gain.gain.setValueAtTime(vol * 0.7, audioCtx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.5);
          osc.frequency.setValueAtTime(600, audioCtx.currentTime);
          osc.frequency.linearRampToValueAtTime(1200, audioCtx.currentTime + 0.5);
          osc.frequency.linearRampToValueAtTime(600, audioCtx.currentTime + 1.0);
          osc.frequency.linearRampToValueAtTime(1200, audioCtx.currentTime + 1.5);
          osc.start(audioCtx.currentTime);
          osc.stop(audioCtx.currentTime + 1.5);
          break;
        }
        default: {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.frequency.value = 880;
          osc.type = 'sine';
          gain.gain.setValueAtTime(vol, audioCtx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
          osc.start(audioCtx.currentTime);
          osc.stop(audioCtx.currentTime + 0.5);
        }
      }
    } catch (e) {
      console.error('[CRM Helper] Ошибка воспроизведения звука:', e);
    }
  }

  function monitor() {
    const now = Date.now();

    if (settings.lineTimerEnabled && now - lastLineAction > lineCooldown) {
      const exitBtn = findButtonByText('Выйти из очереди');
      if (exitBtn && exitBtn.offsetParent !== null) {
        const timer = findLineTimer();
        if (timer) {
          const seconds = parseTimer(timer.textContent);
          console.log(`[CRM Helper] Таймер линии: ${timer.textContent.trim()} = ${seconds}с, порог: ${settings.lineTimerThreshold}с`);
          if (seconds >= settings.lineTimerThreshold) {
            lastLineAction = now;
            console.log(`[CRM Helper] Линия: ${seconds}с >= ${settings.lineTimerThreshold}с. Выхожу и захожу обратно.`);
            exitBtn.click();
            setTimeout(() => {
              const enterBtn = findButtonByText('Встать в очередь');
              if (enterBtn) {
                enterBtn.click();
                console.log('[CRM Helper] Зашёл обратно в очередь.');
              }
            }, 800);
          }
        } else {
          console.log('[CRM Helper] Таймер линии не найден');
        }
      }
    }

    if (settings.dialTimerEnabled && now - lastDialAction > dialCooldown) {
      const dialTimer = findDialTimer();
      if (dialTimer) {
        const text = dialTimer.textContent;
        const match = text.match(/\((\d+):(\d{2})\)/);
        if (match) {
          const seconds = parseInt(match[1]) * 60 + parseInt(match[2]);
          console.log(`[CRM Helper] Таймер дозвона: ${text.trim()} = ${seconds}с, порог: ${settings.dialTimerThreshold}с`);
          if (seconds >= settings.dialTimerThreshold) {
            lastDialAction = now;
            console.log(`[CRM Helper] Дозвон: ${seconds}с >= ${settings.dialTimerThreshold}с. Сбрасываю и играю звук.`);
            const resetBtn = document.querySelector('button[aria-label="Сбросить"]');
            if (resetBtn) resetBtn.click();
            playSound();
          }
        }
      }
    }
  }

  setInterval(monitor, 1000);
  console.log('[CRM Helper] Расширение запущено.');
})();
