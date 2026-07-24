const BREAK_ALARM_NAME = 'crm-helper-break-phase';

let lastMusicState = { title: '', artist: '', playing: false };

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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
      if (msg.when && msg.when > Date.now()) {
        chrome.alarms.create(BREAK_ALARM_NAME, { when: msg.when });
        console.log(`[BG] Break alarm set for ${Math.round((msg.when - Date.now()) / 1000)}s`);
      }
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
      for (const tab of tabs) {
        if (tab.url && (tab.url.includes('victory-crm.ru') || tab.url.includes('ect-russia.ru'))) {
          chrome.tabs.sendMessage(tab.id, { type: 'ym-stateUpdate', state: msg.state }).catch(() => {});
        }
      }
    });
    sendResponse(true);
    return false;
  }

  if (msg.type === 'ym-getState') {
    findYandexMusicTab((tab) => {
      if (tab) {
        chrome.tabs.sendMessage(tab.id, { type: 'ym-getState' }, (resp) => {
          if (resp) {
            lastMusicState = resp;
            sendResponse(resp);
          } else {
            sendResponse(lastMusicState);
          }
        });
      } else {
        sendResponse(lastMusicState);
      }
    });
    return true;
  }

  if (msg.type === 'ym-action') {
    findYandexMusicTab((tab) => {
      if (tab) {
        chrome.tabs.sendMessage(tab.id, { type: 'ym-action', action: msg.action }, (resp) => {
          if (resp) {
            lastMusicState = resp;
            chrome.tabs.query({}, (tabs) => {
              for (const t of tabs) {
                if (t.url && (t.url.includes('victory-crm.ru') || t.url.includes('ect-russia.ru'))) {
                  chrome.tabs.sendMessage(t.id, { type: 'ym-stateUpdate', state: resp }).catch(() => {});
                }
              }
            });
            sendResponse(resp);
          } else {
            sendResponse(null);
          }
        });
      } else {
        sendResponse(null);
      }
    });
    return true;
  }
});

function findYandexMusicTab(callback) {
  chrome.tabs.query({ url: ['*://music.yandex.ru/*', '*://music.yandex.com/*'] }, (tabs) => {
    callback(tabs && tabs.length > 0 ? tabs[0] : null);
  });
}

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
