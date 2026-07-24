(() => {
  if (location.hostname !== 'music.yandex.ru' && location.hostname !== 'music.yandex.com') return;

  let stateInterval = null;
  let lastState = { title: '', artist: '', playing: false };

  function getState() {
    const meta = navigator.mediaSession?.metadata;
    const title = meta?.title || '';
    const artist = meta?.artist || '';

    let playing = false;
    const playBtn =
      document.querySelector('.player-controls__btn_play') ||
      document.querySelector('div[class*="SonataControlsDesktop_sonataButtons"] button[aria-label="\u0412\u043e\u0441\u043f\u0440\u043e\u0438\u0437\u0432\u0435\u0434\u0435\u043d\u0438\u0435"]') ||
      document.querySelector('div[class*="SonataControlsDesktop_sonataButtons"] button[aria-label="Playback"]') ||
      document.querySelector('div[class*="SonataControlsDesktop_sonataButtons"] button[aria-label="\u041f\u0430\u0443\u0437\u0430"]') ||
      document.querySelector('div[class*="SonataControlsDesktop_sonataButtons"] button[aria-label="Pause"]');
    if (playBtn) {
      const label = playBtn.getAttribute('aria-label') || playBtn.textContent || '';
      playing = /\u041f\u0430\u0443\u0437\u0430|Pause/i.test(label);
    } else if (navigator.mediaSession?.playbackState === 'playing') {
      playing = true;
    }

    return { title, artist, playing };
  }

  function clickBtn(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) { el.click(); return true; }
    }
    return false;
  }

  function doAction(action) {
    switch (action) {
      case 'playPause':
        clickBtn([
          '.player-controls__btn_play',
          'div[class*="SonataControlsDesktop_sonataButtons"] button[aria-label*="\u0412\u043e\u0441\u043f\u0440\u043e\u0438\u0437\u0432\u0435\u0434"]',
          'div[class*="SonataControlsDesktop_sonataButtons"] button[aria-label*="Playback"]',
          'div[class*="SonataControlsDesktop_sonataButtons"] button[aria-label*="\u041f\u0430\u0443\u0437\u0430"]',
          'div[class*="SonataControlsDesktop_sonataButtons"] button[aria-label*="Pause"]'
        ]);
        break;
      case 'next':
        clickBtn([
          '.d-icon_track-next',
          'div[class*="SonataControlsDesktop_sonataButtons"] button[aria-label*="\u0421\u043b\u0435\u0434\u0443\u044e\u0449"]',
          'div[class*="SonataControlsDesktop_sonataButtons"] button[aria-label*="Next"]'
        ]);
        break;
      case 'prev':
        clickBtn([
          '.d-icon_track-prev',
          'div[class*="SonataControlsDesktop_sonataButtons"] button[aria-label*="\u041f\u0440\u0435\u0434\u044b\u0434\u0443\u0449"]',
          'div[class*="SonataControlsDesktop_sonataButtons"] button[aria-label*="Prev"]'
        ]);
        break;
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'ym-getState') {
      sendResponse(getState());
      return true;
    }
    if (msg.type === 'ym-action') {
      doAction(msg.action);
      setTimeout(() => sendResponse(getState()), 300);
      return true;
    }
  });

  function broadcastState() {
    const s = getState();
    if (s.title !== lastState.title || s.artist !== lastState.artist || s.playing !== lastState.playing) {
      lastState = { ...s };
      chrome.runtime.sendMessage({ type: 'ym-stateChanged', state: s }).catch(() => {});
    }
  }

  stateInterval = setInterval(broadcastState, 2000);
  broadcastState();
  console.log('[CRM Helper] Music script loaded on', location.hostname, '- buttons ready');
})();
