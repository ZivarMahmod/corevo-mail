// AGPL-3.0: public adapter to the host's already-authorized mailbox interface.
import { mailboxUUID } from './mailbox-uuid.mjs';
const profile = 'personal-mail-readwrite-send';
const errors = {
  reconnect_required: 'Anslut brevlådan igen hos leverantören.',
  account_changed: 'Brevlådans åtkomst har ändrats. Öppna Mejl igen.',
  access_denied: 'Din inloggning har inte åtkomst till brevlådan.',
  not_configured: 'Den här leverantörsanslutningen är inte konfigurerad ännu.',
  busy: 'Brevlådan är upptagen av en annan åtgärd. Din text finns kvar; försök igen om en stund.',
  operation_indeterminate: 'Utfallet är okänt. Kontrollera anslutningen innan du försöker igen.',
  invalid_request: 'Anropet kunde inte verifieras.',
  aborted: 'Mejlåtgärden avbröts.',
  response_limit: 'Svaret är för stort för den här hämtningen. Begränsa sökningen och försök igen.',
  revision_conflict: 'Meddelandet har ändrats hos leverantören. Hämta det igen innan du fortsätter.',
  operation_unknown: 'Utfallet kunde inte hämtas. Ingen ny leverantörsåtgärd har skickats.',
  provider_rejected: 'Leverantören avvisade ändringen.',
  local_journal_unavailable: 'Mejlåtgärdens identifierare kunde inte sparas säkert. Ingen ny leverantörsåtgärd skickades.',
};
const reply = (body, status = 200) => ({ status, body });
const fail = (message, status = 501) => reply({ error: message }, status);

