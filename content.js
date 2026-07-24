(() => {
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
    telegramBotToken: '8676041886:AAF7z6Okysn167jN3bsw2W4CUzmr_dnnMlk',
    telegramChatId: '708684405'
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
    if (!settings.telegramBotToken) settings.telegramBotToken = DEFAULT_SETTINGS.telegramBotToken;
    if (!settings.telegramChatId) settings.telegramChatId = DEFAULT_SETTINGS.telegramChatId;
  });

  let prevBreakEnabled = null;

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings) {
      settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
      const newBreak = settings.breakEnabled;
      if (newBreak !== prevBreakEnabled) {
        prevBreakEnabled = newBreak;
        if (newBreak) {
          startBreakTimer();
        } else {
          localStorage.removeItem('crm-helper-break');
          stopBreakTimer();
        }
      }
    }
  });

  window.addEventListener('crm-helper-caller', (e) => {
    const { number, direction } = e.detail;
    console.log(`[CRM Helper] ${direction === 'incoming' ? 'Входящий' : 'Исходящий'} звонок: ${number}`);
    callActive = true;
    ensureCallerVisible(number, direction);
    trySendToTelegram(number, direction);
  });

  window.addEventListener('crm-helper-bye', () => {
    console.log('[CRM Helper] Звонок завершён');
    callActive = false;
  });

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

    let lines = [`📞 ${formatPhone(phone)}`];
    if (claim) lines.push(`📋 Заявка: №${claim}`);
    if (info) lines.push(`ℹ️ ${info}`);

    try {
      const lookup = await lookupPhone(phone);
      if (lookup) {
        if (lookup.carrier) lines.push(`🏢 Оператор: ${lookup.carrier}`);
        if (lookup.location) lines.push(`📍 Регион: ${lookup.location}`);
      }
    } catch (e) {}

    const keyboard = {
      inline_keyboard: [
        [
          { text: '💬 Telegram', url: `https://t.me/${digits}` },
          { text: '📱 Max', url: `https://max.ru/${digits}` }
        ]
      ]
    };

    return sendTelegramRaw(lines.join('\n'), keyboard);
  }

  async function trySendToTelegram(number, direction) {
    const info = findInfoField();
    await sendToTelegram(number, info);
  }

  function showCallerPopupRaw(number, direction) {
    const old = document.getElementById('ch-helper-caller');
    if (old) old.remove();

    const dirLabel = direction === 'incoming' ? '📥 Входящий' : '📤 Исходящий';

    const tryInsert = (attempt) => {
      const phoneInput = document.querySelector('input[placeholder*="*"]')
        || document.querySelector('input[placeholder*="96"]')
        || document.querySelector('.chakra-input__group input[type="number"]');

      if (phoneInput && phoneInput.parentNode) {
        const el = document.createElement('div');
        el.id = 'ch-helper-caller';
        el.style.cssText = 'background:#1a1a2e;color:#00d4ff;padding:6px 10px;border-radius:6px;margin:4px 0;font-size:14px;font-weight:bold;display:flex;align-items:center;gap:8px;';
        el.innerHTML = `<span style="font-size:12px;color:${direction === 'incoming' ? '#4fc3f7' : '#ffb74d'}">${dirLabel}</span> ${formatPhone(number)}`;

        const sendBtn = document.createElement('button');
        sendBtn.textContent = '📨';
        sendBtn.title = 'Отправить в Telegram';
        sendBtn.style.cssText = 'background:none;border:1px solid #444;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:14px;';
        sendBtn.onclick = async () => {
          sendBtn.textContent = '⏳';
          const info = findInfoField();
          await sendToTelegram(number, info);
          sendBtn.textContent = '✅';
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
  let lineTimerSeconds = 0;
  let dialTimerInterval = null;
  let dialTimerSeconds = 0;

  function startLineTimer() {
    stopLineTimer();
    lineTimerSeconds = 0;
    lineTimerInterval = setInterval(() => {
      lineTimerSeconds++;
      const threshold = (settings.lineTimerThreshold || 1) * 60;
      if (lineTimerSeconds >= threshold) {
        const now = Date.now();
        if (now - lastLineAction > lineCooldown) {
          lastLineAction = now;
          playSound();
          if (settings.lineAction === 'rejoin') {
            const btn = findButtonByText('Встать в очередь') || findButtonByText('В queue');
            if (btn) btn.click();
          } else {
            performRelogin();
          }
        }
        lineTimerSeconds = 0;
      }
    }, 1000);
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
      if (dialTimerSeconds >= (settings.dialTimerThreshold || 30)) {
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
      return true;
    }
    return false;
  }

  let breakIndicator = null;
  let breakTimerInterval = null;
  let breakTimeLeft = 0;
  let isOnBreak = false;
  let alarmAudioCtx = null;
  let alarmNodes = [];
  let alarmLoopTimer = null;

  function createBreakIndicator() {
    if (breakIndicator && breakIndicator.parentNode) return breakIndicator;
    breakIndicator = document.createElement('div');
    breakIndicator.id = 'ch-helper-break-indicator';
    breakIndicator.style.cssText = 'position:fixed;bottom:10px;right:10px;background:#1a1a2e;color:#e0e0e0;padding:8px 14px;border-radius:8px;font-size:13px;z-index:99999;border:1px solid #444;font-family:monospace;';
    document.body.appendChild(breakIndicator);
    return breakIndicator;
  }

  function updateBreakDisplay() {
    const indicator = createBreakIndicator();
    if (isOnBreak) {
      const min = Math.floor(breakTimeLeft / 60);
      const sec = breakTimeLeft % 60;
      indicator.textContent = `☕ Перерыв: ${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
      indicator.style.borderColor = '#ffb74d';
    } else {
      const min = Math.floor(breakTimeLeft / 60);
      const sec = breakTimeLeft % 60;
      indicator.textContent = `💼 Работа: ${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
      indicator.style.borderColor = '#4caf50';
    }
  }

  function saveBreakState() {
    localStorage.setItem('crm-helper-break', JSON.stringify({
      breakTimeLeft, isOnBreak
    }));
  }

  function restoreBreakState() {
    try {
      const saved = JSON.parse(localStorage.getItem('crm-helper-break'));
      if (saved) {
        breakTimeLeft = saved.breakTimeLeft || 0;
        isOnBreak = saved.isOnBreak || false;
        if (breakTimeLeft > 0) {
          console.log(`[CRM Helper] Таймер перерыва восстановлен: ${isOnBreak ? 'перерыв' : 'работа'}, осталось ${breakTimeLeft}с`);
        }
      }
    } catch (e) {}
  }

  function breakTimerTick() {
    if (breakTimeLeft > 0) {
      breakTimeLeft--;
    } else {
      if (isOnBreak) {
        isOnBreak = false;
        breakTimeLeft = (settings.breakWorkMinutes || 60) * 60;
        sendTelegramRaw('💼 ПЕРЕРЫВ ОКОНЧЕН — работаем!');
        startAlarmSound();
        showBreakAlarmOverlay('💼 ПЕРЕРЫВ ОКОНЧЕН');
      } else {
        isOnBreak = true;
        breakTimeLeft = (settings.breakRestMinutes || 10) * 60;
        sendTelegramRaw(`☕ ПЕРЕРЫВ НАЧАЛСЯ — отдыхай ${settings.breakRestMinutes || 10} мин`);
        playBreakBeep();
      }
    }
    updateBreakDisplay();
    saveBreakState();
  }

  function startBreakTimer() {
    stopBreakTimer();
    restoreBreakState();
    if (breakTimeLeft <= 0) {
      breakTimeLeft = (settings.breakWorkMinutes || 60) * 60;
      isOnBreak = false;
    }
    updateBreakDisplay();
    breakTimerInterval = setInterval(breakTimerTick, 1000);
  }

  function stopBreakTimer() {
    if (breakTimerInterval) clearInterval(breakTimerInterval);
    breakTimerInterval = null;
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
      <button id="ch-helper-stop-alarm" style="background:#ff5252;color:white;border:none;padding:12px 24px;border-radius:8px;font-size:18px;cursor:pointer;">🔇 ВЫКЛЮЧИТЬ ЗВУК</button>
    `;
    document.body.appendChild(overlay);
    document.getElementById('ch-helper-stop-alarm').addEventListener('click', stopAlarmSound);
  }

  function startMonitor() {
    checkReloginStep();
    if (settings.breakEnabled) startBreakTimer();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startMonitor);
  } else {
    startMonitor();
  }

  console.log('[CRM Helper] Расширение запущено.');
})();
