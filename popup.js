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
  const musicWidgetEnabled = document.getElementById('musicWidgetEnabled');
  const notepadEnabled = document.getElementById('notepadEnabled');

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
      musicWidgetEnabled.checked = s.musicWidgetEnabled !== undefined ? s.musicWidgetEnabled : true;
      notepadEnabled.checked = s.notepadEnabled !== undefined ? s.notepadEnabled : true;

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
      telegramChatId: telegramChatId.value,
      musicWidgetEnabled: musicWidgetEnabled.checked,
      notepadEnabled: notepadEnabled.checked
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
  musicWidgetEnabled.addEventListener('change', saveSettings);
  notepadEnabled.addEventListener('change', saveSettings);

  const claimNumber = document.getElementById('claimNumber');
  const lookupClaim = document.getElementById('lookupClaim');
  const claimResult = document.getElementById('claimResult');

  async function pollStorage(key, timeoutMs) {
    for (let i = 0; i < Math.ceil(timeoutMs / 500); i++) {
      await new Promise(r => setTimeout(r, 500));
      const obj = await chrome.storage.local.get(key);
      if (obj[key]) { chrome.storage.local.remove(key); return obj[key]; }
    }
    return null;
  }

  lookupClaim.addEventListener('click', async () => {
    const num = claimNumber.value.trim();
    if (!num) { claimResult.style.display = 'block'; claimResult.textContent = 'Введите номер заявки'; return; }
    claimResult.style.display = 'block'; claimResult.textContent = 'Поиск...';
    let s = {};
    try { s = (await chrome.storage.local.get('settings')).settings || {}; } catch (e) {}
    if (!s.telegramBotToken || !s.telegramChatId) { claimResult.textContent = 'Настройте Telegram в настройках'; return; }
    try {
      const tabs = await chrome.tabs.query({ url: ['*://victory-crm.ru/*', '*://ect-russia.ru/*'] });
      if (!tabs.length) { claimResult.textContent = 'Откройте CRM в браузере'; return; }
      chrome.tabs.sendMessage(tabs[0].id, { type: 'lookupClaim', claimId: num });
      const resp = await pollStorage('_lookupResult', 15000);
      if (!resp) { claimResult.textContent = 'Ошибка: Таймаут'; return; }
      if (resp.error) { claimResult.textContent = 'Ошибка: ' + resp.error; return; }
      const d = resp.data;
      const rawPhone = d.mobile_tel || d.phone || d.phone_number || d.client_phone || d.number || '';
      const name = d.name || d.name_project || d.client_name || d.answer_name || '';
      const claim = d.id || d.answer_id || num;

      const digits = rawPhone.replace(/\D/g, '');
      let formattedPhone = rawPhone;
      if (digits.length >= 10) {
        const last10 = digits.slice(-10);
        formattedPhone = `+7 (${last10.slice(0,3)}) ${last10.slice(3,6)}-${last10.slice(6,8)}-${last10.slice(8)}`;
      }

      let lines = [`📞 ${formattedPhone || 'нет телефона'}`];
      lines.push(`📋 Заявка: №${claim}`);
      if (name) lines.push(`ℹ️ ${name}`);

      try {
        const lookup = await fetch(`https://num.voxlink.ru/get/?num=${digits}`).then(r => r.json()).catch(() => null);
        if (lookup && !lookup.error) {
          if (lookup.operator) lines.push(`🏢 Оператор: ${lookup.operator}`);
          if (lookup.region) lines.push(`📍 Регион: ${lookup.region}`);
        }
      } catch (e) {}

      const keyboard = { inline_keyboard: [[{ text: '\ud83d\udfac Telegram', url: `https://t.me/${digits}` }, { text: '\ud83d\udcf1 Max', url: `https://max.ru/${digits}` }]] };
      try {
        await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({ type: 'sendTelegram', text: lines.join('\n'), replyMarkup: keyboard }, (ok) => {
            if (ok) resolve(); else reject(new Error('BG send failed'));
          });
        });
        claimResult.textContent = 'Отправлено в Telegram';
        claimResult.style.color = '#4caf50';
      } catch (e) {
        claimResult.textContent = 'Ошибка Telegram: ' + e.message;
        claimResult.style.color = '#f44336';
      }
      setTimeout(() => { claimResult.style.color = '#aaa'; }, 3000);
    } catch (e) { claimResult.textContent = 'Ошибка: ' + e.message; }
  });

  const updateClaimBtn = document.getElementById('updateClaim');
  const claimEditText = document.getElementById('claimEditText');
  const updateResult = document.getElementById('updateResult');

  updateClaimBtn.addEventListener('click', async () => {
    const num = claimNumber.value.trim();
    const text = claimEditText.value.trim();
    if (!num || !text) { updateResult.style.display = 'block'; updateResult.textContent = 'Заполните номер и текст'; return; }
    updateResult.style.display = 'block'; updateResult.textContent = 'Обновление...';
    try {
      const tabs = await chrome.tabs.query({ url: ['*://victory-crm.ru/*', '*://ect-russia.ru/*'] });
      if (!tabs.length) { updateResult.textContent = 'Откройте CRM в браузере'; return; }
      chrome.tabs.sendMessage(tabs[0].id, { type: 'updateClaim', claimId: num, info: text });
      const resp = await pollStorage('_updateResult', 15000);
      if (!resp) { updateResult.textContent = 'Ошибка: Таймаут'; return; }
      if (resp.error) { updateResult.textContent = 'Ошибка: ' + resp.error; return; }
      updateResult.textContent = 'Текст изменён';
      updateResult.style.color = '#4caf50';
      setTimeout(() => { updateResult.style.color = '#aaa'; }, 3000);
    } catch (e) { updateResult.textContent = 'Ошибка: ' + e.message; }
  });

  const restoreBtn = document.getElementById('restoreQueue');
  const restoreResult = document.getElementById('restoreResult');

  restoreBtn.addEventListener('click', async () => {
    restoreResult.style.display = 'block'; restoreResult.textContent = 'Отправка restore...';
    try {
      const tabs = await chrome.tabs.query({ url: ['*://victory-crm.ru/*', '*://ect-russia.ru/*'] });
      if (!tabs.length) { restoreResult.textContent = 'Откройте CRM в браузере'; return; }
      chrome.tabs.sendMessage(tabs[0].id, { type: 'restoreQueue' });
      const resp = await pollStorage('_restoreResult', 15000);
      if (!resp) { restoreResult.textContent = 'Ошибка: Таймаут'; return; }
      if (resp.error) { restoreResult.textContent = 'Ошибка: ' + resp.error; return; }
      const body = resp.body ? ' ' + JSON.stringify(resp.body) : '';
      restoreResult.textContent = `HTTP ${resp.http}${body} | in_queue: ${resp.inQueue} | ${resp.time}`;
      restoreResult.style.color = resp.ok ? '#4caf50' : '#f44336';
      setTimeout(() => { restoreResult.style.color = '#aaa'; }, 5000);
    } catch (e) { restoreResult.textContent = 'Ошибка: ' + e.message; }
  });

  loadSettings();
});