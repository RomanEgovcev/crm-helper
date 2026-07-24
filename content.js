(() => {
  const CRM_HOSTS = ['victory-crm.ru', 'ect-russia.ru'];
  const IS_CRM_PAGE = CRM_HOSTS.some(h => location.hostname.includes(h));

  const DEFAULT_SETTINGS = {
    lineTimerEnabled: true,
    lineTimerThreshold: 1,
    lineAction: 'rejoin',
    dialTimerEnabled: true,
    dialTimerThreshold: 30,
    soundType: 'alarm',
    volume: 80,
    breakEnabled: true,
    breakWorkMinutes: 60,
    breakRestMinutes: 10,
    telegramBotToken: '',
    telegramChatId: ''
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

  let prevBreakEnabled = null;

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings) {
      settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
      if (!IS_CRM_PAGE) return;
      const newBreak = settings.breakEnabled;
      if (newBreak !== prevBreakEnabled) {
        prevBreakEnabled = newBreak;
        if (newBreak) {
          startBreakTimer();
        } else {
          localStorage.removeItem('crm-helper-break');
          stopBreakTimer();
          removeBreakIndicator();
        }
      }
    }
  });

  if (IS_CRM_PAGE) {
    window.addEventListener('crm-helper-caller', (e) => {
      const { number, direction } = e.detail;
      console.log(`[CRM Helper] ${direction === 'incoming' ? 'Входящий' : 'Исходящий'} звонок: ${number}`);
      callActive = true;
      ensureCallerVisible(number, direction);
      trySendToTelegram(number, direction);
      startDialTimer();
    });

    window.addEventListener('crm-helper-bye', () => {
      console.log('[CRM Helper] Звонок завершён');
      callActive = false;
      stopDialTimer();
      hideCallerPopup();
    });
  }

  let lastNumber = '';
  let lastDirection = '';
  let lastInsertTime = 0;
  let callActive = false;
  let callerReinsertInterval = null;

  function formatPhone(number) {
    const d = number.replace(/\D/g, '').replace(/^8/, '7');
    if (d.length === 11 && d.startsWith('7')) {
      return `+7 (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7,9)}-${d.slice(9)}`;
    }
    return number;
  }

  function phoneDigits(number) {
    const digits = number.replace(/\D/g, '').replace(/^8/, '7');
    return '+' + digits;
  }

  async function lookupPhone(number) {
    const digits = number.replace(/\D/g, '').replace(/^8/, '7');
    try {
      return await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'lookupPhone', digits }, (resp) => {
          resolve(resp || null);
        });
      });
    } catch (e) {
      return null;
    }
  }

  function findInfoField() {
    const labels = document.querySelectorAll('label');
    for (const label of labels) {
      if (label.textContent.includes('Инфо')) {
        const group = label.closest('.chakra-form-control');
        if (group) {
          const input = group.querySelector('input');
          if (input) return input.value || '';
        }
      }
    }
    return '';
  }

  function findClaimNumber() {
    const headings = document.querySelectorAll('h2.chakra-heading, h2, h3');
    for (const h of headings) {
      const match = h.textContent.match(/Заявка[^\d]*(\d+)/);
      if (match) return match[1];
    }
    return '';
  }

  async function sendTelegramRaw(text, replyMarkup) {
    if (!settings.telegramBotToken || !settings.telegramChatId) return false;
    try {
      const body = { chat_id: settings.telegramChatId, text: text };
      if (replyMarkup) body.reply_markup = replyMarkup;
      console.log('[CRM Helper] Telegram body:', JSON.stringify(body).substring(0, 200));
      const response = await fetch(`https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const result = await response.json();
      console.log('[CRM Helper] Telegram response:', JSON.stringify(result).substring(0, 200));
      return response.ok;
    } catch (e) {
      console.error('[CRM Helper] Ошибка Telegram:', e);
      return false;
    }
  }

  async function sendToTelegram(phone, info) {
    const claim = findClaimNumber();
    const digits = phoneDigits(phone);

    let lines = [`\ud83d\udcde ${formatPhone(phone)}`];
    if (claim) lines.push(`\ud83d\udccb Заявка: \u2116${claim}`);
    if (info) lines.push(`\u2139\ufe0f ${info}`);

    try {
      const lookup = await lookupPhone(phone);
      if (lookup) {
        if (lookup.carrier) lines.push(`\ud83c\udfe2 Оператор: ${lookup.carrier}`);
        if (lookup.location) lines.push(`\ud83d\udccd Регион: ${lookup.location}`);
      }
    } catch (e) {}

    const keyboard = {
      inline_keyboard: [
        [
          { text: '\ud83d\udfac Telegram', url: `https://t.me/${digits}` },
          { text: '\ud83d\udcf1 Max', url: `https://max.ru/${digits}` }
        ]
      ]
    };

    return sendTelegramRaw(lines.join('\n'), keyboard);
  }

  async function trySendToTelegram(number, direction) {
    const info = findInfoField();
    await sendToTelegram(number, info);
  }

  function findPhoneInput() {
    return document.querySelector('input[placeholder*="*"]')
      || document.querySelector('input[placeholder*="96"]')
      || document.querySelector('.chakra-input__group input[type="number"]');
  }

  function showCallerPopupRaw(number, direction) {
    document.querySelectorAll('#ch-helper-caller').forEach(el => el.remove());

    const dirLabel = direction === 'incoming' ? '\ud83d\udce5 Входящий' : '\ud83d\udce8 Исходящий';
    const dirColor = direction === 'incoming' ? '#4fc3f7' : '#ffb74d';

    const tryInsert = (attempt) => {
      if (document.getElementById('ch-helper-caller')) return true;
      const phoneInput = findPhoneInput();
      if (phoneInput && phoneInput.parentNode) {
        const el = document.createElement('div');
        el.id = 'ch-helper-caller';
        el.style.cssText = `
          background: linear-gradient(135deg, #0d1b2a, #1b2838);
          color: #e0e0e0;
          padding: 8px 12px;
          border-radius: 8px;
          margin: 4px 0;
          font-size: 13px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 8px;
          border: 1px solid ${dirColor}40;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          max-width: 320px;
        `;
        el.innerHTML = `<span style="font-size:11px;color:${dirColor};white-space:nowrap">${dirLabel}</span><span style="color:#00d4ff;letter-spacing:0.5px">${formatPhone(number)}</span>`;

        const sendBtn = document.createElement('button');
        sendBtn.textContent = '\ud83d\udce4';
        sendBtn.title = 'Отправить в Telegram';
        sendBtn.style.cssText = 'background:none;border:1px solid #333;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:12px;margin-left:auto;flex-shrink:0;';
        sendBtn.onclick = async (e) => {
          e.stopPropagation();
          sendBtn.textContent = '\u23f3';
          const info = findInfoField();
          await sendToTelegram(number, info);
          sendBtn.textContent = '\u2705';
          setTimeout(() => { sendBtn.textContent = '\ud83d\udce4'; }, 3000);
        };
        el.appendChild(sendBtn);

        phoneInput.parentNode.insertBefore(el, phoneInput);
        console.log('[CRM Helper] Номер + кнопка Telegram вставлены');
        return true;
      }
      return false;
    };

    if (!tryInsert(0)) {
      let attempts = 0;
      const timer = setInterval(() => {
        attempts++;
        if (tryInsert(attempts) || attempts > 20) clearInterval(timer);
      }, 500);
    }

    if (callerReinsertInterval) clearInterval(callerReinsertInterval);
    callerReinsertInterval = setInterval(() => {
      if (!callActive) {
        clearInterval(callerReinsertInterval);
        callerReinsertInterval = null;
        return;
      }
      tryInsert(0);
    }, 2000);
  }

  function hideCallerPopup() {
    if (callerReinsertInterval) {
      clearInterval(callerReinsertInterval);
      callerReinsertInterval = null;
    }
  }

  function ensureCallerVisible(number, direction) {
    lastNumber = number;
    lastDirection = direction;
    lastInsertTime = Date.now();
    showCallerPopupRaw(number, direction);
  }

  function playAlarm() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      const vol = (settings.volume || 80) / 100;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 880;
      gain.gain.value = vol * 0.5;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) {}
  }

  function playBeep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      const vol = (settings.volume || 80) / 100;
      for (let i = 0; i < 3; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 660;
        gain.gain.value = vol * 0.3;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.2);
        osc.stop(ctx.currentTime + i * 0.2 + 0.1);
      }
    } catch (e) {}
  }

  function playSound() {
    if (settings.soundType === 'alarm') playAlarm();
    else if (settings.soundType === 'beep') playBeep();
  }

  let lineTimerInterval = null;
  let dialTimerInterval = null;
  let dialTimerSeconds = 0;

  function startLineTimer() {
    stopLineTimer();
    lastLineAction = 0;
    lineTimerInterval = setInterval(() => {
      const el = document.querySelector('p.chakra-text[class*="css-"]');
      if (!el) return;
      const text = el.textContent.trim();
      const match = text.match(/^(\d+):(\d{2})$/);
      if (!match) return;
      const totalSec = parseInt(match[1]) * 60 + parseInt(match[2]);
      const threshold = (settings.lineTimerThreshold || 1) * 60;
      if (totalSec >= threshold) {
        const now = Date.now();
        if (now - lastLineAction > lineCooldown) {
          lastLineAction = now;
          if (settings.lineAction === 'rejoin') {
            const btn = findButtonByText('Встать в очередь') || findButtonByText('В queue');
            if (btn) btn.click();
          } else {
            performRelogin();
          }
        }
      }
    }, 2000);
  }

  function stopLineTimer() {
    if (lineTimerInterval) clearInterval(lineTimerInterval);
    lineTimerInterval = null;
  }

  function startDialTimer() {
    stopDialTimer();
    dialTimerSeconds = 0;
    dialTimerInterval = setInterval(() => {
      dialTimerSeconds++;
      const threshold = settings.dialTimerThreshold || 30;
      if (dialTimerSeconds >= threshold) {
        const now = Date.now();
        if (now - lastDialAction > dialCooldown) {
          lastDialAction = now;
          playSound();
        }
        dialTimerSeconds = 0;
      }
    }, 1000);
  }

  function stopDialTimer() {
    if (dialTimerInterval) clearInterval(dialTimerInterval);
    dialTimerInterval = null;
    dialTimerSeconds = 0;
  }

  function findButtonByText(text) {
    const buttons = document.querySelectorAll('button');
    for (const b of buttons) {
      if (b.textContent.includes(text)) return b;
    }
    return null;
  }

  let reloginStep = 0;

  function performRelogin() {
    reloginStep = 2;
    chrome.storage.local.set({ reloginStep: 2 });
    const logoutBtn = findButtonByText('Выйти');
    if (logoutBtn) logoutBtn.click();
  }

  function checkReloginStep() {
    chrome.storage.local.get(['reloginStep'], (result) => {
      const step = result.reloginStep;
      if (step === 2) {
        setTimeout(() => {
          const usernameInput = document.querySelector('input[name="username"]');
          const passwordInput = document.querySelector('input[name="password"]');
          const submitBtn = document.querySelector('button[type="submit"]');
          if (usernameInput && passwordInput && submitBtn) {
            const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeSet.call(usernameInput, 'EgovcevRM');
            usernameInput.dispatchEvent(new Event('input', { bubbles: true }));
            nativeSet.call(passwordInput, 'EgcRoman.1507');
            passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
            submitBtn.click();
            reloginStep = 3;
            chrome.storage.local.set({ reloginStep: 3 });
            checkStep3AfterLogin();
          }
        }, 1000);
      } else if (step === 3) {
        tryClickQueue();
      }
    });
  }

  function checkStep3AfterLogin() {
    let attempts = 0;
    const maxAttempts = 30;
    const interval = setInterval(() => {
      attempts++;
      if (tryClickQueue() || attempts >= maxAttempts) {
        clearInterval(interval);
      }
    }, 1500);
  }

  function tryClickQueue() {
    const btn = findButtonByText('Встать в очередь');
    if (btn) {
      btn.click();
      reloginStep = 0;
      chrome.storage.local.set({ reloginStep: 0 });
      startLineTimer();
      return true;
    }
    return false;
  }

  let breakIndicator = null;
  let breakDisplayInterval = null;
  let breakPhaseEndAt = 0;
  let isOnBreak = false;
  let alarmAudioCtx = null;
  let alarmNodes = [];
  let alarmLoopTimer = null;

  function createBreakIndicator() {
    if (breakIndicator && breakIndicator.parentNode) return breakIndicator;
    if (!document.body) { console.warn('[CRM Helper] createBreakIndicator: document.body not ready'); return null; }
    console.log('[CRM Helper] Creating break indicator element');
    breakIndicator = document.createElement('div');
    breakIndicator.id = 'ch-helper-break-indicator';
    breakIndicator.style.cssText = `
      position: fixed;
      bottom: 10px;
      right: 10px;
      background: linear-gradient(135deg, #0d1b2a, #1b2838);
      color: #e0e0e0;
      padding: 8px 14px;
      border-radius: 8px;
      font-size: 13px;
      z-index: 99999;
      border: 1px solid #444;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      box-shadow: 0 2px 12px rgba(0,0,0,0.4);
      transition: border-color 0.3s;
    `;
    document.body.appendChild(breakIndicator);
    return breakIndicator;
  }

  function removeBreakIndicator() {
    if (breakIndicator && breakIndicator.parentNode) {
      breakIndicator.remove();
      breakIndicator = null;
    }
  }

  function getBreakTimeLeft() {
    if (breakPhaseEndAt <= 0) return 0;
    return Math.max(0, Math.ceil((breakPhaseEndAt - Date.now()) / 1000));
  }

  function updateBreakDisplay() {
    const indicator = createBreakIndicator();
    if (!indicator) return;
    const left = getBreakTimeLeft();
    const min = Math.floor(left / 60);
    const sec = left % 60;
    if (isOnBreak) {
      indicator.textContent = `\u2615 Перерыв: ${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
      indicator.style.borderColor = '#ffb74d';
    } else {
      indicator.textContent = `\ud83d\udcbc Работа: ${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
      indicator.style.borderColor = '#4caf50';
    }
  }

  function saveBreakState() {
    localStorage.setItem('crm-helper-break', JSON.stringify({
      breakPhaseEndAt, isOnBreak
    }));
  }

  function restoreBreakState() {
    try {
      const saved = JSON.parse(localStorage.getItem('crm-helper-break'));
      if (saved) {
        isOnBreak = saved.isOnBreak || false;
        breakPhaseEndAt = saved.breakPhaseEndAt || 0;
        if (breakPhaseEndAt > Date.now()) {
          const left = Math.ceil((breakPhaseEndAt - Date.now()) / 1000);
          console.log(`[CRM Helper] Таймер перерыва восстановлен: ${isOnBreak ? 'перерыв' : 'работа'}, осталось ${left}с`);
        } else if (breakPhaseEndAt > 0) {
          handleBreakPhaseEnd();
        }
      }
    } catch (e) {}
  }

  function handleBreakPhaseEnd() {
    if (isOnBreak) {
      isOnBreak = false;
      breakPhaseEndAt = Date.now() + (settings.breakWorkMinutes || 60) * 60 * 1000;
      sendTelegramRaw('\ud83d\udcbc ПЕРЕРЫВ ОКОНЧЕН — работаем!');
      startAlarmSound();
      showBreakAlarmOverlay('\ud83d\udcbc ПЕРЕРЫВ ОКОНЧЕН');
    } else {
      isOnBreak = true;
      breakPhaseEndAt = Date.now() + (settings.breakRestMinutes || 10) * 60 * 1000;
      sendTelegramRaw(`\u2615 ПЕРЕРЫВ НАЧАЛСЯ — отдыхай ${settings.breakRestMinutes || 10} мин`);
      playBreakBeep();
    }
    updateBreakDisplay();
    saveBreakState();
    scheduleBreakAlarm();
  }

  function scheduleBreakAlarm() {
    try {
      chrome.runtime.sendMessage({ type: 'clearBreakAlarm' }, () => {
        try {
          if (breakPhaseEndAt > Date.now()) {
            chrome.runtime.sendMessage({ type: 'setBreakAlarm', when: breakPhaseEndAt });
          } else if (breakPhaseEndAt > 0) {
            handleBreakPhaseEnd();
          }
        } catch (e) { console.error('[CRM Helper] setBreakAlarm error:', e); }
      });
    } catch (e) { console.error('[CRM Helper] clearBreakAlarm error:', e); }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'breakAlarmFired') {
      console.log('[CRM Helper] Break alarm received from background');
      handleBreakPhaseEnd();
    }
  });

  function startBreakTimer() {
    console.log('[CRM Helper] startBreakTimer() called');
    stopBreakTimer();
    restoreBreakState();
    if (breakPhaseEndAt <= Date.now()) {
      breakPhaseEndAt = Date.now() + (settings.breakWorkMinutes || 60) * 60 * 1000;
      isOnBreak = false;
      console.log('[CRM Helper] New break phase: work, ends at', new Date(breakPhaseEndAt).toLocaleTimeString());
    } else {
      console.log('[CRM Helper] Restored break phase:', isOnBreak ? 'break' : 'work', 'ends at', new Date(breakPhaseEndAt).toLocaleTimeString());
    }
    updateBreakDisplay();
    saveBreakState();
    scheduleBreakAlarm();
    breakDisplayInterval = setInterval(updateBreakDisplay, 1000);
    console.log('[CRM Helper] Break timer started, indicator interval set');
  }

  function stopBreakTimer() {
    if (breakDisplayInterval) clearInterval(breakDisplayInterval);
    breakDisplayInterval = null;
    breakPhaseEndAt = 0;
    chrome.runtime.sendMessage({ type: 'clearBreakAlarm' });
  }

  function playBreakBeep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      for (let i = 0; i < 3; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 660;
        gain.gain.value = 0.3;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.2);
        osc.stop(ctx.currentTime + i * 0.2 + 0.1);
      }
    } catch (e) {}
  }

  function startAlarmSound() {
    stopAlarmSound();
    try {
      alarmAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (alarmAudioCtx.state === 'suspended') alarmAudioCtx.resume();
      function pulse() {
        try {
          const osc = alarmAudioCtx.createOscillator();
          const gain = alarmAudioCtx.createGain();
          osc.type = 'square';
          osc.frequency.value = 880;
          gain.gain.value = 0.4;
          osc.connect(gain);
          gain.connect(alarmAudioCtx.destination);
          osc.start();
          osc.stop(alarmAudioCtx.currentTime + 0.15);
          alarmNodes.push(osc);
          osc.onended = () => {
            const idx = alarmNodes.indexOf(osc);
            if (idx !== -1) alarmNodes.splice(idx, 1);
          };
        } catch (e) {}
      }
      pulse();
      alarmLoopTimer = setInterval(pulse, 200);
    } catch (e) {}
  }

  function stopAlarmSound() {
    if (alarmLoopTimer) {
      clearInterval(alarmLoopTimer);
      alarmLoopTimer = null;
    }
    alarmNodes.forEach(n => { try { n.stop(); } catch (e) {} });
    alarmNodes = [];
    if (alarmAudioCtx) {
      try { alarmAudioCtx.close(); } catch (e) {}
      alarmAudioCtx = null;
    }
    const overlay = document.getElementById('ch-helper-alarm-overlay');
    if (overlay) overlay.remove();
  }

  function showBreakAlarmOverlay(text) {
    stopAlarmSound();
    startAlarmSound();
    const overlay = document.createElement('div');
    overlay.id = 'ch-helper-alarm-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);z-index:999999;display:flex;align-items:center;justify-content:center;flex-direction:column;';
    overlay.innerHTML = `
      <div style="color:#ff5252;font-size:32px;font-weight:bold;margin-bottom:20px;">${text}</div>
      <button id="ch-helper-stop-alarm" style="background:#ff5252;color:white;border:none;padding:12px 24px;border-radius:8px;font-size:18px;cursor:pointer;">\ud83d\udd07 ВЫКЛЮЧИТЬ ЗВУК</button>
    `;
    document.body.appendChild(overlay);
    document.getElementById('ch-helper-stop-alarm').addEventListener('click', stopAlarmSound);
  }

  function startMonitor() {
    console.log('[CRM Helper] startMonitor() called, IS_CRM_PAGE=' + IS_CRM_PAGE, 'breakEnabled=' + settings.breakEnabled);
    checkReloginStep();
    console.log('[CRM Helper] Starting line timer...');
    startLineTimer();
    if (settings.breakEnabled) {
      console.log('[CRM Helper] Starting break timer...');
      startBreakTimer();
    } else {
      console.log('[CRM Helper] Break timer disabled in settings');
    }
  }

  function onReady() {
    console.log('[CRM Helper] DOM ready, starting monitor on CRM=' + IS_CRM_PAGE);
    if (IS_CRM_PAGE) startMonitor();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }

  console.log('[CRM Helper] Расширение запущено, IS_CRM_PAGE=' + IS_CRM_PAGE);
})();
