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
  const lineCooldown = 30000;
  let _crmToken = null;

  window.addEventListener('message', (evt) => {
    if (evt.data?.type === 'crm-helper-token') _crmToken = evt.data.token;
  });

  chrome.storage.local.get(['settings'], (result) => {
    if (result.settings) {
      settings = { ...DEFAULT_SETTINGS, ...result.settings };
    }
    console.log('[CRM Helper] Settings loaded, musicWidgetEnabled=' + settings.musicWidgetEnabled);
    if (settings.musicWidgetEnabled === false && musicWidget) {
      musicWidget.style.display = 'none';
      console.log('[CRM Helper] Music widget hidden (disabled in settings)');
    }
    if (settings.notepadEnabled === false && notepadEl) {
      notepadEl.style.display = 'none';
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
      if (settings.musicWidgetEnabled === false && musicWidget) {
        musicWidget.style.display = 'none';
      } else if (settings.musicWidgetEnabled !== false && musicWidget) {
        musicWidget.style.display = 'flex';
      }
      if (settings.notepadEnabled === false) { hideNotepad(); } else { showNotepad(); }
    }
  });

  if (IS_CRM_PAGE) {
    window.addEventListener('crm-helper-caller', (e) => {
      const { number, direction } = e.detail;
      console.log(`[CRM Helper] ${direction === 'incoming' ? 'Входящий' : 'Исходящий'} звонок: ${number}`);
      callActive = true;
      ensureCallerVisible(number, direction);
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
    if (!settings.telegramBotToken || !settings.telegramChatId) {
      console.warn('[CRM Helper] sendTelegramRaw: пустой token или chatId');
      return false;
    }
    if (text.length > 4000) text = text.substring(0, 3997) + '...';
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'sendTelegram', text, replyMarkup }, (ok) => {
        console.log('[CRM Helper] Telegram via BG:', ok);
        resolve(ok || false);
      });
    });
  }

  async function sendToTelegram(phone, info) {
    const claim = findClaimNumber();
    const digits = phoneDigits(phone);

    let lines = [`\ud83d\udcde ${formatPhone(phone)}`];
    if (claim) lines.push(`\ud83d\udccb Заявка: \u2116${claim}`);
    if (info) lines.push(`\u2139\ufe0f ${info}`);

    try {
      const lookup = await lookupPhone(phone);
      console.log('[CRM Helper] lookupPhone result:', JSON.stringify(lookup));
      if (lookup) {
        if (lookup.operator) lines.push(`🏢 Оператор: ${lookup.operator}`);
        if (lookup.region) lines.push(`📍 Регион: ${lookup.region}`);
      }
    } catch (e) { console.error('[CRM Helper] lookupPhone error:', e); }

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
    if (!settings.telegramBotToken || !settings.telegramChatId) {
      console.warn('[CRM Helper] Telegram НЕ настроен: botToken=' + (settings.telegramBotToken ? 'есть' : 'ПУСТ') + ', chatId=' + (settings.telegramChatId ? 'есть' : 'ПУСТ'));
      return;
    }
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
          align-self: flex-start;
          flex-shrink: 0;
        `;
        el.innerHTML = `<span style="font-size:11px;color:${dirColor};white-space:nowrap">${dirLabel}</span><span style="color:#00d4ff;letter-spacing:0.5px">${formatPhone(number)}</span>`;

        const sendBtn = document.createElement('button');
        sendBtn.textContent = '\ud83d\udce4';
        sendBtn.title = 'Отправить в Telegram';
        sendBtn.style.cssText = 'background:none;border:1px solid #333;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:12px;margin-left:auto;flex-shrink:0;';
        sendBtn.onclick = async (e) => {
          e.stopPropagation();
          console.log('[CRM Helper] Telegram button clicked for', number);
          sendBtn.textContent = '\u23f3';
          try {
            const info = findInfoField();
            const ok = await sendToTelegram(number, info);
            console.log('[CRM Helper] Telegram send result:', ok);
            sendBtn.textContent = ok ? '\u2705' : '\u274c';
          } catch (err) {
            console.error('[CRM Helper] Telegram send error:', err);
            sendBtn.textContent = '\u274c';
          }
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

  function startLineTimer() {
    stopLineTimer();
    lastLineAction = 0;
    let tickCount = 0;
    lineTimerInterval = setInterval(() => {
      tickCount++;
      const candidates = document.querySelectorAll('p[class*="css-"], span[class*="css-"], div[class*="css-"]');
      let found = null;
      for (const el of candidates) {
        const t = el.textContent.trim();
        if (/^\d+:\d{2}$/.test(t) && t !== '00:00') { found = el; }
      }
      if (!found) {
        if (tickCount % 15 === 0) console.log(`[CRM Helper] LineTimer: no timer element found (${candidates.length} p-css candidates)`);
        return;
      }
      const text = found.textContent.trim();
      const match = text.match(/^(\d+):(\d{2})$/);
      if (!match) return;
      const totalSec = parseInt(match[1]) * 60 + parseInt(match[2]);
      const threshold = (settings.lineTimerThreshold || 1) * 60;
      if (totalSec % 10 === 0 || totalSec >= threshold - 10 || tickCount <= 3) {
        console.log(`[CRM Helper] LineTimer: ${text} (${totalSec}s) / threshold ${threshold}s`);
      }
      if (totalSec >= threshold) {
        const now = Date.now();
        if (now - lastLineAction > lineCooldown) {
          lastLineAction = now;
          console.log(`[CRM Helper] LineTimer: THRESHOLD REACHED (${totalSec}s >= ${threshold}s), action=${settings.lineAction}`);
          if (settings.lineAction === 'rejoin') {
            const queueBtn = findQueueButton();
            if (queueBtn) {
              queueBtn.click();
              console.log('[CRM Helper] LineTimer: clicked rejoin');
            } else {
              const leaveBtn = findLeaveQueueButton();
              if (leaveBtn) {
                console.log('[CRM Helper] LineTimer: agent already in queue, leaving first...');
                leaveBtn.click();
                setTimeout(() => {
                  const qBtn = findQueueButton();
                  if (qBtn) { qBtn.click(); console.log('[CRM Helper] LineTimer: rejoin completed (left + joined)'); }
                  else console.log('[CRM Helper] LineTimer: queue button not found after leaving');
                }, 2000);
              } else {
                console.log('[CRM Helper] LineTimer: neither queue nor leave button found');
              }
            }
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
    let lastDialActionLocal = 0;
    const dialCooldown = 10000;
    dialTimerInterval = setInterval(() => {
      if (!settings.dialTimerEnabled) return;
      const candidates = document.querySelectorAll('p[class*="css-"], span[class*="css-"], div[class*="css-"]');
      let found = null;
      for (const el of candidates) {
        const t = el.textContent.trim();
        const m = t.match(/Набор номера\s*\((\d+):(\d{2})\)/);
        if (m) { found = { el, min: parseInt(m[1]), sec: parseInt(m[2]) }; break; }
      }
      if (!found) return;
      const totalSec = found.min * 60 + found.sec;
      const threshold = (settings.dialTimerThreshold || 30);
      if (totalSec >= threshold) {
        const now = Date.now();
        if (now - lastDialActionLocal > dialCooldown) {
          lastDialActionLocal = now;
          console.log(`[CRM Helper] DialTimer: THRESHOLD REACHED (${totalSec}s >= ${threshold}s), dropping call`);
          const hangupBtn = document.querySelector('button[aria-label="Сбросить"]');
          if (hangupBtn) { hangupBtn.click(); console.log('[CRM Helper] DialTimer: clicked Сбросить'); }
          else console.log('[CRM Helper] DialTimer: Сбросить button NOT found');
          playSound();
        }
      }
    }, 2000);
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

  function findQueueButton() {
    let btn = findButtonByText('Встать в очередь');
    if (btn) { console.log('[CRM Helper] findQueueButton: found by exact text "Встать в очередь"'); return btn; }
    btn = findButtonByText('В queue');
    if (btn) { console.log('[CRM Helper] findQueueButton: found by "В queue"'); return btn; }
    const queuePatterns = [/встать.*очеред/i, /queue/i, /join/i];
    const buttons = document.querySelectorAll('button');
    for (const b of buttons) {
      const txt = b.textContent.trim().toLowerCase();
      if (/выйти.*очеред/i.test(txt)) continue;
      for (const p of queuePatterns) {
        if (p.test(txt)) { console.log('[CRM Helper] findQueueButton: found by regex', p, 'text:', b.textContent.trim().slice(0, 50)); return b; }
      }
    }
    console.log('[CRM Helper] findQueueButton: NOT found');
    return null;
  }

  function findLeaveQueueButton() {
    const btn = findButtonByText('Выйти из очереди');
    if (btn) { console.log('[CRM Helper] findLeaveQueueButton: found by exact text'); return btn; }
    const buttons = document.querySelectorAll('button');
    for (const b of buttons) {
      const txt = b.textContent.trim().toLowerCase();
      if (/выйти.*очеред/i.test(txt)) { console.log('[CRM Helper] findLeaveQueueButton: found by regex, text:', b.textContent.trim().slice(0, 50)); return b; }
    }
    console.log('[CRM Helper] findLeaveQueueButton: NOT found');
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
            console.log('[CRM Helper] Relogin step 2: filling login form');
            const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeSet.call(usernameInput, 'EgovcevRM');
            usernameInput.dispatchEvent(new Event('input', { bubbles: true }));
            nativeSet.call(passwordInput, 'EgcRoman.1507');
            passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
            submitBtn.click();
            reloginStep = 3;
            chrome.storage.local.set({ reloginStep: 3 });
            console.log('[CRM Helper] Relogin step 2: submitted, starting step 3 polling in 3s');
            setTimeout(() => checkStep3AfterLogin(), 3000);
          } else {
            console.log('[CRM Helper] Relogin step 2: login form not found yet, retrying...');
            setTimeout(() => checkReloginStep(), 2000);
          }
        }, 1000);
      } else if (step === 3) {
        console.log('[CRM Helper] Relogin step 3: trying to join queue');
        if (!tryClickQueue()) {
          console.log('[CRM Helper] Relogin step 3: queue button not found, starting polling...');
          checkStep3AfterLogin();
        }
      }
    });
  }

  function checkStep3AfterLogin() {
    let attempts = 0;
    const maxAttempts = 30;
    const interval = setInterval(() => {
      attempts++;
      const found = tryClickQueue();
      if (attempts % 5 === 0 || found || attempts >= maxAttempts) {
        console.log(`[CRM Helper] checkStep3AfterLogin: attempt ${attempts}/${maxAttempts}, found=${found}`);
      }
      if (found || attempts >= maxAttempts) {
        clearInterval(interval);
        if (!found) {
          console.log('[CRM Helper] checkStep3AfterLogin: gave up after maxAttempts');
          reloginStep = 0;
          chrome.storage.local.set({ reloginStep: 0 });
        }
      }
    }, 1500);
  }

  function tryClickQueue() {
    const btn = findQueueButton();
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
  let breakPhaseTransitioning = false;

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
    if (left <= 0 && breakPhaseEndAt > 0) {
      handleBreakPhaseEnd();
      return;
    }
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
    console.log(`[CRM Helper] handleBreakPhaseEnd called: isOnBreak=${isOnBreak}, breakPhaseEndAt=${breakPhaseEndAt}`);
    if (breakPhaseEndAt <= 0) return;
    if (breakPhaseTransitioning) { console.log('[CRM Helper] handleBreakPhaseEnd: skipped (transitioning)'); return; }
    breakPhaseTransitioning = true;
    if (isOnBreak) {
      isOnBreak = false;
      breakPhaseEndAt = Date.now() + (settings.breakWorkMinutes || 60) * 60 * 1000;
      console.log('[CRM Helper] Break ended, sending Telegram...');
      sendTelegramRaw('\ud83d\udcbc ПЕРЕРЫВ ОКОНЧЕН — работаем!').then(ok => console.log('[CRM Helper] Telegram result:', ok));
      startAlarmSound();
      showBreakAlarmOverlay('\ud83d\udcbc ПЕРЕРЫВ ОКОНЧЕН');
    } else {
      isOnBreak = true;
      breakPhaseEndAt = Date.now() + (settings.breakRestMinutes || 10) * 60 * 1000;
      console.log('[CRM Helper] Break started, sending Telegram...');
      sendTelegramRaw(`\u2615 ПЕРЕРЫВ НАЧАЛСЯ — отдыхай ${settings.breakRestMinutes || 10} мин`).then(ok => console.log('[CRM Helper] Telegram result:', ok));
      playBreakBeep();
    }
    updateBreakDisplay();
    saveBreakState();
    scheduleBreakAlarm();
    setTimeout(() => { breakPhaseTransitioning = false; }, 500);
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

  let musicWidget = null;
  let musicState = { title: '', artist: '', playing: false };

  function createMusicWidget() {
    if (musicWidget && musicWidget.parentNode) return musicWidget;
    if (!document.body) return null;
    console.log('[CRM Helper] Creating music widget');
    musicWidget = document.createElement('div');
    musicWidget.id = 'ch-helper-music';
    musicWidget.style.cssText = `
      position: fixed; bottom: 10px; left: 10px;
      background: linear-gradient(135deg, #0d1b2a, #1b2838);
      color: #e0e0e0; padding: 6px 10px; border-radius: 8px;
      font-size: 12px; z-index: 99999; border: 1px solid #444;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      box-shadow: 0 2px 12px rgba(0,0,0,0.4);
      display: flex; align-items: center; gap: 6px;
      max-width: 350px; cursor: move; user-select: none;
    `;
    musicWidget.innerHTML = `
      <span id="ch-music-note" style="font-size:14px">\u266b</span>
      <span id="ch-music-info" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0">
        <span id="ch-music-artist" style="color:#aaa"></span>
        <span id="ch-music-sep" style="color:#555;margin:0 3px">\u2014</span>
        <span id="ch-music-title" style="color:#00d4ff"></span>
      </span>
      <button id="ch-music-prev" style="background:none;border:none;color:#aaa;cursor:pointer;font-size:13px;padding:2px" title="Prev">\u23ee</button>
      <button id="ch-music-play" style="background:none;border:none;color:#fff;cursor:pointer;font-size:14px;padding:2px" title="Play/Pause">\u25b6</button>
      <button id="ch-music-next" style="background:none;border:none;color:#aaa;cursor:pointer;font-size:13px;padding:2px" title="Next">\u23ed</button>
      <span style="color:#555;margin:0 1px">|</span>
      <button id="ch-music-voldn" style="background:none;border:none;color:#aaa;cursor:pointer;font-size:13px;padding:2px" title="Vol -">\ud83d\udd07</button>
      <button id="ch-music-volup" style="background:none;border:none;color:#aaa;cursor:pointer;font-size:13px;padding:2px" title="Vol +">\ud83d\udd0a</button>
    `;
    document.body.appendChild(musicWidget);
    if (!document.getElementById('ch-helper-music-css')) {
      const s = document.createElement('style');
      s.id = 'ch-helper-music-css';
      s.textContent = '@keyframes ch-music-pulse{0%,100%{opacity:1}50%{opacity:0.4}}';
      document.head.appendChild(s);
    }
    function sendMusicAction(action, btnEl) {
      console.log('[CRM Helper] Music button clicked:', action);
      if (btnEl) { btnEl.style.opacity = '0.5'; btnEl.style.pointerEvents = 'none'; }
      chrome.runtime.sendMessage({ type: 'ym-action', action }, (resp) => {
        console.log('[CRM Helper] Music action response:', resp);
        if (btnEl) { btnEl.style.opacity = '1'; btnEl.style.pointerEvents = 'auto'; }
        if (resp && (resp.title || resp.artist)) updateMusicWidget(resp);
        else {
          const t = document.getElementById('ch-music-title');
          if (t) { t.textContent = 'Yandex Music not open'; t.style.color = '#ff5252'; }
          setTimeout(() => { if (t) t.style.color = '#00d4ff'; }, 2000);
        }
      });
    }
    document.getElementById('ch-music-play').addEventListener('click', (e) => { e.stopPropagation(); sendMusicAction('playPause', e.currentTarget); });
    document.getElementById('ch-music-next').addEventListener('click', (e) => { e.stopPropagation(); sendMusicAction('next', e.currentTarget); });
    document.getElementById('ch-music-prev').addEventListener('click', (e) => { e.stopPropagation(); sendMusicAction('prev', e.currentTarget); });
    document.getElementById('ch-music-voldn').addEventListener('click', (e) => { e.stopPropagation(); sendMusicAction('volumeDown', e.currentTarget); });
    document.getElementById('ch-music-volup').addEventListener('click', (e) => { e.stopPropagation(); sendMusicAction('volumeUp', e.currentTarget); });
    let dragging = false, ox, oy;
    musicWidget.addEventListener('mousedown', (e) => { if (e.target.tagName === 'BUTTON') return; dragging = true; ox = e.clientX - musicWidget.getBoundingClientRect().left; oy = e.clientY - musicWidget.getBoundingClientRect().top; e.preventDefault(); });
    document.addEventListener('mousemove', (e) => { if (!dragging) return; musicWidget.style.left = (e.clientX - ox) + 'px'; musicWidget.style.top = (e.clientY - oy) + 'px'; musicWidget.style.bottom = 'auto'; musicWidget.style.right = 'auto'; });
    document.addEventListener('mouseup', () => { dragging = false; });
    return musicWidget;
  }

  function updateMusicWidget(state) {
    musicState = state;
    const a = document.getElementById('ch-music-artist');
    const t = document.getElementById('ch-music-title');
    const p = document.getElementById('ch-music-play');
    const n = document.getElementById('ch-music-note');
    const s = document.getElementById('ch-music-sep');
    if (a) a.textContent = state.artist || '';
    if (t) t.textContent = state.title || '';
    if (p) p.textContent = state.playing ? '\u23f8' : '\u25b6';
    if (n) n.style.animation = state.playing ? 'ch-music-pulse 1.5s infinite' : 'none';
    if (s) s.style.display = (state.artist && state.title) ? 'inline' : 'none';
    if (!state.title && !state.artist) {
      if (a) a.textContent = 'Yandex Music';
      if (t) t.textContent = 'not playing';
    }
  }

  let notepadEl = null;

  function createNotepad() {
    if (notepadEl && notepadEl.parentNode) return notepadEl;
    if (!document.body) return null;
    console.log('[CRM Helper] Creating notepad');
    notepadEl = document.createElement('div');
    notepadEl.id = 'ch-helper-notepad';
    notepadEl.style.cssText = `
      position: fixed; bottom: 10px; right: 10px;
      width: 320px; height: 260px; min-width: 180px; min-height: 120px;
      background: #1a1a2e; color: #e0e0e0;
      border: 1px solid #444; border-radius: 10px;
      z-index: 99998;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
      display: flex; flex-direction: column;
      overflow: hidden;
    `;
    notepadEl.innerHTML = `
      <div id="ch-notepad-header" style="
        display:flex; align-items:center; justify-content:space-between;
        padding: 6px 10px; cursor: move; user-select: none;
        background: linear-gradient(135deg, #16213e, #0f3460);
        border-bottom: 1px solid #333;
      ">
        <span style="font-size:12px; font-weight:600; color:#aaa;">📝 Блокнот</span>
        <button id="ch-notepad-close" style="
          background:none; border:none; color:#888; cursor:pointer;
          font-size:16px; line-height:1; padding:0 2px;
        " title="Закрыть">\u00d7</button>
      </div>
      <textarea id="ch-notepad-textarea" style="
        flex:1; width:100%; border:none; outline:none; resize:none;
        background:#0d1117; color:#c9d1d9; padding:8px 10px;
        font-family: inherit; font-size: 13px; line-height: 1.4;
        box-sizing: border-box;
      " placeholder="Заметки..."></textarea>
      <div id="ch-notepad-resize" style="
        position:absolute; bottom:0; right:0;
        width:16px; height:16px; cursor:nw-resize;
        background:linear-gradient(135deg, transparent 50%, #555 50%);
        border-radius: 0 0 10px 0;
      "></div>
    `;
    document.body.appendChild(notepadEl);

    const header = notepadEl.querySelector('#ch-notepad-header');
    const textarea = notepadEl.querySelector('#ch-notepad-textarea');
    const resizeHandle = notepadEl.querySelector('#ch-notepad-resize');
    const closeBtn = notepadEl.querySelector('#ch-notepad-close');

    chrome.storage.local.get(['notepad'], (result) => {
      if (result.notepad) {
        const n = result.notepad;
        if (n.left != null) { notepadEl.style.left = n.left + 'px'; notepadEl.style.top = n.top + 'px'; notepadEl.style.right = 'auto'; notepadEl.style.bottom = 'auto'; }
        if (n.width) notepadEl.style.width = n.width + 'px';
        if (n.height) notepadEl.style.height = n.height + 'px';
        if (n.text) textarea.value = n.text;
      }
    });

    function saveNotepad() {
      const rect = notepadEl.getBoundingClientRect();
      chrome.storage.local.set({ notepad: { left: rect.left, top: rect.top, width: rect.width, height: rect.height, text: textarea.value } });
    }

    let saveTimeout = null;
    textarea.addEventListener('input', () => {
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(saveNotepad, 500);
    });

    let dragging = false, ox, oy;
    header.addEventListener('mousedown', (e) => {
      if (e.target.id === 'ch-notepad-close') return;
      dragging = true;
      ox = e.clientX - notepadEl.getBoundingClientRect().left;
      oy = e.clientY - notepadEl.getBoundingClientRect().top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      notepadEl.style.left = (e.clientX - ox) + 'px';
      notepadEl.style.top = (e.clientY - oy) + 'px';
      notepadEl.style.right = 'auto';
      notepadEl.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => { if (dragging) { dragging = false; saveNotepad(); } });

    let resizing = false, rw, rh, rx, ry;
    resizeHandle.addEventListener('mousedown', (e) => {
      resizing = true;
      rw = notepadEl.getBoundingClientRect().width;
      rh = notepadEl.getBoundingClientRect().height;
      rx = e.clientX;
      ry = e.clientY;
      e.preventDefault();
      e.stopPropagation();
    });
    document.addEventListener('mousemove', (e) => {
      if (!resizing) return;
      notepadEl.style.width = Math.max(180, rw + (e.clientX - rx)) + 'px';
      notepadEl.style.height = Math.max(120, rh + (e.clientY - ry)) + 'px';
    });
    document.addEventListener('mouseup', () => { if (resizing) { resizing = false; saveNotepad(); } });

    closeBtn.addEventListener('click', () => { notepadEl.style.display = 'none'; });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && notepadEl && notepadEl.style.display !== 'none' && document.activeElement === textarea) {
        notepadEl.style.display = 'none';
      }
    });

    return notepadEl;
  }

  function showNotepad() {
    if (notepadEl) {
      notepadEl.style.display = 'flex';
    } else {
      createNotepad();
    }
  }

  function hideNotepad() {
    if (notepadEl) notepadEl.style.display = 'none';
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'ym-stateUpdate' && IS_CRM_PAGE) {
      if (settings.musicWidgetEnabled !== false) createMusicWidget();
      updateMusicWidget(msg.state);
    }
    if (msg.type === 'lookupClaim' && IS_CRM_PAGE) {
      const claimId = msg.claimId;
      console.log('[CRM Helper] lookupClaim: id=' + claimId + ' (via MAIN world same-origin)');
      const handler = (evt) => {
        const result = evt.detail;
        window.removeEventListener('crm-helper-lookup-result', handler);
        console.log('[CRM Helper] lookupClaim result:', result.error ? 'error=' + result.error : 'success');
        sendResponse(result);
      };
      window.addEventListener('crm-helper-lookup-result', handler);
      window.dispatchEvent(new CustomEvent('crm-helper-lookup-claim', { detail: { claimId } }));
      return true;
    }
  });

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
    if (settings.musicWidgetEnabled !== false) createMusicWidget();
    if (settings.notepadEnabled !== false) createNotepad();
    chrome.runtime.sendMessage({ type: 'ym-getState' }, (resp) => {
      if (resp) updateMusicWidget(resp);
    });
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
