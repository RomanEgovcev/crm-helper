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
      const claimMatch = data.match(/Applecationid:\s*(\d+)/);

      if (uriMatch) {
        const uriNumber = extractDigits(uriMatch[1]);
        const direction = callTypeMatch ? callTypeMatch[1] : null;
        let number = null;
        let dir = null;

        if (direction === 'incoming') {
          number = fromMatch ? extractDigits(fromMatch[1]) : uriNumber;
          dir = 'incoming';
        } else if (direction === 'outgoing' || !direction) {
          number = uriNumber;
          dir = 'outgoing';
        }

        if (number && number.length >= 10) {
          dispatchCaller(number, dir);
        }
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

  console.log('[CRM Helper MAIN] WebSocket interceptor + beforeunload blocker installed');
})();
