// Test-only Corevo boundary: original MailFlow fetch mocks still exercise the adapted API.
import { connectCorevoHost } from '../../../vendor/mailflow/frontend/src/utils/corevoTransport.js';

const listeners = new Set(), originalFetch = globalThis.fetch;
globalThis.window ||= {};
globalThis.location ||= { origin: 'https://corevo.test', hash: '#00000000-0000-4000-8000-000000000001' };
globalThis.addEventListener = (type, listener) => { if (type === 'message') listeners.add(listener); };
globalThis.removeEventListener = (type, listener) => { if (type === 'message') listeners.delete(listener); };
function receive(data) {
  for (const listener of listeners) listener({ source: globalThis.parent, origin: location.origin, data });
}
globalThis.parent = {
  async postMessage(message) {
    if (message.type === 'ready') return receive({ ...message, type: 'bootstrap', context: { testData: true } });
    if (message.type !== 'request') return;
    try {
      if (globalThis.fetch === originalFetch) throw new Error('An original fetch mock is required; no network is allowed.');
      const response = await globalThis.fetch(message.path, { method: message.method, body: message.body, credentials: 'include' });
      receive({ ...message, type: 'response', status: response.status || (response.ok ? 200 : 409), body: await response.json() });
    } catch (error) {
      receive({ ...message, type: 'response', status: 409, body: { error: error.message } });
    }
  },
};
await connectCorevoHost();
