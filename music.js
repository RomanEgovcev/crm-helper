(() => {
  if (location.hostname !== 'music.yandex.ru' && location.hostname !== 'music.yandex.com') return;

  let lastState = { title: '', artist: '', playing: false };

  function findBtn(keywords) {
    const btns = document.querySelectorAll('button');
    for (const btn of btns) {
      const label = (btn.getAttribute('aria-label') || '').toLowerCase();
      const text = (btn.textContent || '').toLowerCase();
      for (const kw of keywords) {
        if (label.includes(kw) || text.includes(kw)) return btn;
      }
    }
    return null;
  }

  function findPlayBtn() {
    return findBtn(['pause', 'пауза', 'play', 'воспроизвести', 'воспроизведение'])
      || document.querySelector('.player-controls__btn_play');
  }

  function findNextBtn() {
    return findBtn(['next', 'следующ', 'skip']);
  }

  function findPrevBtn() {
    return findBtn(['prev', 'предыдущ', 'back']);
  }

  function getState() {
    const meta = navigator.mediaSession?.metadata;
    const title = meta?.title || '';
    const artist = meta?.artist || '';

    let playing = false;
    const playBtn = findPlayBtn();
    if (playBtn) {
      const label = (playBtn.getAttribute('aria-label') || playBtn.textContent || '').toLowerCase();
      playing = label.includes('pause') || label.includes('пауза');
    } else if (navigator.mediaSession?.playbackState === 'playing') {
      playing = true;
    }

    return { title, artist, playing };
  }

  let debugLogged = false;
  function doAction(action) {
    if (!debugLogged) {
      debugLogged = true;
      const allBtns = document.querySelectorAll('button[aria-label]');
      const labels = Array.from(allBtns).map(b => b.getAttribute('aria-label')).filter(Boolean).slice(0, 40);
      console.log('[CRM Helper] Available aria-labels:', labels);
      console.log('[CRM Helper] MediaSession:', navigator.mediaSession?.metadata);
      console.log('[CRM Helper] PlaybackState:', navigator.mediaSession?.playbackState);
    }
    switch (action) {
      case 'playPause': {
        const btn = findPlayBtn();
        if (btn) { btn.click(); console.log('[CRM Helper] Music: clicked play/pause'); }
        else console.log('[CRM Helper] Music: play/pause NOT found');
        break;
      }
      case 'next': {
        const btn = findNextBtn();
        if (btn) { btn.click(); console.log('[CRM Helper] Music: clicked next'); }
        else console.log('[CRM Helper] Music: next NOT found');
        break;
      }
      case 'prev': {
        const btn = findPrevBtn();
        if (btn) { btn.click(); console.log('[CRM Helper] Music: clicked prev'); }
        else console.log('[CRM Helper] Music: prev NOT found');
        break;
      }
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

  setInterval(broadcastState, 2000);
  broadcastState();
  console.log('[CRM Helper] Music script loaded on', location.hostname, '- buttons ready');
})();
