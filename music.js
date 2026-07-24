(() => {
  if (location.hostname !== 'music.yandex.ru' && location.hostname !== 'music.yandex.com') return;

  function findAudio() {
    let audio = document.querySelector('audio');
    if (audio) return audio;
    const audios = document.querySelectorAll('audio');
    if (audios.length > 0) return audios[0];
    const shadows = document.querySelectorAll('*');
    for (const el of shadows) {
      if (el.shadowRoot) {
        audio = el.shadowRoot.querySelector('audio');
        if (audio) return audio;
      }
    }
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        audio = iframe.contentDocument?.querySelector('audio');
        if (audio) return audio;
      } catch(e) {}
    }
    return null;
  }

  let lastState = { title: '', artist: '', playing: false };

  function simulateClick(btn) {
    const rect = btn.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
    btn.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 1, pointerType: 'mouse' }));
    btn.dispatchEvent(new MouseEvent('mousedown', opts));
    btn.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerId: 1, pointerType: 'mouse' }));
    btn.dispatchEvent(new MouseEvent('mouseup', opts));
    btn.dispatchEvent(new MouseEvent('click', opts));
  }

  function findByLabel(keywords) {
    const btns = document.querySelectorAll('button[aria-label]');
    for (const btn of btns) {
      const label = (btn.getAttribute('aria-label') || '').toLowerCase();
      for (const kw of keywords) {
        if (label.includes(kw)) return btn;
      }
    }
    return null;
  }

  function findPlayBtn() {
    const playerRoot = document.querySelector('[class*="VibePlayerControls_root"]');
    const scope = playerRoot || document;
    const btns = scope.querySelectorAll('button[aria-label]');
    for (const btn of btns) {
      const label = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (label.includes('пауза') || label.includes('pause') || label.includes('воспроизвед') || label.includes('play')) {
        const r = btn.getBoundingClientRect();
        console.log('[CRM Helper] Found play btn:', btn.getAttribute('aria-label'), 'rect:', Math.round(r.x), Math.round(r.y), Math.round(r.width), 'x', Math.round(r.height), 'tag:', btn.tagName, 'parent:', btn.parentElement?.className?.slice(0, 60));
        return btn;
      }
    }
    return null;
  }

  function findNextBtn() {
    return findByLabel(['следующ', 'next', 'skip']);
  }

  function findPrevBtn() {
    return findByLabel(['предыдущ', 'prev', 'back']);
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
        if (btn) {
          const label = (btn.getAttribute('aria-label') || '').toLowerCase();
          const audio = findAudio();
          if (audio) {
            if (audio.paused) { audio.play().catch(()=>{}); console.log('[CRM Helper] Audio.play() called'); }
            else { audio.pause(); console.log('[CRM Helper] Audio.pause() called'); }
          } else {
            simulateClick(btn);
            console.log('[CRM Helper] Music: clicked play/pause via DOM');
          }
        } else {
          console.log('[CRM Helper] Music: play/pause NOT found');
          const audio = findAudio();
          if (audio) {
            if (audio.paused) audio.play().catch(()=>{});
            else audio.pause();
            console.log('[CRM Helper] Audio fallback (no button found)');
          }
        }
        break;
      }
      case 'next': {
        const btn = findNextBtn();
        if (btn) { simulateClick(btn); console.log('[CRM Helper] Music: clicked next'); }
        else console.log('[CRM Helper] Music: next NOT found');
        break;
      }
      case 'prev': {
        const btn = findPrevBtn();
        if (btn) { simulateClick(btn); console.log('[CRM Helper] Music: clicked prev'); }
        else console.log('[CRM Helper] Music: prev NOT found');
        break;
      }
      case 'volumeDown': {
        const audio = findAudio();
        if (audio) {
          audio.volume = Math.max(0, audio.volume - 0.1);
          console.log('[CRM Helper] Volume down:', Math.round(audio.volume * 100) + '%');
        } else {
          const volBtn = findByLabel(['тишин', 'mute', 'выключить звук', 'без звука']);
          if (volBtn) {
            const slider = volBtn.closest('[class*="volume"]')?.querySelector('input[type="range"]') || volBtn.parentElement?.querySelector('input[type="range"]');
            if (slider) {
              const step = parseFloat(slider.step) || 0.1;
              slider.value = Math.max(0, parseFloat(slider.value) - step);
              slider.dispatchEvent(new Event('input', { bubbles: true }));
              slider.dispatchEvent(new Event('change', { bubbles: true }));
              console.log('[CRM Helper] Volume down via slider:', slider.value);
            } else {
              simulateClick(volBtn);
              console.log('[CRM Helper] Volume down: clicked mute/toggle button');
            }
          } else {
            const allInputs = document.querySelectorAll('input[type="range"]');
            for (const inp of allInputs) {
              const r = inp.getBoundingClientRect();
              if (r.width > 0) {
                const step = parseFloat(inp.step) || 0.1;
                inp.value = Math.max(0, parseFloat(inp.value) - step);
                inp.dispatchEvent(new Event('input', { bubbles: true }));
                inp.dispatchEvent(new Event('change', { bubbles: true }));
                console.log('[CRM Helper] Volume down via range input:', inp.value);
                break;
              }
            }
            console.log('[CRM Helper] Volume: no audio, no mute btn, no slider found');
          }
        }
        break;
      }
      case 'volumeUp': {
        const audio = findAudio();
        if (audio) {
          audio.volume = Math.min(1, audio.volume + 0.1);
          console.log('[CRM Helper] Volume up:', Math.round(audio.volume * 100) + '%');
        } else {
          const volBtn = findByLabel(['тишин', 'mute', 'выключить звук', 'без звука']);
          if (volBtn) {
            const slider = volBtn.closest('[class*="volume"]')?.querySelector('input[type="range"]') || volBtn.parentElement?.querySelector('input[type="range"]');
            if (slider) {
              const step = parseFloat(slider.step) || 0.1;
              slider.value = Math.min(1, parseFloat(slider.value) + step);
              slider.dispatchEvent(new Event('input', { bubbles: true }));
              slider.dispatchEvent(new Event('change', { bubbles: true }));
              console.log('[CRM Helper] Volume up via slider:', slider.value);
            } else {
              simulateClick(volBtn);
              console.log('[CRM Helper] Volume up: clicked mute/toggle button');
            }
          } else {
            const allInputs = document.querySelectorAll('input[type="range"]');
            for (const inp of allInputs) {
              const r = inp.getBoundingClientRect();
              if (r.width > 0) {
                const step = parseFloat(inp.step) || 0.1;
                inp.value = Math.min(1, parseFloat(inp.value) + step);
                inp.dispatchEvent(new Event('input', { bubbles: true }));
                inp.dispatchEvent(new Event('change', { bubbles: true }));
                console.log('[CRM Helper] Volume up via range input:', inp.value);
                break;
              }
            }
            console.log('[CRM Helper] Volume: no audio, no mute btn, no slider found');
          }
        }
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