export function createMailboxTransport(call, { secureTransport = false, signal, onGmailBegin, storage } = {}) {
  let disposed = false, deviceAttempt = null, connectingMicrosoft = false, observationRevision = Date.now();
  const accounts = new Map();
  const folderSets = new Map(), folderLoads = new Map(), messages = new Map(), messageKeys = new Map(), threads = new Map(), threadKeys = new Map(), pages = new Map();
  const writes = new Map();
  const draftRevisions = new Map(), draftLocks = new Set(), sendReviews = new Map(), retainedFiles = new Map();
  let retainedCompose;
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
    if (!id) { id = mailboxUUID(); messageKeys.set(key, id); }
    messages.set(id, { accountId, message });
    const threadKey = JSON.stringify([accountId, message.conversationId]);
    let threadId = threadKeys.get(threadKey);
    if (!threadId) { threadId = mailboxUUID(); threadKeys.set(threadKey, threadId); threads.set(threadId, { accountId, conversationId: message.conversationId }); }
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
      pending = { busy: true, input: { mailbox: ref(value.accountId), messageId: value.message.id, expectedRevisionHash: value.message.revisionHash, operationId: mailboxUUID(), ...changes } };
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
  function journal(accountId) {
    if (!storage?.getItem || !storage?.setItem) reject('local_journal_unavailable');
    const a = accounts.get(accountId); ref(accountId);
    const key = 'corevo-mail-operations-v1:' + JSON.stringify([a.binding.tenantId, a.binding.ownerUserId, accountId]);
    let entries;
    try { entries = JSON.parse(storage.getItem(key) || '[]'); } catch { reject('local_journal_unavailable'); }
    if (!Array.isArray(entries) || entries.length > 200 || entries.some(e => !e || typeof e.key !== 'string' || e.key.length > 1200 || !/^[0-9a-f-]{36}$/i.test(e.operationId) || !['draft-create', 'draft-save', 'draft-attachment-add', 'draft-attachment-remove', 'send'].includes(e.action) || !['pending', 'provider_saved', 'provider_accepted', 'sent_observed', 'known_failed'].includes(e.state) || e.providerMessageId !== null && typeof e.providerMessageId !== 'string')) reject('local_journal_unavailable');
    return { entries, save() {
      try { const value = JSON.stringify(entries); storage.setItem(key, value); if (storage.getItem(key) !== value) reject('local_journal_unavailable'); }
      catch { reject('local_journal_unavailable'); }
    } };
  }
  async function draftWrite(accountId, key, action, input) {
    const lock = JSON.stringify([accountId, key]); if (draftLocks.has(lock)) reject('operation_indeterminate');
    draftLocks.add(lock);
    try {
      const store = journal(accountId); let entry = store.entries.find(e => e.key === key), operation;
      let recovered = !!entry;
      if (entry) {
        if (entry.action !== action) reject('invalid_request');
        if (entry.state === 'known_failed') reject('provider_rejected');
        try {
          operation = entry.state === 'provider_saved' ? { operationId: entry.operationId, kind: entry.action, state: entry.state, providerMessageId: entry.providerMessageId, providerRevisionHash: entry.providerRevisionHash }
            : await rpc('operation-outcome', { mailbox: ref(accountId), operationId: entry.operationId });
        } catch (error) {
          if (error.code !== 'operation_unknown' || !Object.keys(input).length) throw error;
          // The host admits durably before dispatch; an absent operation never reached the provider.
          operation = (await rpc(action, { mailbox: ref(accountId), operationId: entry.operationId, ...input })).operation;
          recovered = false;
        }
      } else {
        if (store.entries.length >= 200 || action === 'draft-create' && store.entries.some(e => e.action === action && e.state === 'pending')) reject('operation_indeterminate');
        entry = { key, action, operationId: mailboxUUID(), state: 'pending', providerMessageId: null, providerRevisionHash: null };
        store.entries.push(entry); store.save();
        const data = await rpc(action, { mailbox: ref(accountId), operationId: entry.operationId, ...input }); operation = data.operation;
      }
      if (!operation || operation.operationId !== entry.operationId || operation.kind !== action) reject('operation_indeterminate');
      if (operation.state === 'known_failed') { entry.state = 'known_failed'; store.save(); reject('provider_rejected'); }
      if (operation.state !== 'provider_saved' || !operation.providerMessageId) reject('operation_indeterminate');
      // Retain the acknowledged result even when its following observation fails.
      entry.state = 'provider_saved'; entry.providerMessageId = operation.providerMessageId; entry.providerRevisionHash = operation.providerRevisionHash;
      if (operation.attachmentId) entry.attachmentId = operation.attachmentId;
      store.save();
      const current = await rpc('message', { mailbox: ref(accountId), messageId: operation.providerMessageId });
      if (!current.isDraft || current.id !== operation.providerMessageId || current.revisionHash !== operation.providerRevisionHash) reject('revision_conflict');
      const dto = messageDto(accountId, current); draftRevisions.set(dto.id, current.revisionHash);
      return { current, dto, recovered };
    } finally { draftLocks.delete(lock); }
  }
  async function saveNativeDraft(body) {
    const accountId = body.accountId; ref(accountId);
    if (body.aliasId || !/^[0-9a-f-]{36}$/i.test(body.corevoComposeId) || !body.corevoContent || !['compose', 'reply', 'replyAll', 'forward'].includes(body.corevoKind || 'compose')) reject('invalid_request');
    const uploads = await prepareUploads(body.attachments || []);
    if (body.forwardedMessages?.length) throw Object.assign(new Error('Hela mejl som EML-bilagor behöver sin leverantörskoppling. Texten finns kvar i skrivfönstret.'), { nativeMessage: true });
    if (retainedCompose !== body.corevoComposeId) { retainedFiles.clear(); retainedCompose = body.corevoComposeId; }
    const forwarded = body.forwardedAttachments || [];
    if (!Array.isArray(forwarded) || forwarded.length + uploads.length > 10) reject('invalid_request');
    for (const file of forwarded) {
      const source = ownedMessage(file.messageId);
      if (source.accountId !== accountId || typeof file.part !== 'string') reject('access_denied');
      const key = JSON.stringify([accountId, file.messageId, file.part]);
      if (!retainedFiles.has(key)) retainedFiles.set(key, await providerFile(accountId, source.message, file.part));
      uploads.push(retainedFiles.get(key));
    }
    let value, existingId = body.existingUid;
    // Recover an interrupted attachment change before issuing any new content change.
    for (const entry of journal(accountId).entries.filter(e => e.state === 'pending' && (e.key.startsWith('add:' + body.corevoComposeId + ':') || e.key.startsWith('remove:' + body.corevoComposeId + ':')))) {
      value = await draftWrite(accountId, entry.key, entry.action, {});
      const store = journal(accountId), creation = store.entries.find(e => e.key === 'create:' + body.corevoComposeId);
      if (creation) { creation.providerMessageId = value.current.id; creation.providerRevisionHash = value.current.revisionHash; store.save(); }
    }
    if (existingId != null) {
      const owned = ownedMessage(existingId), folder = (await folders(accountId)).byId.get(owned.message.folderId)?.path;
      if (owned.accountId !== accountId || body.existingAccountId !== accountId || body.existingFolder !== folder || !owned.message.isDraft || !draftRevisions.has(existingId)) reject('revision_conflict');
    } else {
      const kind = body.corevoKind || 'compose', input = { kind };
      if (kind === 'compose') input.content = body.corevoContent;
      else {
        const source = ownedMessage(body.corevoSourceId);
        if (source.accountId !== accountId) reject('access_denied');
        input.source = { messageId: source.message.id, expectedRevisionHash: source.message.revisionHash };
        if (kind === 'forward') input.to = body.corevoContent.to;
      }
      value = await draftWrite(accountId, 'create:' + body.corevoComposeId, 'draft-create', input);
      existingId = value.dto.id;
    }
    // The first body read captures the revision the editor saw; background list refreshes cannot advance it.
    const seen = draftRevisions.get(existingId), owned = ownedMessage(existingId);
    if (!value || value.recovered || (body.corevoKind || 'compose') !== 'compose') {
      const key = 'save:' + owned.message.id, store = journal(accountId), old = store.entries.find(e => e.key === key);
      if (old?.state === 'provider_saved') { store.entries.splice(store.entries.indexOf(old), 1); store.save(); }
      value = await draftWrite(accountId, key, 'draft-save', { draftId: owned.message.id, expectedRevisionHash: seen, content: body.corevoContent });
      if (value.recovered) {
        const resolved = journal(accountId), prior = resolved.entries.find(e => e.key === key);
        resolved.entries.splice(resolved.entries.indexOf(prior), 1); resolved.save();
        value = await draftWrite(accountId, key, 'draft-save', { draftId: value.current.id, expectedRevisionHash: value.current.revisionHash, content: body.corevoContent });
      }
    }
    let files = await draftFiles(accountId, value.current);
    const remaining = [...uploads], remove = [];
    for (const file of files) {
      const index = remaining.findIndex(wanted => wanted.digest === file.digest);
      if (index < 0) remove.push(file); else remaining.splice(index, 1);
    }
    // IMAP part numbers may shift after MIME replacement; remove from the end and reread.
    for (const file of remove.reverse()) {
      files = await draftFiles(accountId, value.current);
      const current = [...files].reverse().find(f => f.digest === file.digest);
      if (!current) reject('revision_conflict');
      value = await draftWrite(accountId, 'remove:' + body.corevoComposeId + ':' + value.current.revisionHash + ':' + current.id, 'draft-attachment-remove', { draftId: value.current.id, expectedRevisionHash: value.current.revisionHash, attachmentId: current.id });
    }
    for (const upload of remaining) value = await draftWrite(accountId, 'add:' + body.corevoComposeId + ':' + upload.digest + ':' + value.current.revisionHash, 'draft-attachment-add', { draftId: value.current.id, expectedRevisionHash: value.current.revisionHash, file: upload.file });
    const actual = (await draftFiles(accountId, value.current)).map(f => f.digest).sort();
    if (JSON.stringify(actual) !== JSON.stringify(uploads.map(f => f.digest).sort())) reject('revision_conflict');
    const saved = journal(accountId), creation = saved.entries.find(e => e.key === 'create:' + body.corevoComposeId);
    if (creation) { creation.providerMessageId = value.current.id; creation.providerRevisionHash = value.current.revisionHash; saved.save(); }
    pages.clear(); folderSets.delete(accountId); await folders(accountId, true);
    value.dto = messageDto(accountId, value.current);
    return { uid: value.dto.uid, folder: value.dto.folder, accountId, messageId: value.dto.message_id, storage: 'provider' };
  }
  async function prepareUploads(files) {
    if (!Array.isArray(files) || files.length > 10) reject('invalid_request');
    const result = []; let total = 0;
    for (const file of files) {
      if (!file || typeof file.filename !== 'string' || !file.filename || file.filename.length > 512 || /[\x00-\x1f\x7f/\\]/.test(file.filename) || typeof file.contentType !== 'string' || !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(file.contentType) || typeof file.content !== 'string' || file.content.length > 2666668) reject('invalid_request');
      let bytes; try { const raw = atob(file.content); if (btoa(raw) !== file.content) reject('invalid_request'); bytes = Uint8Array.from(raw, c => c.charCodeAt(0)); } catch { reject('invalid_request'); }
      total += bytes.length;
      if (!bytes.length || bytes.length > 2000000 || total > 4000000) throw Object.assign(new Error('Bilagor får vara högst 2 MB per fil och 4 MB tillsammans i den här kopplingen. Dina filer finns kvar i skrivfönstret.'), { nativeMessage: true });
      if (!globalThis.crypto?.subtle) throw Object.assign(new Error('Öppna Corevo via HTTPS för att spara bilagor säkert.'), { nativeMessage: true });
      const digest = await fileDigest(file.filename, file.content);
      result.push({ digest, file: { name: file.filename, contentType: file.contentType, bytesBase64: file.content } });
    }
    return result;
  }
  async function fileDigest(name, bytesBase64) {
    if (!globalThis.crypto?.subtle) throw Object.assign(new Error('Öppna Corevo via HTTPS för att hantera bilagor säkert.'), { nativeMessage: true });
    const bytes = new TextEncoder().encode(JSON.stringify([name, bytesBase64]));
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  }
  async function providerFile(accountId, message, attachmentId) {
    const file = await rpc('attachment', { mailbox: ref(accountId), messageId: message.id, attachmentId, expectedRevisionHash: message.revisionHash });
    return { id: attachmentId, digest: await fileDigest(file.name, file.bytesBase64), file: { name: file.name, contentType: 'application/octet-stream', bytesBase64: file.bytesBase64 } };
  }
  async function draftFiles(accountId, message) {
    const result = [];
    for (const file of message.attachments || []) result.push(await providerFile(accountId, message, file.id));
    return result;
  }
  const reviewContent = body => JSON.stringify([body.accountId, body.corevoComposeId, body.corevoKind || 'compose', body.corevoSourceId || null, body.corevoContent, body.attachments || [], body.forwardedAttachments || [], body.forwardedMessages || [], body.priority || 'normal']);
  async function reviewSend(body) {
    if (body.priority && body.priority !== 'normal') throw Object.assign(new Error('Prioritetsmarkeringen behöver stöd i leverantörskopplingen innan utskick.'), { nativeMessage: true });
    const saved = await saveNativeDraft({ ...body, ...(body.draft ? { existingUid: body.draft.uid, existingFolder: body.draft.folder, existingAccountId: body.draft.accountId } : {}) });
    const current = await detail(saved.uid);
    if (!current.isDraft || !current.contentDigest || !(current.to?.length + current.cc?.length + current.bcc?.length)) reject('revision_conflict');
    if (sendReviews.size >= 100) sendReviews.delete(sendReviews.keys().next().value);
    const reviewId = mailboxUUID();
    sendReviews.set(reviewId, { accountId: body.accountId, uid: saved.uid, providerId: current.id, revisionHash: current.revisionHash, contentDigest: current.contentDigest, content: reviewContent(body), expiresAt: Date.now() + 600000 });
    return { reviewId, draft: { uid: saved.uid, folder: saved.folder, accountId: body.accountId }, from: accounts.get(body.accountId).address, to: current.to, cc: current.cc, bcc: current.bcc, subject: current.subject, text: current.body?.content || '', attachments: current.attachments.map(a => ({ name: a.name, size: a.size })), delivery: 'not_sent' };
  }
  async function sendReviewed(body) {
    const review = sendReviews.get(body.corevoReviewId);
    if (!review || review.expiresAt < Date.now() || review.content !== reviewContent(body)) reject('revision_conflict');
    ref(review.accountId);
    const key = 'send:' + review.providerId + ':' + review.contentDigest, lock = JSON.stringify([review.accountId, key]);
    if (draftLocks.has(lock)) reject('operation_indeterminate');
    draftLocks.add(lock);
    try {
      const store = journal(review.accountId); let entry = store.entries.find(e => e.key === key), operation;
      if (entry) operation = await rpc('operation-outcome', { mailbox: ref(review.accountId), operationId: entry.operationId });
      else {
        if (store.entries.length >= 200) reject('operation_indeterminate');
        entry = { key, action: 'send', operationId: mailboxUUID(), state: 'pending', providerMessageId: review.providerId, providerRevisionHash: review.revisionHash };
        store.entries.push(entry); store.save();
        const response = await rpc('send', { mailbox: ref(review.accountId), operationId: entry.operationId, draftId: review.providerId, expectedRevisionHash: review.revisionHash, expectedContentDigest: review.contentDigest }); operation = response.operation;
      }
      if (!operation || operation.kind !== 'send' || operation.operationId !== entry.operationId) reject('operation_indeterminate');
      if (operation.state === 'known_failed') { entry.state = operation.state; store.save(); reject('provider_rejected'); }
      if (!['provider_accepted', 'sent_observed'].includes(operation.state)) reject('operation_indeterminate');
      entry.state = operation.state; entry.providerMessageId = operation.providerMessageId; store.save();
      pages.clear(); folderSets.delete(review.accountId);
      const set = await folders(review.accountId, true);
      return { ok: true, providerAccepted: true, sentObserved: operation.state === 'sent_observed', delivery: 'unknown', sentFolder: set.byId.get(set.wellKnown.sentitems)?.path || 'Sent' };
    } finally { draftLocks.delete(lock); }
  }
  async function request(path, method = 'GET', rawBody = null) {
    if (disposed) return fail('Mejlytan är stängd.', 410);
    if (typeof path !== 'string' || path.length > 4096 || !/^\/(api|oauth)\//.test(path)
      || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
      || rawBody !== null && (typeof rawBody !== 'string' || rawBody.length > (/^\/api\/mail\/(draft|review|send)$/.test(path) ? 5800000 : 131072))) return fail(errors.invalid_request, 400);
    try {
      const url = new URL(path, 'https://corevo.invalid');
      const body = rawBody === null ? {} : JSON.parse(rawBody);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(errors.invalid_request, 400);
      const route = url.pathname;
      if (route === '/api/mail/draft' && method === 'POST') return reply(await saveNativeDraft(body));
      if (route === '/api/mail/review' && method === 'POST') return reply(await reviewSend(body));
      if (route === '/api/mail/send' && method === 'POST') return reply(await sendReviewed(body));
      if (route === '/api/accounts' && method === 'GET') return reply(await inventory());
      if (route === '/api/mail/corevo-sync' && method === 'POST') {
        if (Object.keys(body).some(key => !['accountId', 'folder'].includes(key)) || body.accountId !== null && typeof body.accountId !== 'string' || typeof body.folder !== 'string' || body.folder.length > 1024) reject('invalid_request');
        const items = [], byAccount = {}, snapshots = {}, accountIds = selectedAccounts(body.accountId);
        for (const id of accountIds) {
          try {
            const set = await folders(id, true), folderId = set.byPath.get(body.folder);
            if (folderId) {
              const status = await rpc('sync-status', { mailbox: ref(id), folderId });
              const result = await rpc('sync-step', { mailbox: ref(id), folderId, expectedCheckpointRevision: status.checkpointRevision });
              items.push({ accountId: id, state: result.state, folders: set.items, error: result.lastError ? errors[result.lastError] || 'Synkningen kunde inte slutföras.' : null });
            }
            const inbox = set.byId.get(set.wellKnown.inbox);
            byAccount[id] = inbox?.counts_known ? inbox.unread_count : null;
            snapshots[id] = { known: inbox?.counts_known === true, stale: false, observedAt: inbox?.server_counts_at, revision: inbox?.server_count_revision };
          } catch (error) { items.push({ accountId: id, state: 'unavailable', error: errors[error.code] || 'Synkningen kunde inte slutföras.' }); }
        }
        const complete = Object.keys(byAccount).length === accountIds.length && Object.values(byAccount).every(Number.isSafeInteger);
        return reply({ items, counts: { byAccount, snapshots, complete, total: complete ? Object.values(byAccount).reduce((sum, count) => sum + count, 0) : null } });
      }
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
          if (data.isDraft) draftRevisions.set(id, data.revisionHash);
          const text = data.body?.content || '', escaped = text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
          return reply({ text, html: data.body?.html ?? '<div style="white-space:pre-wrap">' + escaped + '</div>', attachments_complete: Array.isArray(data.attachments), attachments: (data.attachments || []).map(a => ({ part: a.id, filename: a.name, size: a.size, content_type: 'application/octet-stream', contentType: 'application/octet-stream' })), hasBlockedRemoteImages: false });
        }
        const attachmentId = decodeURIComponent(messageRoute[2].slice('attachments/'.length));
        const attachment = data.attachments?.find(a => a.id === attachmentId);
        if (!attachment) return fail('Bilagan finns inte i det verifierade meddelandet.', 404);
        const file = await rpc('attachment', { mailbox: ref(value.accountId), messageId: data.id, attachmentId, expectedRevisionHash: data.revisionHash });
        const bytes = Array.from(atob(file.bytesBase64), c => c.charCodeAt(0));
        if (bytes.length !== file.byteLength || bytes.length > 8000000) reject('invalid_request');
        return { status: 200, bytes, contentType: 'application/octet-stream' };
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
      return fail(error.nativeMessage ? error.message : errors[error.code] || 'Mejlkopplingen kunde inte verifieras. Försök igen efter att anslutningen har kontrollerats.',
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
    dispose() { disposed = true; deviceAttempt = null; for (const map of [accounts, folderSets, folderLoads, messages, messageKeys, threads, threadKeys, pages, writes, draftRevisions, draftLocks, sendReviews, retainedFiles]) map.clear(); },
  };
}
