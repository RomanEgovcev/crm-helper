const BREAK_ALARM_NAME = 'crm-helper-break-phase';

/* --- Yandex Music (disabled, use "Yandex Music Control" extension) ---
let lastMusicState = { title: '', artist: '', playing: false };

if (msg.type === 'ym-stateChanged') { ... }
if (msg.type === 'ym-getState') { ... }
if (msg.type === 'ym-action') { ... }
function findYandexMusicTab(callback) { ... }
--- end Yandex Music --- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try {
    if (msg.type === 'lookupPhone') {
      const digits = msg.digits;
      fetch(`https://num.voxlink.ru/get/?num=${digits}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (!d || !d.operator) return sendResponse(null);
          let location = d.region || '';
          if (d.old_operator) location += ` (был: ${d.old_operator})`;
          sendResponse({ carrier: d.operator, location, country: 'Россия' });
        })
        .catch(() => sendResponse(null));
      return true;
    }

    if (msg.type === 'setBreakAlarm') {
      chrome.alarms.clear(BREAK_ALARM_NAME, () => {
        try {
          if (msg.when && msg.when > Date.now()) {
            chrome.alarms.create(BREAK_ALARM_NAME, { when: msg.when });
            console.log(`[BG] Break alarm set for ${Math.round((msg.when - Date.now()) / 1000)}s`);
          }
        } catch (e) { console.error('[BG] setBreakAlarm error:', e); }
      });
      sendResponse(true);
      return false;
    }

    if (msg.type === 'clearBreakAlarm') {
      chrome.alarms.clear(BREAK_ALARM_NAME);
      sendResponse(true);
      return false;
    }
  } catch (e) {
    console.error('[BG] onMessage error:', e);
    try { sendResponse(null); } catch (e2) {}
    return false;
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BREAK_ALARM_NAME) {
    console.log('[BG] Break alarm fired, notifying content script');
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, { type: 'breakAlarmFired' }).catch(() => {});
      }
    });
  }
});
