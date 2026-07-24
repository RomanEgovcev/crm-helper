document.addEventListener('DOMContentLoaded', () => {
  const lineTimerEnabled = document.getElementById('lineTimerEnabled');
  const lineTimerThreshold = document.getElementById('lineTimerThreshold');
  const lineTimerValue = document.getElementById('lineTimerValue');
  const lineTimerBody = document.getElementById('lineTimerBody');
  const lineAction = document.getElementById('lineAction');

  const dialTimerEnabled = document.getElementById('dialTimerEnabled');
  const dialTimerThreshold = document.getElementById('dialTimerThreshold');
  const dialTimerValue = document.getElementById('dialTimerValue');
  const dialTimerBody = document.getElementById('dialTimerBody');

  const soundType = document.getElementById('soundType');
  const volume = document.getElementById('volume');
  const volumeValue = document.getElementById('volumeValue');
  const testSound = document.getElementById('testSound');

  const breakEnabled = document.getElementById('breakEnabled');
  const breakWorkMinutes = document.getElementById('breakWorkMinutes');
  const breakWorkValue = document.getElementById('breakWorkValue');
  const breakRestMinutes = document.getElementById('breakRestMinutes');
  const breakRestValue = document.getElementById('breakRestValue');
  const breakBody = document.getElementById('breakBody');

  const telegramBotToken = document.getElementById('telegramBotToken');
  const telegramChatId = document.getElementById('telegramChatId');

  const status = document.getElementById('status');

  function loadSettings() {
    chrome.storage.local.get(['settings'], (result) => {
      const s = result.settings || {};
      lineTimerEnabled.checked = s.lineTimerEnabled !== undefined ? s.lineTimerEnabled : true;
      lineTimerThreshold.value = s.lineTimerThreshold || 1;
      lineTimerValue.textContent = s.lineTimerThreshold || 1;
      lineAction.value = s.lineAction || 'rejoin';

      dialTimerEnabled.checked = s.dialTimerEnabled !== undefined ? s.dialTimerEnabled : true;
      dialTimerThreshold.value = s.dialTimerThreshold || 30;
      dialTimerValue.textContent = s.dialTimerThreshold || 30;

      soundType.value = s.soundType || 'alarm';
      volume.value = s.volume || 80;
      volumeValue.textContent = (s.volume || 80) + '%';

      breakEnabled.checked = s.breakEnabled !== undefined ? s.breakEnabled : true;
      breakWorkMinutes.value = s.breakWorkMinutes || 60;
      breakWorkValue.textContent = s.breakWorkMinutes || 60;
      breakRestMinutes.value = s.breakRestMinutes || 10;
      breakRestValue.textContent = s.breakRestMinutes || 10;

      telegramBotToken.value = s.telegramBotToken || '';
      telegramChatId.value = s.telegramChatId || '';

      updateBodyVisibility();
    });
  }

  function saveSettings() {
    const settings = {
      lineTimerEnabled: lineTimerEnabled.checked,
      lineTimerThreshold: parseInt(lineTimerThreshold.value),
      lineAction: lineAction.value,
      dialTimerEnabled: dialTimerEnabled.checked,
      dialTimerThreshold: parseInt(dialTimerThreshold.value),
      soundType: soundType.value,
      volume: parseInt(volume.value),
      breakEnabled: breakEnabled.checked,
      breakWorkMinutes: parseInt(breakWorkMinutes.value),
      breakRestMinutes: parseInt(breakRestMinutes.value),
      telegramBotToken: telegramBotToken.value,
      telegramChatId: telegramChatId.value
    };
    chrome.storage.local.set({ settings }, () => {
      status.textContent = 'Сохранено';
      status.classList.add('show');
      setTimeout(() => status.classList.remove('show'), 1500);
    });
  }

  function updateBodyVisibility() {
    lineTimerBody.style.opacity = lineTimerEnabled.checked ? '1' : '0.4';
    lineTimerBody.style.pointerEvents = lineTimerEnabled.checked ? 'auto' : 'none';
    dialTimerBody.style.opacity = dialTimerEnabled.checked ? '1' : '0.4';
    dialTimerBody.style.pointerEvents = dialTimerEnabled.checked ? 'auto' : 'none';
    breakBody.style.opacity = breakEnabled.checked ? '1' : '0.4';
    breakBody.style.pointerEvents = breakEnabled.checked ? 'auto' : 'none';
  }

  function playTestSound() {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const vol = parseInt(volume.value) / 100;
      const type = soundType.value;

      switch (type) {
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
      }
    } catch (e) {
      console.error('Ошибка воспроизведения звука:', e);
    }
  }

  lineTimerEnabled.addEventListener('change', () => { saveSettings(); updateBodyVisibility(); });
  lineTimerThreshold.addEventListener('input', () => { lineTimerValue.textContent = lineTimerThreshold.value; saveSettings(); });
  lineAction.addEventListener('change', saveSettings);
  dialTimerEnabled.addEventListener('change', () => { saveSettings(); updateBodyVisibility(); });
  dialTimerThreshold.addEventListener('input', () => { dialTimerValue.textContent = dialTimerThreshold.value; saveSettings(); });
  soundType.addEventListener('change', saveSettings);
  volume.addEventListener('input', () => { volumeValue.textContent = volume.value + '%'; saveSettings(); });
  testSound.addEventListener('click', playTestSound);
  breakEnabled.addEventListener('change', () => { saveSettings(); updateBodyVisibility(); });
  breakWorkMinutes.addEventListener('input', () => { breakWorkValue.textContent = breakWorkMinutes.value; saveSettings(); });
  breakRestMinutes.addEventListener('input', () => { breakRestValue.textContent = breakRestMinutes.value; saveSettings(); });
  telegramBotToken.addEventListener('input', saveSettings);
  telegramChatId.addEventListener('input', saveSettings);

  loadSettings();
});