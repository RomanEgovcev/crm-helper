const BREAK_ALARM_NAME = 'crm-helper-break-phase';

let lastMusicState = { title: '', artist: '', playing: false };

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try {
    if (msg.type === 'lookupPhone') {
      const digits = msg.digits;
      fetch(`https://num.voxlink.ru/get/?num=${digits}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (!d || !d.operator) return sendResponse(null);
          let location = d.region || '';
          if (d.old_operator) location += ` (was: ${d.old_operator})`;
          sendResponse({ carrier: d.operator, location, country: 'RU' });
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

    if (msg.type === 'ym-stateChanged') {
      lastMusicState = msg.state;
      chrome.tabs.query({}, (tabs) => {
        try {
          for (const tab of tabs) {
            if (tab.url && (tab.url.includes('victory-crm.ru') || tab.url.includes('ect-russia.ru'))) {
              chrome.tabs.sendMessage(tab.id, { type: 'ym-stateUpdate', state: msg.state }).catch(() => {});
            }
          }
        } catch (e) {}
      });
      sendResponse(true);
      return false;
    }

    if (msg.type === 'ym-getState') {
      findYandexMusicTab((tab) => {
        try {
          if (tab) {
            chrome.tabs.sendMessage(tab.id, { type: 'ym-getState' }, (resp) => {
              if (chrome.runtime.lastError || !resp) sendResponse(lastMusicState);
              else { lastMusicState = resp; sendResponse(resp); }
            });
          } else {
            sendResponse(lastMusicState);
          }
        } catch (e) { sendResponse(lastMusicState); }
      });
      return true;
    }

    if (msg.type === 'ym-action') {
      findYandexMusicTab((tab) => {
        try {
          if (tab) {
            chrome.tabs.sendMessage(tab.id, { type: 'ym-action', action: msg.action }, (resp) => {
              if (chrome.runtime.lastError || !resp) { sendResponse(null); return; }
              lastMusicState = resp;
              chrome.tabs.query({}, (tabs) => {
                try {
                  for (const t of tabs) {
                    if (t.url && (t.url.includes('victory-crm.ru') || t.url.includes('ect-russia.ru'))) {
                      chrome.tabs.sendMessage(t.id, { type: 'ym-stateUpdate', state: resp }).catch(() => {});
                    }
                  }
                } catch (e) {}
              });
              sendResponse(resp);
            });
          } else {
            sendResponse(null);
          }
        } catch (e) { sendResponse(null); }
      });
      return true;
    }
  } catch (e) {
    console.error('[BG] onMessage error:', e);
    try { sendResponse(null); } catch (e2) {}
    return false;
  }
});

function findYandexMusicTab(callback) {
  try {
    chrome.tabs.query({ url: ['*://music.yandex.ru/*', '*://music.yandex.com/*'] }, (tabs) => {
      try { callback(tabs && tabs.length > 0 ? tabs[0] : null); }
      catch (e) { callback(null); }
    });
  } catch (e) { callback(null); }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BREAK_ALARM_NAME) {
    console.log('[BG] Break alarm fired');
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, { type: 'breakAlarmFired' }).catch(() => {});
      }
    });
  }
});
