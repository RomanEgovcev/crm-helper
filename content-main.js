(() => {
  const _origAddEventListener = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function(type, handler, opts) {
    if (this === window && type === 'beforeunload') return;
    return _origAddEventListener.call(this, type, handler, opts);
  };
  window.onbeforeunload = null;
  Object.defineProperty(window, 'onbeforeunload', {
    set: () => {},
    get: () => null,
    configurable: true
  });

  let _lastNumber = null;
  let _lastDirection = null;
  let _lastDispatch = 0;
  const DEBOUNCE_MS = 60000;

  function extractDigits(str) {
    const match = str.match(/(\d{7,})/);
    return match ? match[1] : null;
  }

  function dispatchCaller(number, direction) {
    const now = Date.now();
    if (number === _lastNumber && now - _lastDispatch < DEBOUNCE_MS) return;
    _lastNumber = number;
    _lastDirection = direction;
    _lastDispatch = now;
    window.dispatchEvent(new CustomEvent('crm-helper-caller', {
      detail: { number, direction }
    }));
  }

  function processSipMessage(data) {
    if (typeof data !== 'string') return;

    if (data.startsWith('INVITE sip:')) {
      const fromMatch = data.match(/From:\s*<sip:(\d+)@/);
      const toMatch = data.match(/To:\s*<sip:(\d+)@/);
      const uriMatch = data.match(/INVITE sip:(\d+)@/);
      const callTypeMatch = data.match(/call-type:\s*(\w+)/);

      const uriNumber = uriMatch ? extractDigits(uriMatch[1]) : null;
      const fromNumber = fromMatch ? extractDigits(fromMatch[1]) : null;
      const toNumber = toMatch ? extractDigits(toMatch[1]) : null;

      const direction = callTypeMatch ? callTypeMatch[1] : null;

      let number = null;
      let dir = null;

      if (direction === 'incoming') {
        number = fromNumber || toNumber || uriNumber;
        dir = 'incoming';
      } else if (direction === 'outgoing' || !direction) {
        number = uriNumber || fromNumber || toNumber;
        dir = 'outgoing';
      }

      if (number && number.length >= 10) {
        dispatchCaller(number, dir);
      }
    }

    if (data.startsWith('BYE sip:')) {
      window.dispatchEvent(new CustomEvent('crm-helper-bye'));
    }
  }

  const _origWebSocket = window.WebSocket;
  window.WebSocket = function(...args) {
    const ws = new _origWebSocket(...args);
    const _origSend = ws.send.bind(ws);
    ws.send = function(data) {
      try {
        if (typeof data === 'string' || data instanceof ArrayBuffer) {
          let str = data;
          if (data instanceof ArrayBuffer) str = new TextDecoder().decode(data);
          processSipMessage(str);
        }
      } catch (e) {}
      return _origSend(data);
    };
    ws.addEventListener('message', (evt) => {
      try {
        let str = evt.data;
        if (str instanceof ArrayBuffer) str = new TextDecoder().decode(str);
        processSipMessage(str);
      } catch (e) {}
    });
    return ws;
  };
  window.WebSocket.prototype = _origWebSocket.prototype;
  window.WebSocket.CONNECTING = _origWebSocket.CONNECTING;
  window.WebSocket.OPEN = _origWebSocket.OPEN;
  window.WebSocket.CLOSING = _origWebSocket.CLOSING;
  window.WebSocket.CLOSED = _origWebSocket.CLOSED;

  const _origFetch = window.fetch;

  function extractToken() {
    try {
      const raw = sessionStorage.getItem('auth');
      if (raw) {
        const parsed = JSON.parse(raw);
        const t = parsed.state?.token || parsed.token || null;
        if (t && t.includes('.')) return { token: t, type: 'jwt' };
        if (t) return { token: t, type: 'uuid' };
      }
    } catch (e) {}
    return null;
  }

  window.addEventListener('crm-helper-lookup-claim', async (evt) => {
    const claimId = evt.detail.claimId;
    const t = extractToken();
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (t?.token) headers['Authorization'] = 'Bearer ' + t.token;
    const paths = [
      `/v1/answers/id/${claimId}`,
      `/crm/v1/answers/id/${claimId}`
    ];
    try {
      for (const path of paths) {
        try {
          const r = await _origFetch(path, { headers, credentials: 'include' });
          const ct = r.headers.get('content-type') || '';
          console.log('[CRM Helper MAIN] lookupClaim: ' + path + ' → ' + r.status + ' ct=' + ct);
          if (r.ok && ct.includes('json')) {
            const data = await r.json();
            console.log('[CRM Helper MAIN] lookupClaim SUCCESS:', Object.keys(data).join(','));
            return window.dispatchEvent(new CustomEvent('crm-helper-lookup-result', { detail: { data, claimId } }));
          }
        } catch (e) { console.log('[CRM Helper MAIN] lookupClaim: ' + path + ' → ERR: ' + e.message); }
      }
      window.dispatchEvent(new CustomEvent('crm-helper-lookup-result', { detail: { error: 'All same-origin endpoints failed', claimId } }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent('crm-helper-lookup-result', { detail: { error: e.message, claimId } }));
    }
  });

  const _token = extractToken();
  if (_token) {
    window.postMessage({ type: 'crm-helper-token', token: _token.token }, '*');
  }

  const _origSetItem = sessionStorage.setItem;
  sessionStorage.setItem = function(key, value) {
    _origSetItem.call(this, key, value);
    if (key === 'auth') {
      const t = extractToken();
      if (t) window.postMessage({ type: 'crm-helper-token', token: t.token }, '*');
    }
  };

  console.log('[CRM Helper MAIN] WebSocket interceptor + beforeunload blocker installed');
})();
