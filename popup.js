const FIELDS = [
  'lineTimerEnabled', 'lineTimerThreshold', 'lineAction',
  'dialTimerEnabled', 'dialTimerThreshold',
  'soundType', 'volume',
  'breakEnabled', 'breakWorkMinutes', 'breakRestMinutes',
  'telegramBotToken', 'telegramChatId'
];

function load() {
  chrome.storage.local.get(['settings'], (result) => {
    const s = result.settings || {};
    FIELDS.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = s[id] !== undefined ? s[id] : true;
      else el.value = s[id] !== undefined ? s[id] : el.value;
    });
  });
}

function save() {
  const s = {};
  FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') s[id] = el.checked;
    else if (el.type === 'number') s[id] = Number(el.value);
    else s[id] = el.value;
  });
  chrome.storage.local.set({ settings: s });
}

document.addEventListener('DOMContentLoaded', load);
document.querySelectorAll('input, select').forEach(el => {
  el.addEventListener('change', save);
});
