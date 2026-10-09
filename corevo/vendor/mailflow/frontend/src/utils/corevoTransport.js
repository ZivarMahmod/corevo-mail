// Corevo host boundary; no upstream cookie, endpoint or global fetch replacement.
let channel;
let sequence = 0;
const pending = new Map();

export function corevoNavigationUrl(url) {
  return window.corevoMailHosted ? location.pathname + location.search + location.hash : url;
}

export function connectCorevoHost() {
  const nonce = location.hash.slice(1);
  if (parent === window || !/^[a-f0-9-]{36}$/.test(nonce)) return Promise.reject(new Error('Öppna Mejl i Corevo.'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { removeEventListener('message', receive); reject(new Error('Corevo-sessionen kunde inte bekräftas.')); }, 15000);
    function receive(event) {
      if (event.source !== parent || event.origin !== location.origin || event.data?.channel !== nonce) return;
      const message = event.data;
      if (message.type === 'bootstrap') {
        clearTimeout(timer);
        channel = nonce;
        resolve(message.context);
      } else if (message.type === 'response') {
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        request.cleanup();
        try {
          request.resolve(new Response(message.bytes ? new Uint8Array(message.bytes) : message.body === null ? null : JSON.stringify(message.body), {
            status: message.status, headers: { 'content-type': message.contentType || 'application/json' },
          }));
        } catch { request.reject(new Error('Ogiltigt svar från mejltjänsten.')); }
      }
    }
    addEventListener('message', receive);
    addEventListener('pagehide', () => {
      channel = undefined;
      clearTimeout(timer);
      removeEventListener('message', receive);
      for (const request of pending.values()) { request.cleanup(); request.reject(new Error('Mejlytan är stängd.')); }
      pending.clear();
    }, { once: true });
    parent.postMessage({ channel: nonce, type: 'ready' }, location.origin);
  });
}

export function corevoFetch(path, options = {}) {
  if (!channel) return Promise.reject(new Error('Corevo-session saknas.'));
  if (typeof path !== 'string' || !/^\/(api|oauth)\//.test(path) || path.length > 4096) return Promise.reject(new Error('Ogiltigt mejlanrop.'));
  if (options.signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); };
    const abort = () => { pending.delete(id); cleanup(); reject(new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { pending.delete(id); cleanup(); reject(new Error('Mejlanropet tog för lång tid.')); }, 15000);
    pending.set(id, { resolve, reject, cleanup });
    options.signal?.addEventListener('abort', abort, { once: true });
    parent.postMessage({ channel, type: 'request', id, path: String(path), method: options.method || 'GET', body: typeof options.body === 'string' ? options.body : null }, location.origin);
  });
}
