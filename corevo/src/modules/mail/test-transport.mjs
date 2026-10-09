// Synthetic U2 transport, scoped to one mount. No network, storage or provider writes.
export function createMailTestTransport() {
  const accounts = [
    { id: 'corevo-test-1', email: 'konsult@example.test', name: 'Testbrevlåda', provider: 'imap', status: 'connected', sync_status: 'idle', categorization_enabled: false, include_in_unified_inbox: true },
    { id: 'corevo-test-2', email: 'team@example.test', name: 'Testkonto 2', provider: 'gmail', status: 'connected', sync_status: 'idle', categorization_enabled: false, include_in_unified_inbox: true },
  ];
  const folders = ['INBOX', 'Sent', 'Drafts', 'Archive', 'Trash', 'Junk', 'Kunder'].map((path, index) => ({ path, name: path, delimiter: '/', special_use: ['', '\\Sent', '\\Drafts', '\\Archive', '\\Trash', '\\Junk', ''][index], specialUse: ['', '\\Sent', '\\Drafts', '\\Archive', '\\Trash', '\\Junk', ''][index], unread: path === 'INBOX' ? 1 : 0, total: path === 'INBOX' ? 2 : 0 }));
  accounts.forEach(a => { a.enabled = true; a.email_address = a.email; });
  folders.forEach(f => { f.unread_count = f.unread; f.total_count = f.total; f.counts_known = true; f.server_counts_at = new Date().toISOString(); });
  let messages = [
    { id: 'corevo-message-1', account_id: accounts[0].id, uid: 1, folder: 'INBOX', message_id: '<test-1@example.test>', thread_id: 'corevo-thread-1', from_name: 'Anna Exempel', from_address: 'anna@example.test', from_email: 'anna@example.test', to_addresses: [{ address: accounts[0].email, name: 'Testkonsult' }], subject: 'Testdata: underlag för september', snippet: 'Här finns ett syntetiskt underlag för att prova den införlivade klienten.', date: '2026-10-09T08:30:00Z', is_read: false, is_starred: false, has_attachments: false },
    { id: 'corevo-message-2', account_id: accounts[0].id, uid: 2, folder: 'INBOX', message_id: '<test-2@example.test>', thread_id: 'corevo-thread-2', from_name: 'Erik Exempel', from_address: 'erik@example.test', from_email: 'erik@example.test', to_addresses: [{ address: accounts[0].email }], subject: 'Testdata: avstämning och återkoppling', snippet: 'Prova att läsa, svara och öppna skrivfönstret.', date: '2026-10-09T07:45:00Z', is_read: true, is_starred: true, has_attachments: false },
    { id: 'corevo-message-3', account_id: accounts[0].id, uid: 3, folder: 'Kunder', message_id: '<test-3@example.test>', thread_id: 'corevo-thread-3', from_name: 'Testkund', from_address: 'kund@example.test', from_email: 'kund@example.test', to_addresses: [{ address: accounts[0].email }], subject: 'Testdata: egen mapp', snippet: 'Denna syntetiska konversation ligger i mappen Kunder.', date: '2026-10-08T15:00:00Z', is_read: true, is_starred: false, has_attachments: false },
  ];
  messages[0].has_attachments = true;
  messages.forEach(m => m.to_addresses.forEach(a => { a.email = a.address; }));
  const attachment = { filename: 'corevo-test.txt', contentType: 'text/plain', content_type: 'text/plain', part: '1.2', size: 38 };
  const image = { filename: 'corevo-test.png', contentType: 'image/png', content_type: 'image/png', part: '1.3', size: 68 };
  const prefs = { theme: 'dark', layout: 'default', fontSet: 'default', fontSize: 100, markReadBehavior: 'manual', senderFavicons: false, conversationMode: 'individual', enabledPlugins: [], syncInterval: 60, autoLockMinutes: 0 };
  let disposed = false;
  function response(body, status = 200) { return { status, body: structuredClone(body) }; }
  function request(path, method = 'GET', rawBody = null) {
    if (disposed) return response({ error: 'Mejlytan är stängd.' }, 410);
    if (typeof path !== 'string' || path.length > 4096 || !path.startsWith('/api/') || typeof rawBody === 'string' && rawBody.length > 100000) return response({ error: 'Anropet ingår inte i testläget.' }, 400);
    const url = new URL(path, 'https://corevo.test');
    let body;
    try { body = rawBody ? JSON.parse(rawBody) : {}; } catch { return response({ error: 'Ogiltigt anrop.' }, 400); }
    const route = url.pathname.slice(4);
    if (method === 'GET' && route === '/mail/messages/corevo-message-1/attachments/1.2') return { status: 200, bytes: Array.from(new TextEncoder().encode('Corevo Mail: syntetisk testbilaga.\n')), contentType: 'text/plain' };
    if (method === 'GET' && route === '/mail/messages/corevo-message-1/attachments/1.3') return { status: 200, bytes: Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),c => c.charCodeAt(0)), contentType: 'image/png' };
    if (/^\/mail\/send(?:\/|$)/.test(route) || /\/oauth|\/auth\/(login|register|logout|unlock)|\/accounts$/.test(route) && method !== 'GET') return response({ error: 'Testdata – ingen riktig brevlåda ansluten. Sändning och kontoanslutning är inte aktiverade i detta delmål.' }, 409);
    if (method === 'GET' && route === '/accounts') return response(accounts);
    if (method === 'GET' && /^\/accounts\/[^/]+\/folders$/.test(route)) {
      const accountId = route.split('/')[2];
      return response(folders.map(f => {
        const rows = messages.filter(m => m.account_id === accountId && m.folder === f.path);
        return { ...f, total_count: rows.length, unread_count: rows.filter(m => !m.is_read).length };
      }));
    }
    if (method === 'GET' && /\/aliases$/.test(route)) return response([]);
    if (route === '/auth/preferences') { if (method !== 'GET') Object.assign(prefs, body); return response(prefs); }
    if (route === '/mail/unread-counts') return response({ total: messages.filter(m => !m.is_read).length, byAccount: Object.fromEntries(accounts.map(a => [a.id, messages.filter(m => m.account_id === a.id && !m.is_read).length])), snapshots: Object.fromEntries(accounts.map(a => [a.id, {known:true,stale:false,observedAt:new Date().toISOString(),revision:'1'}])), complete: true });
    if (method === 'GET' && (route === '/mail/messages' || route === '/search')) {
      const account = url.searchParams.get('accountId');
      const folder = url.searchParams.get('folder') || 'INBOX';
      const query = (url.searchParams.get('q') || '').toLowerCase();
      const found = messages.filter(m => (!account || account === 'all' || m.account_id === account) && (route === '/search' || m.folder === folder) && (m.subject + ' ' + m.snippet).toLowerCase().includes(query));
      return response({ messages: found, total: found.length });
    }
    if (route === '/mail/thread') return response(messages.filter(m => m.thread_id === url.searchParams.get('id')));
    const messageMatch = route.match(/^\/mail\/messages\/([^/]+)(?:\/(body|bcc|headers|reply-draft))?$/);
    if (method === 'GET' && messageMatch) {
      const message = messages.find(m => m.id === messageMatch[1]);
      if (!message) return response({ error: 'Testmeddelandet saknas.' }, 404);
      if (messageMatch[2] === 'reply-draft') return response({ error: 'Inget testutkast.' }, 404);
      if (messageMatch[2] === 'bcc') return response({ bcc: [] });
      if (messageMatch[2] === 'headers') return response({ headers: 'X-Corevo-Testdata: true' });
      if (messageMatch[2] === 'body') return response({ html: message.html || '<p>Hej!</p><p>' + message.snippet + '</p><p><strong>Testdata – ingen riktig brevlåda ansluten.</strong></p>', text: message.text || message.snippet, attachments: message.id === 'corevo-message-1' ? [attachment,image] : [], hasBlockedRemoteImages: false });
      return response(message);
    }
    if (route === '/mail/reply-drafts/indicators') return response({ indicators: {} });
    if (route === '/mail/draft' && method === 'POST') {
      const uid = body.existingUid || 100 + messages.length;
      const id = 'corevo-draft-' + uid;
      messages = messages.filter(m => m.id !== id);
      messages.push({ id, uid, account_id: body.accountId || accounts[0].id, folder: 'Drafts', is_draft:true, from_name:'Testkonsult', from_email:accounts[0].email, to_addresses:(body.to || []).map(email => ({email})), cc_addresses:(body.cc || []).map(email => ({email})), subject: body.subject || 'Testutkast', html: body.bodyIsHtml ? body.body : null, text: body.bodyIsHtml ? null : body.body, snippet: 'Tillfälligt testutkast', date: new Date().toISOString(), is_read: true, has_attachments: false });
      return response({ uid, folder: 'Drafts', messageId: id });
    }
    if (/^\/mail\/draft\//.test(route) && method === 'DELETE') {
      const uid = Number(route.split('/').pop());
      messages = messages.filter(m => m.folder !== 'Drafts' || m.uid !== uid);
      return response({ ok: true });
    }
    if (['/mail/sync', '/mail/sync-folder', '/mail/sync-folders'].includes(route)) return response({ ok: true, testData: true });
    if (route === '/mail/messages/bulk-read') { messages.forEach(m => { if (body.ids?.includes(m.id)) m.is_read = body.read; }); return response({ ok: true }); }
    if (/\/read$/.test(route) && method === 'PATCH') { const m = messages.find(m => route.includes(m.id)); if (m) m.is_read = body.read; return response({ ok: true }); }
    if (method === 'GET' && ['/todoist/status', '/ai/status', '/integrations/status'].includes(route)) return response({ connected: false, enabled: false });
    if (method === 'GET' && ['/contacts', '/search/contacts'].includes(route)) return response(route === '/contacts' ? { contacts: [], total: 0 } : []);
    if (method === 'GET' && ['/rules', '/block-list', '/integrations', '/plugins'].includes(route)) return response([]);
    if (method === 'GET' && ['/version', '/update'].includes(route)) return response({ version: 'Corevo Mail', available: false, enabled: false });
    if (/category-counts/.test(route)) return response({});
    return response({ error: 'Denna funktion har ännu ingen Corevo-koppling. Testdata skickas aldrig till en leverantör.' }, 501);
  }
  return { request, dispose() { disposed = true; messages = []; accounts.length = 0; folders.length = 0; } };
}
