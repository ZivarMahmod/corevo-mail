// AGPL-3.0: public adapter to the host's already-authorized mailbox interface.
const profile = 'personal-mail-readwrite-send';
const errors = {
  reconnect_required: 'Anslut brevlådan igen hos leverantören.',
  account_changed: 'Brevlådans åtkomst har ändrats. Öppna Mejl igen.',
  access_denied: 'Din inloggning har inte åtkomst till brevlådan.',
  not_configured: 'Den här leverantörsanslutningen är inte konfigurerad ännu.',
  operation_indeterminate: 'Utfallet är okänt. Kontrollera anslutningen innan du försöker igen.',
  invalid_request: 'Anropet kunde inte verifieras.',
  aborted: 'Mejlåtgärden avbröts.',
  response_limit: 'Svaret är för stort för den här hämtningen. Begränsa sökningen och försök igen.',
  revision_conflict: 'Meddelandet har ändrats hos leverantören. Hämta det igen innan du fortsätter.',
  operation_unknown: 'Utfallet kunde inte hämtas. Ingen ny leverantörsåtgärd har skickats.',
  provider_rejected: 'Leverantören avvisade ändringen.',
};
const reply = (body, status = 200) => ({ status, body });
const fail = (message, status = 501) => reply({ error: message }, status);

