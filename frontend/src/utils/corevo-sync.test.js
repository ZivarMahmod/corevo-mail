import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startCorevoSync } from './corevo-sync.js';
test('one provider sync, hidden/offline pause and no update after disposal', async () => {
  const doc = new EventTarget(), win = new EventTarget(), nav = { onLine: true };
  doc.visibilityState = 'visible';
  let calls = 0, applied = 0, release;
  const stop = startCorevoSync({ document: doc, window: win, navigator: nav, interval: 100000,
    run: () => { calls++; return new Promise(resolve => { release = resolve; }); }, apply: () => applied++ });
  doc.dispatchEvent(new Event('visibilitychange')); win.dispatchEvent(new Event('online'));
  assert.equal(calls, 1);
  release({ current: true }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(applied, 1);
  doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange')); assert.equal(calls, 1);
  doc.visibilityState = 'visible'; nav.onLine = false; win.dispatchEvent(new Event('online')); assert.equal(calls, 1);
  nav.onLine = true; win.dispatchEvent(new Event('online')); assert.equal(calls, 2);
  stop(); release({ current: true }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(applied, 1); win.dispatchEvent(new Event('online')); assert.equal(calls, 2);
});
