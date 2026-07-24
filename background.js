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
});