export function createMailboxTransport(call, { secureTransport = false, signal, onGmailBegin } = {}) {
  let disposed = false, deviceAttempt = null, connectingMicrosoft = false, observationRevision = Date.now();
  const accounts = new Map();
  const folderSets = new Map(), folderLoads = new Map(), messages = new Map(), messageKeys = new Map(), threads = new Map(), threadKeys = new Map(), pages = new Map();
  const writes = new Map();
  const roles = { inbox: ['INBOX', '\\Inbox'], drafts: ['Drafts', '\\Drafts'], sentitems: ['Sent', '\\Sent'], archive: ['Archive', '\\Archive'], deleteditems: ['Trash', '\\Trash'], junkemail: ['Junk', '\\Junk'] };
  const reject = code => { throw Object.assign(new Error(), { code }); };
  async function rpc(action, input) {
    if (disposed || signal?.aborted) throw Object.assign(new Error(), { code: 'aborted' });
    const result = await call(action, input, { signal });
    if (disposed || signal?.aborted) throw Object.assign(new Error(), { code: 'aborted' });
    if (result?.error) throw Object.assign(new Error(), { code: result.error.code });
    if (result?.schemaVersion !== 'personal-mailbox-v1' || !result.data) throw new Error('invalid_provider_response');
    return result.data;
  }
  function dto(account) {
    const b = account.binding;
    const id = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify([b.mailboxId, b.generation, b.scopeRevision])))).replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_');
    accounts.set(id, account);
    return {
      id, email_address: account.address || '', email: account.address || '',
      name: account.displayName || account.address || 'Brevlåda',
      provider: { microsoft_graph: 'microsoft', gmail: 'gmail', imap_smtp: 'imap' }[account.provider],
      status: account.status, enabled: account.status === 'connected' && account.capabilities.read,
      include_in_unified_inbox: true, categorization_enabled: false,
      sync_error: account.status === 'connected' ? null : errors.reconnect_required,
      capabilities: { ...account.capabilities },
    };
  }
  async function inventory() {
    const data = await rpc('accounts', {});
    accounts.clear();
    return data.items.map(dto);
  }
  function ref(id) {
    const a = accounts.get(id);
    if (!a) throw Object.assign(new Error(), { code: 'account_changed' });
    const { mailboxId, connectionId, generation, scopeRevision } = a.binding;
    return { mailboxId, connectionId, generation, scopeRevision };
  }
  async function folders(id, refresh = false) {
    ref(id);
    if (folderLoads.has(id)) return folderLoads.get(id);
    if (!refresh && folderSets.has(id)) return folderSets.get(id);
    const observedAt = new Date().toISOString(), revision = String(++observationRevision);
    const load = (async () => {
      const all = new Map(), wellKnown = {}, visited = new Set();
      async function collect(parentFolderId) {
        if (visited.has(parentFolderId)) return;
        visited.add(parentFolderId);
        const seen = new Set();
        let cursor;
        do {
          const page = await rpc('folders', { mailbox: ref(id), ...(parentFolderId ? { parentFolderId } : {}), ...(cursor ? { cursor } : {}) });
          Object.assign(wellKnown, page.wellKnown);
          if (!Array.isArray(page.items)) reject('invalid_request');
          for (const item of page.items) all.set(item.id, item);
          cursor = page.nextCursor;
          if (cursor && seen.has(cursor) || all.size > 10000) reject('response_limit');
          seen.add(cursor);
        } while (cursor);
      }
      await collect();
      for (const item of all.values()) if (item.childFolderCount > 0) await collect(item.id);
      const byId = new Map(), byPath = new Map();
      function project(item, ancestors = new Set()) {
        if (byId.has(item.id)) return byId.get(item.id);
        if (ancestors.has(item.id) || ancestors.size > 100) reject('invalid_request');
        const role = Object.entries(wellKnown).find(([key, value]) => roles[key] && value === item.id)?.[0];
        const parent = all.get(item.parentFolderId);
        const parentDto = parent && project(parent, new Set([...ancestors, item.id]));
        const path = role ? roles[role][0] : (parentDto ? parentDto.path + '/' : '') + 'F-' + encodeURIComponent(item.id);
        const dto = { path, name: item.displayName, delimiter: '/', special_use: role ? roles[role][1] : '',
          parent_label: parentDto ? [parentDto.parent_label, parentDto.name].filter(Boolean).join(' / ') : '',
          unread_count: item.unreadItemCount, total_count: item.totalItemCount, counts_known: Number.isSafeInteger(item.unreadItemCount) && Number.isSafeInteger(item.totalItemCount), server_counts_at: observedAt, server_count_revision: revision, status_attempt_revision: revision, status_attempted_at: observedAt };
        byId.set(item.id, dto); byPath.set(path, item.id);
        return dto;
      }
      for (const item of all.values()) project(item);
      const set = { byId, byPath, wellKnown, items: [...byId.values()] };
      folderSets.set(id, set); return set;
    })().finally(() => folderLoads.delete(id));
    folderLoads.set(id, load); return load;
  }
  function messageDto(accountId, message) {
    ref(accountId);
    const key = JSON.stringify([accountId, message.id]);
    let id = messageKeys.get(key);
    if (!id) { id = crypto.randomUUID(); messageKeys.set(key, id); }
    messages.set(id, { accountId, message });
    const threadKey = JSON.stringify([accountId, message.conversationId]);
    let threadId = threadKeys.get(threadKey);
    if (!threadId) { threadId = crypto.randomUUID(); threadKeys.set(threadKey, threadId); threads.set(threadId, { accountId, conversationId: message.conversationId }); }
    const account = accounts.get(accountId);
    const address = email => ({ email, address: email });
    return { id, uid: id, account_id: accountId, account_email: account.address, account_name: account.displayName,
      folder: folderSets.get(accountId)?.byId.get(message.folderId)?.path || '', thread_id: threadId,
      message_id: id, subject: message.subject, from_email: message.from || '', from_address: message.from || '', from_name: message.from || '',
      to_addresses: (message.to || []).map(address), cc_addresses: (message.cc || []).map(address), bcc_addresses: (message.bcc || []).map(address),
      date: message.receivedAt || message.sentAt, snippet: message.body?.content?.slice(0, 240) || '',
      is_read: message.isRead, is_draft: message.isDraft, has_attachments: message.hasAttachments,
      revision_hash: message.revisionHash };
  }
  function ownedMessage(id) {
    const value = messages.get(id);
    if (!value) reject('account_changed');
    ref(value.accountId); return value;
  }
  async function detail(id) {
    const value = ownedMessage(id);
    await folders(value.accountId);
    const data = await rpc('message', { mailbox: ref(value.accountId), messageId: value.message.id });
    messageDto(value.accountId, data); return data;
  }
  function selectedAccounts(id) {
    if (id && id !== 'all' && id !== 'undefined' && id !== 'null') { ref(id); return [id]; }
    return [...accounts].filter(([, a]) => a.status === 'connected' && a.capabilities.read).map(([id]) => id);
  }
  async function list(url, search) {
    const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 50);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 50000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) reject('invalid_request');
    const ids = selectedAccounts(url.searchParams.get('accountId')), folder = url.searchParams.get('folder') || (search ? null : 'INBOX');
    const query = url.searchParams.get('q') || '', unread = url.searchParams.get('unreadOnly') === 'true' || url.searchParams.get('unread') === 'true';
    const key = JSON.stringify([ids, search, folder, query, unread]);
    if (offset === 0 || !pages.has(key)) pages.set(key, new Map(ids.map(id => [id, { items: [], seen: new Set(), cursors: new Set(), complete: false, cursor: null }])));
    const state = pages.get(key), end = offset + limit;
    for (const id of ids) {
      const set = await folders(id), folderId = folder && set.byPath.get(folder), page = state.get(id);
      if (folder && !folderId) { page.complete = true; continue; }
      let fetched = 0;
      while (page.items.length <= end && !page.complete) {
        if (++fetched > 1000) reject('response_limit');
        const data = await rpc(search ? 'search' : 'browse', { mailbox: ref(id), ...(search ? { query } : { folderId }), ...(page.cursor ? { cursor: page.cursor } : {}) });
        if (!Array.isArray(data.items)) reject('invalid_request');
        for (const message of data.items) if (!page.seen.has(message.id)) {
          page.seen.add(message.id);
          if ((!folderId || !search || message.folderId === folderId || message.folderIds?.includes(folderId)) && (!unread || !message.isRead)) page.items.push(messageDto(id, message));
        }
        page.cursor = data.nextCursor;
        page.complete = !page.cursor;
        if (page.cursor && page.cursors.has(page.cursor)) reject('invalid_request');
        page.cursors.add(page.cursor);
      }
    }
    const all = [...state.values()].flatMap(p => p.items).sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0) || a.id.localeCompare(b.id));
    const complete = [...state.values()].every(p => p.complete), hasMore = all.length > end || !complete;
    // shortcut: provider search can cap results; use Corevo's durable projection before promising full-mailbox search.
    return { messages: all.slice(offset, end), total: complete ? all.length : null, hasMore, complete, ...(search ? { coverage: 'provider_search_limit' } : {}) };
  }
  async function mutate(action, id, changes) {
    const value = ownedMessage(id), key = JSON.stringify([value.accountId, value.message.id, action, changes]);
    let pending = writes.get(key), data;
    if (pending) {
      if (pending.busy) reject('operation_indeterminate');
      pending.busy = true;
      try { data = { operation: await rpc('operation-outcome', { mailbox: ref(value.accountId), operationId: pending.input.operationId }) }; }
      finally { pending.busy = false; }
    } else {
      pending = { busy: true, input: { mailbox: ref(value.accountId), messageId: value.message.id, expectedRevisionHash: value.message.revisionHash, operationId: crypto.randomUUID(), ...changes } };
      writes.set(key, pending);
      try { data = await rpc(action, pending.input); }
      catch (error) {
        if (['access_denied', 'invalid_request', 'capability_unavailable'].includes(error.code)) writes.delete(key);
        throw error;
      } finally { pending.busy = false; }
    }
    if (!data.operation || data.operation.operationId !== pending.input.operationId) reject('operation_indeterminate');
    if (data.operation.state === 'known_failed') { writes.delete(key); reject('provider_rejected'); }
    if (data.operation.state !== 'provider_saved') reject('operation_indeterminate');
    const current = data.message || await rpc('message', { mailbox: ref(value.accountId), messageId: data.operation.providerMessageId });
    if (current.id !== value.message.id || action === 'move' && current.folderId !== changes.destinationFolderId || action === 'set-read' && current.isRead !== changes.isRead) reject('operation_indeterminate');
    writes.delete(key); pages.clear(); folderSets.delete(value.accountId);
    messageDto(value.accountId, current);
    return id;
  }
  async function changeMessages(ids, action, changes) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id => typeof id !== 'string')) reject('invalid_request');
    const unique = [...new Set(ids)], prepared = [];
    for (const id of unique) {
      const value = ownedMessage(id);
      let input = changes;
      if (action === 'move') {
        const set = await folders(value.accountId), destinationFolderId = changes.role ? set.wellKnown[changes.role] : set.byPath.get(changes.folder);
        if (!destinationFolderId || value.message.isDraft) reject('invalid_request');
        if (value.message.folderId === destinationFolderId) prepared.push({ id, unchanged: true });
        else prepared.push({ id, input: { destinationFolderId } });
      } else prepared.push({ id, input });
    }
    const done = [], failed = [];
    for (const item of prepared) {
      try { if (!item.unchanged) await mutate(action, item.id, item.input); done.push(item.id); }
      catch (error) { failed.push({ id: item.id, error: errors[error.code] || 'Ändringen kunde inte verifieras.' }); }
    }
    return { done, failed };
  }
  async function request(path, method = 'GET', rawBody = null) {
    if (disposed) return fail('Mejlytan är stängd.', 410);
    if (typeof path !== 'string' || path.length > 4096 || !/^\/(api|oauth)\//.test(path)
      || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
      || rawBody !== null && (typeof rawBody !== 'string' || rawBody.length > 131072)) return fail(errors.invalid_request, 400);
    try {
      const url = new URL(path, 'https://corevo.invalid');
      const body = rawBody === null ? {} : JSON.parse(rawBody);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(errors.invalid_request, 400);
      const route = url.pathname;
      if (route === '/api/accounts' && method === 'GET') return reply(await inventory());
      if (route === '/api/mail/messages/bulk-read' && method === 'POST') {
        if (typeof body.read !== 'boolean') reject('invalid_request');
        const changed = await changeMessages(body.ids, 'set-read', { isRead: body.read });
        return changed.failed.length ? reply({ error: `${changed.done.length} av ${body.ids.length} ändringar verifierades. ${changed.failed[0].error}`, completed: changed.done, failed: changed.failed }, 409) : reply({ ok: true, read: changed.done });
      }
      if (method === 'POST' && ['/api/mail/messages/bulk-move', '/api/mail/messages/bulk-archive', '/api/mail/messages/bulk-delete'].includes(route)) {
        if (route.endsWith('bulk-delete') && Array.isArray(body.ids)) for (const id of body.ids) {
          const value = ownedMessage(id), set = await folders(value.accountId);
          if (value.message.folderId === set.wellKnown.deleteditems) return fail('Permanent radering behöver en kompletterad Corevo-koppling. Meddelandena ligger kvar.', 422);
        }
        const changes = route.endsWith('bulk-archive') ? { role: 'archive' } : route.endsWith('bulk-delete') ? { role: 'deleteditems' } : { folder: body.folder };
        const changed = await changeMessages(body.ids, 'move', changes);
        const name = route.endsWith('bulk-delete') ? 'deleted' : 'moved';
        if (changed.failed.length && (body.ids.length === 1 || route.endsWith('bulk-archive'))) return reply({ error: `${changed.done.length} av ${body.ids.length} flyttningar verifierades. ${changed.failed[0].error}`, completed: changed.done, failed: changed.failed }, 409);
        return reply({ [name]: changed.done, failed: changed.failed });
      }
      const deleteRoute = route.match(/^\/api\/mail\/messages\/([^/]+)$/);
      if (deleteRoute && method === 'DELETE') {
        const id = decodeURIComponent(deleteRoute[1]), value = ownedMessage(id), set = await folders(value.accountId);
        if (value.message.folderId === set.wellKnown.deleteditems) return fail('Permanent radering behöver en kompletterad Corevo-koppling. Meddelandet ligger kvar i papperskorgen.', 422);
        const changed = await changeMessages([id], 'move', { role: 'deleteditems' });
        return changed.failed.length ? fail(changed.failed[0].error, 409) : reply({ ok: true, deleted: changed.done });
      }
      const folderRoute = route.match(/^\/api\/accounts\/([^/]+)\/folders$/);
      if (folderRoute && method === 'GET') return reply((await folders(decodeURIComponent(folderRoute[1]), true)).items);
      if (method === 'GET' && ['/api/mail/messages', '/api/search'].includes(route)) return reply(await list(url, route === '/api/search'));
      if (route === '/api/mail/unread-counts' && method === 'GET') {
        const byAccount = {}, snapshots = {};
        for (const id of selectedAccounts()) {
          const set = await folders(id, true), inbox = set.byId.get(set.wellKnown.inbox);
          byAccount[id] = inbox?.counts_known ? inbox.unread_count : null;
          snapshots[id] = { known: inbox?.counts_known === true, stale: false, observedAt: inbox?.server_counts_at, revision: inbox?.server_count_revision, attemptRevision: inbox?.status_attempt_revision };
        }
        const complete = Object.values(byAccount).every(n => Number.isSafeInteger(n));
        return reply({ byAccount, snapshots, total: complete ? Object.values(byAccount).reduce((sum, n) => sum + n, 0) : null, complete });
      }
      if (route === '/api/mail/thread' && method === 'GET') {
        const thread = threads.get(url.searchParams.get('id'));
        if (!thread) reject('account_changed');
        const all = [], seen = new Set(); let cursor;
        do {
          const data = await rpc('thread', { mailbox: ref(thread.accountId), conversationId: thread.conversationId, ...(cursor ? { cursor } : {}) });
          all.push(...data.items.map(m => messageDto(thread.accountId, m)));
          cursor = data.nextCursor;
          if (cursor && seen.has(cursor) || all.length > 10000) reject('response_limit');
          seen.add(cursor);
        } while (cursor);
        return reply(all);
      }
      const messageRoute = route.match(/^\/api\/mail\/messages\/([^/]+)(?:\/(body|bcc|attachments\/[^/]+))?$/);
      if (messageRoute && method === 'GET') {
        const id = decodeURIComponent(messageRoute[1]), data = await detail(id), value = ownedMessage(id);
        if (!messageRoute[2]) return reply(messageDto(value.accountId, data));
        if (messageRoute[2] === 'bcc') return reply({ bcc: (data.bcc || []).map(email => ({ email })) });
        if (messageRoute[2] === 'body') {
          const text = data.body?.content || '', escaped = text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
          return reply({ text, html: '<div style="white-space:pre-wrap">' + escaped + '</div>', attachments: (data.attachments || []).map(a => ({ part: a.id, filename: a.name, size: a.size, content_type: a.type, contentType: a.type })), hasBlockedRemoteImages: false });
        }
        const attachmentId = decodeURIComponent(messageRoute[2].slice('attachments/'.length));
        const attachment = data.attachments?.find(a => a.id === attachmentId);
        if (!attachment) return fail('Bilagan finns inte i det verifierade meddelandet.', 404);
        const file = await rpc('attachment', { mailbox: ref(value.accountId), messageId: data.id, attachmentId, expectedRevisionHash: data.revisionHash });
        const bytes = Array.from(atob(file.bytesBase64), c => c.charCodeAt(0));
        if (bytes.length !== file.byteLength || bytes.length > 8000000) reject('invalid_request');
        return { status: 200, bytes, contentType: attachment.type || 'application/octet-stream' };
      }
      if (route === '/api/integrations/status' && method === 'GET') {
        const { items } = await rpc('providers', {});
        return reply({ microsoft: { configured: items.some(p => p.provider === 'microsoft_graph' && p.available) },
          google: { configured: items.some(p => p.provider === 'gmail' && p.available) },
          imap: { configured: items.some(p => p.provider === 'imap_smtp' && p.available) } });
      }
      if (route === '/oauth/microsoft/device' && method === 'POST') {
        if (connectingMicrosoft || deviceAttempt) return fail('Microsoft-inloggning pågår redan.', 409);
        connectingMicrosoft = true;
        try {
          const data = await rpc('begin', { profile });
          deviceAttempt = { id: data.attemptId, expiresAt: Date.parse(data.expiresAt) };
          return reply({ userCode: data.userCode, verificationUri: data.verificationUri, interval: data.pollAfterSeconds, expiresAt: data.expiresAt });
        } finally { connectingMicrosoft = false; }
      }
      if (route === '/oauth/microsoft/device/poll' && method === 'GET') {
        if (!deviceAttempt) return fail('Starta Microsoft-inloggningen igen.', 409);
        if (deviceAttempt.expiresAt <= Date.now()) { deviceAttempt = null; return reply({ status: 'expired' }); }
        const data = await rpc('poll', { attemptId: deviceAttempt.id });
        if (data.state === 'pending') return reply({ status: 'pending', interval: data.pollAfterSeconds });
        deviceAttempt = null;
        return reply({ status: 'success', account: dto(data.account) });
      }
      if (route === '/oauth/microsoft/device/cancel' && method === 'POST') {
        deviceAttempt = null;
        return reply({ ok: true });
      }
      if (route === '/api/corevo/connections/gmail' && method === 'POST') {
        const data = await rpc('oauth-begin', { provider: 'gmail', profile, previousRef: null });
        onGmailBegin?.({ attemptId: data.attemptId, expiresAt: data.expiresAt });
        return reply(data);
      }
      if (route === '/api/accounts' && method === 'POST') {
        if (!secureTransport) return fail('Öppna Corevo via en säker HTTPS-adress för att ansluta ett konto med lösenord.', 409);
        if (body.imap_skip_tls_verify || Number(body.imap_port) !== 993
          || body.auth_user !== body.email_address
          || body.smtp_auth_user && body.smtp_auth_user !== body.email_address
          || body.smtp_auth_pass && body.smtp_auth_pass !== body.auth_pass) return fail('Den valda kontokonfigurationen behöver en kompletterad Corevo-koppling. TLS-kontrollen får inte stängas av.', 422);
        const settings = { provider: body.imap_host === 'imap.one.com' && body.smtp_host === 'send.one.com' ? 'one_com' : 'imap',
          address: body.email_address, password: body.auth_pass, imapHost: body.imap_host, smtpHost: body.smtp_host, smtpPort: Number(body.smtp_port) };
        const data = await rpc('connect-imap', { settings, profile, previousRef: null });
        const all = await inventory();
        const connected = all.find(a => accounts.get(a.id).binding.mailboxId === data.binding.mailboxId);
        if (!connected) throw Object.assign(new Error(), { code: 'account_changed' });
        return reply(connected);
      }
      const accountRoute = route.match(/^\/api\/accounts\/([^/]+)$/);
      if (accountRoute && method === 'DELETE') {
        const id = decodeURIComponent(accountRoute[1]);
        await rpc('disconnect', { mailbox: ref(id) }); accounts.delete(id);
        return reply({ ok: true });
      }
      return fail('Den här funktionen är ännu inte kopplad till Corevos backend. Ingen åtgärd utfördes.');
    } catch (error) {
      return fail(errors[error.code] || 'Mejlkopplingen kunde inte verifieras. Försök igen efter att anslutningen har kontrollerats.',
        error.code === 'access_denied' || error.code === 'account_changed' ? 403 : 409);
    }
  }
  return { request, inventory,
    get connectingMicrosoft() { return connectingMicrosoft; },
    async completeGmail(saved, callback) {
      if (!saved || Date.parse(saved.expiresAt) <= Date.now()) return fail(errors.reconnect_required, 409);
      try { await rpc('oauth-complete', { provider: 'gmail', attemptId: saved.attemptId, callback }); return reply(await inventory()); }
      catch (error) { return fail(errors[error.code] || 'Google-anslutningen kunde inte verifieras.', 409); }
    },
    dispose() { disposed = true; deviceAttempt = null; for (const map of [accounts, folderSets, folderLoads, messages, messageKeys, threads, threadKeys, pages, writes]) map.clear(); },
  };
}
