// AGPL-3.0: drive the original refresh flow through Corevo's bounded provider sync.
export function startCorevoSync({ run, apply, document: doc = document, navigator: nav = navigator, window: win = window, interval = 60000 }) {
  let stopped = false, timer, busy = false;
  const schedule = () => { clearTimeout(timer); if (!stopped) timer = setTimeout(tick, interval); };
  async function tick() {
    if (stopped || busy) return;
    clearTimeout(timer);
    if (doc.visibilityState !== 'visible' || nav.onLine === false) { schedule(); return; }
    busy = true;
    try {
      const result = await run();
      if (!stopped && doc.visibilityState === 'visible' && result) apply(result);
    } catch { /* A later bounded tick can resume; never retry a user mutation. */ }
    finally { busy = false; schedule(); }
  }
  const resume = () => { void tick(); };
  doc.addEventListener('visibilitychange', resume);
  win.addEventListener('online', resume);
  schedule();
  return () => { stopped = true; clearTimeout(timer); doc.removeEventListener('visibilitychange', resume); win.removeEventListener('online', resume); };
}
