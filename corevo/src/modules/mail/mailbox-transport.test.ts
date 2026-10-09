import { expect, test } from 'vitest';
import { createMailboxTransport } from './mailbox-transport.mjs';
import { mergeCountSnapshots, mergeFolderSnapshots } from '../../../vendor/mailflow/frontend/src/utils/countSnapshots.js';
import { folderParentLabel, folderMatchesQuery } from '../../../vendor/mailflow/frontend/src/utils/folderDisplay.js';

const account = {
  binding: { mailboxId: 'mailbox', connectionId: 'connection', generation: 'generation-1', scopeRevision: 'scope-1', tenantId: 'private-tenant', ownerUserId: 'owner', accountRef: 'private-account', purpose: 'personal_mail' },
  address: 'konsult@example.test', displayName: 'Konsult', provider: 'microsoft_graph', status: 'connected', addressEvidence: 'provider_bound',
  capabilities: { read: true, draftWrite: true, send: true, readStateWrite: true, sync: true, reasonByUnavailableCapability: {} },
};
const result = data => ({ schemaVersion: 'personal-mailbox-v1', checkedAt: new Date().toISOString(), data });

test('failed provider refresh does not claim complete unread counts', async () => {
  const transport = createMailboxTransport(async action => {
    if (action === 'accounts') return result({ items: [account] });
    throw Object.assign(new Error('provider failed'), { code: 'provider_unavailable' });
  });
  const id = (await transport.request('/api/accounts')).body[0].id;
  const refresh = await transport.request('/api/mail/corevo-sync', 'POST', JSON.stringify({ accountId: id, folder: 'INBOX' }));
  expect(refresh.status).toBe(200);
  expect(refresh.body.items[0].state).toBe('unavailable');
  expect(refresh.body.counts.complete).toBe(false);
  expect(refresh.body.counts.total).toBeNull();
  transport.dispose();
});

test('account generations never rebind stale client IDs and private bindings stay in the host', async () => {
  const calls = [];
  let current = structuredClone(account);
  const transport = createMailboxTransport(async (action, input) => {
    calls.push([action, input]);
    return result(action === 'accounts' ? { items: [current] } : { state: 'disconnected' });
  });
  const first = await transport.request('/api/accounts');
  expect(JSON.stringify(first.body)).not.toMatch(/private-tenant|private-account|connectionId|ownerUserId/);
  current.binding.generation = 'generation-2';
  const second = await transport.request('/api/accounts');
  expect(second.body[0].id).not.toBe(first.body[0].id);
  expect((await transport.request('/api/accounts/' + first.body[0].id, 'DELETE')).status).toBe(403);
  expect(calls.filter(x => x[0] === 'disconnect')).toHaveLength(0);
  current.binding.mailboxId = 'a.b'; current.binding.generation = 'c';
  const dotted = (await transport.request('/api/accounts')).body[0].id;
  current.binding.mailboxId = 'a'; current.binding.generation = 'b.c';
  expect((await transport.request('/api/accounts')).body[0].id).not.toBe(dotted);
  current.binding.mailboxId = 'mailbox'; current.binding.generation = 'generation-2';
  await transport.inventory();
  await transport.request('/api/accounts/' + second.body[0].id, 'DELETE');
  expect(calls.at(-1)).toEqual(['disconnect', { mailbox: { mailboxId: 'mailbox', connectionId: 'connection', generation: 'generation-2', scopeRevision: 'scope-1' } }]);
  transport.dispose();
  expect((await transport.request('/api/accounts')).status).toBe(410);
});

test('Microsoft native device flow becomes successful only after a verified connected account', async () => {
  let pending = true;
  const transport = createMailboxTransport(async action => {
    if (action === 'begin') return result({ attemptId: 'own-attempt', userCode: 'TEST-1234', verificationUri: 'https://microsoft.com/devicelogin', expiresAt: new Date(Date.now() + 60000).toISOString(), pollAfterSeconds: 10 });
    return result(pending ? { state: 'pending', pollAfterSeconds: 10 } : { state: 'connected', account });
  });
  expect((await transport.request('/oauth/microsoft/device/poll')).status).toBe(409);
  const started = await transport.request('/oauth/microsoft/device', 'POST');
  expect(started.body.userCode).toBe('TEST-1234');
  expect(JSON.stringify(started)).not.toContain('own-attempt');
  expect((await transport.request('/oauth/microsoft/device/poll')).body.status).toBe('pending');
  pending = false;
  expect((await transport.request('/oauth/microsoft/device/poll')).body.status).toBe('success');
});

test('IMAP credentials never reach the backend over insecure transport or disabled TLS', async () => {
  const calls = [];
  const call = async (action, input) => { calls.push([action, input]); return result({}); };
  const form = { email_address: 'test@example.test', auth_user: 'test@example.test', auth_pass: 'synthetic-password', imap_host: 'imap.one.com', imap_port: 993, smtp_host: 'send.one.com', smtp_port: 465 };
  const insecure = createMailboxTransport(call);
  expect((await insecure.request('/api/accounts', 'POST', JSON.stringify(form))).status).toBe(409);
  const secure = createMailboxTransport(call, { secureTransport: true });
  expect((await secure.request('/api/accounts', 'POST', JSON.stringify({ ...form, imap_skip_tls_verify: true }))).status).toBe(422);
  expect(calls).toHaveLength(0);
  expect((await secure.request('//evil.example/api/accounts')).status).toBe(400);
  expect((await secure.request('/api/mail/send', 'POST', '{}')).status).toBe(409);
  expect(calls).toHaveLength(0);
});

test('mount cancellation rejects a late account result without returning stale data', async () => {
  const controller = new AbortController();
  let release;
  const transport = createMailboxTransport(() => new Promise(resolve => { release = resolve; }), { signal: controller.signal });
  const pending = transport.request('/api/accounts');
  controller.abort();
  release(result({ items: [account] }));
  const response = await pending;
  expect(response.status).toBe(409);
  expect(JSON.stringify(response)).not.toContain(account.address);
});

const providerFolders = [
  { id: 'inbox-id', parentFolderId: null, displayName: 'Inkorg', childFolderCount: 0, unreadItemCount: 5, totalItemCount: 60 },
  { id: 'sent-id', parentFolderId: null, displayName: 'Skickade objekt', childFolderCount: 0, unreadItemCount: 0, totalItemCount: 0 },
  { id: 'draft-id', parentFolderId: null, displayName: 'Utkast', childFolderCount: 0, unreadItemCount: 0, totalItemCount: 0 },
  { id: 'parent-id', parentFolderId: null, displayName: 'Kunder', childFolderCount: 1, unreadItemCount: 0, totalItemCount: 0 },
];
const providerMessage = (n = 0) => ({ id: 'provider-message-' + n, conversationId: 'conversation', revisionHash: 'verified-revision', folderId: 'inbox-id',
  isDraft: false, isRead: n >= 5, subject: 'Meddelande ' + n, from: 'sender@example.test', to: [account.address], cc: [], bcc: [],
  receivedAt: new Date(Date.UTC(2026, 9, 9, 12, 0) - n * 60000).toISOString(), sentAt: null, hasAttachments: false });

test('native manual sync controls reach the same bounded provider flow for inbox and the selected folder',async()=>{
 const calls=[];
 const t=createMailboxTransport(async(action,input)=>{
  calls.push([action,input]);
  if(action==='accounts')return result({items:[account]});
  if(action==='folders')return result({items:providerFolders.slice(0,3),nextCursor:null,wellKnown:{inbox:'inbox-id',drafts:'draft-id',sentitems:'sent-id'}});
  if(action==='sync-status')return result({checkpointRevision:'checkpoint'});
  if(action==='sync-step')return result({state:'current',lastError:null});
  throw Error('unexpected provider action');
 });
 const id=(await t.request('/api/accounts')).body[0].id;
 for(const [route,body] of [['sync',{accountId:id}],['sync-folder',{accountId:id,folder:'Drafts'}],['sync-folders',{}]]){
  const value=await t.request('/api/mail/'+route,'POST',JSON.stringify(body));expect(value.status).toBe(200);expect(value.body.items[0].state).toBe('current');
 }
 expect(calls.filter(c=>c[0]==='sync-step').map(c=>c[1].folderId)).toEqual(['inbox-id','draft-id','inbox-id']);
 expect((await t.request('/api/mail/sync-folder','POST',JSON.stringify({folder:'Drafts'}))).status).toBe(409);
 expect((await t.request('/api/mail/sync','POST',JSON.stringify({privateEndpoint:'unexpected'}))).status).toBe(409);
});

test('native folder views keep locale-independent roles and collect paginated roots and children', async () => {
  const calls = [];
  const transport = createMailboxTransport(async (action, input) => {
    calls.push([action, input]);
    if (action === 'accounts') return result({ items: [account] });
    if (input.parentFolderId) return result({ items: [{ id: 'child-id', parentFolderId: 'parent-id', displayName: 'September', childFolderCount: 0, unreadItemCount: 0, totalItemCount: 0 }], nextCursor: null });
    return result({ items: input.cursor ? providerFolders.slice(2) : providerFolders.slice(0, 2), nextCursor: input.cursor ? null : 'second-root-page', wellKnown: { inbox: 'inbox-id', sentitems: 'sent-id', drafts: 'draft-id' } });
  });
  const id = (await transport.request('/api/accounts')).body[0].id;
  const response = await transport.request(`/api/accounts/${id}/folders`);
  expect(response.body.map(f => f.path)).toEqual(['INBOX', 'Sent', 'Drafts', 'F-parent-id', 'F-parent-id/F-child-id']);
  expect(response.body.at(-1)).toMatchObject({ name: 'September', parent_label: 'Kunder' });
  expect(folderParentLabel(response.body.at(-1))).toBe('Kunder');
  expect(folderMatchesQuery(response.body.at(-1), 'Kunder')).toBe(true);
  expect(mergeFolderSnapshots(response.body, response.body)).toEqual(response.body);
  expect(calls.some(([action, input]) => action === 'folders' && input.cursor === 'second-root-page')).toBe(true);
  const counts = await transport.request('/api/mail/unread-counts');
  expect(counts.body).toMatchObject({ total: 5, complete: true, byAccount: { [id]: 5 } });
  expect(mergeCountSnapshots(counts.body, counts.body)).toMatchObject({ byAccount: { [id]: 5 } });
});

test('native offsets follow provider cursors without pretending the first page is the whole inbox', async () => {
  const rows = Array.from({ length: 60 }, (_, n) => providerMessage(n));
  const calls = [];
  const transport = createMailboxTransport(async (action, input) => {
    calls.push([action, input]);
    if (action === 'accounts') return result({ items: [account] });
    if (action === 'folders') return result({ items: providerFolders.map(f => ({ ...f, childFolderCount: 0 })), nextCursor: null, wellKnown: { inbox: 'inbox-id', sentitems: 'sent-id', drafts: 'draft-id' } });
    const start = Number(input.cursor || 0);
    return result({ items: rows.slice(start, start + 20), nextCursor: start + 20 < rows.length ? String(start + 20) : null });
  });
  const id = (await transport.request('/api/accounts')).body[0].id;
  const first = await transport.request(`/api/mail/messages?accountId=${id}&folder=INBOX&limit=10`);
  expect(first.body).toMatchObject({ total: null, hasMore: true, complete: false });
  expect(first.body.messages.map(m => m.subject)).toEqual(rows.slice(0, 10).map(m => m.subject));
  const later = await transport.request(`/api/mail/messages?accountId=${id}&folder=INBOX&limit=10&offset=50`);
  expect(later.body).toMatchObject({ total: 60, hasMore: false, complete: true });
  expect(later.body.messages.map(m => m.subject)).toEqual(rows.slice(50).map(m => m.subject));
  expect(calls.filter(([action]) => action === 'browse').map(([, input]) => input.cursor)).toEqual([undefined, '20', '40']);
  const filtered = await transport.request(`/api/mail/messages?accountId=${id}&unreadOnly=true&limit=10`);
  expect(filtered.body.messages).toHaveLength(5);
  expect(filtered.body).toMatchObject({ total: 5, hasMore: false });
  const search = await transport.request(`/api/search?accountId=${id}&q=syntetisk&limit=10`);
  expect(search.body).toMatchObject({ coverage: 'provider_search_limit', hasMore: true });
});

test('unified messages and thread IDs remain account-bound even when providers reuse IDs', async () => {
  const second = { ...account, address: 'second@example.test', binding: { ...account.binding, mailboxId: 'second-mailbox', connectionId: 'second-connection' } };
  const details = [];
  const transport = createMailboxTransport(async (action, input) => {
    if (action === 'accounts') return result({ items: [account, second] });
    if (action === 'folders') return result({ items: providerFolders.map(f => ({ ...f, childFolderCount: 0 })), wellKnown: { inbox: 'inbox-id' }, nextCursor: null });
    if (action === 'message') { details.push(input); return result({ ...providerMessage(), attachments: [], body: { contentType: 'text', content: 'Verifierad text' } }); }
    return result({ items: [providerMessage()], nextCursor: null });
  });
  await transport.inventory();
  const rows = (await transport.request('/api/mail/messages')).body.messages;
  expect(new Set(rows.map(m => m.id)).size).toBe(2);
  expect(new Set(rows.map(m => m.thread_id)).size).toBe(2);
  for (const row of rows) await transport.request(`/api/mail/messages/${row.id}/body`);
  expect(new Set(details.map(d => d.mailbox.mailboxId))).toEqual(new Set(['mailbox', 'second-mailbox']));
});

test('provider text is escaped and attachment download uses a freshly verified message revision', async () => {
  const calls = [];
  const transport = createMailboxTransport(async (action, input) => {
    calls.push([action, input]);
    if (action === 'accounts') return result({ items: [account] });
    if (action === 'folders') return result({ items: providerFolders.map(f => ({ ...f, childFolderCount: 0 })), wellKnown: { inbox: 'inbox-id' }, nextCursor: null });
    if (action === 'browse') return result({ items: [providerMessage()], nextCursor: null });
    if (action === 'message') return result({ ...providerMessage(), body: { contentType: 'text', content: '<img src=x onerror=alert(1)> & text' }, attachments: [{ id: 'attachment-id', name: 'test.txt', type: 'file', size: 4 }] });
    return result({ bytesBase64: btoa('test'), byteLength: 4 });
  });
  await transport.inventory();
  const id = (await transport.request('/api/mail/messages')).body.messages[0].id;
  const body = await transport.request(`/api/mail/messages/${id}/body`);
  expect(body.body.html).toContain('&lt;img');
  expect(body.body.html).not.toContain('<img');
  const file = await transport.request(`/api/mail/messages/${id}/attachments/attachment-id`);
  expect(file).toMatchObject({ status: 200, bytes: [116, 101, 115, 116], contentType: 'application/octet-stream' });
  expect(calls.at(-1)).toEqual(['attachment', { mailbox: { mailboxId: 'mailbox', connectionId: 'connection', generation: 'generation-1', scopeRevision: 'scope-1' }, messageId: 'provider-message-0', attachmentId: 'attachment-id', expectedRevisionHash: 'verified-revision' }]);
  expect((await transport.request(`/api/mail/messages/${id}/attachments/unknown`)).status).toBe(404);
});

function mutationProvider(mode = 'saved') {
  let message = providerMessage(), writeCount = 0;
  const calls = [], items = [...providerFolders.map(f => ({ ...f, childFolderCount: 0 })),
    { id: 'archive-id', displayName: 'Arkiv', childFolderCount: 0, unreadItemCount: 0, totalItemCount: 0 },
    { id: 'trash-id', displayName: 'Borttaget', childFolderCount: 0, unreadItemCount: 0, totalItemCount: 0 }];
  const transport = createMailboxTransport(async (action, input) => {
    calls.push([action, input]);
    if (action === 'accounts') return result({ items: [account] });
    if (action === 'folders') return result({ items, nextCursor: null, wellKnown: { inbox: 'inbox-id', archive: 'archive-id', deleteditems: 'trash-id' } });
    if (action === 'browse') return result({ items: [message], nextCursor: null });
    if (action === 'message') return result(message);
    if (action === 'operation-outcome') return result({ operationId: input.operationId, state: 'indeterminate' });
    if (['set-read', 'move'].includes(action)) {
      writeCount++;
      const operation = { operationId: input.operationId, state: mode === 'saved' ? 'provider_saved' : 'indeterminate', providerMessageId: message.id };
      if (mode !== 'saved') return result({ operation });
      expect(input.expectedRevisionHash).toBe(message.revisionHash);
      message = { ...message, revisionHash: 'revision-' + writeCount, ...(action === 'move' ? { folderId: input.destinationFolderId } : { isRead: input.isRead }) };
      return result({ operation, message });
    }
    throw new Error('Unexpected action ' + action);
  });
  return { transport, calls };
}

test('native read, archive and trash actions use verified journaled mutations without changing message identity', async () => {
  const { transport, calls } = mutationProvider();
  await transport.inventory();
  const id = (await transport.request('/api/mail/messages')).body.messages[0].id;
  expect((await transport.request('/api/mail/messages/bulk-read', 'POST', JSON.stringify({ ids: [id], read: true }))).body).toMatchObject({ ok: true, read: [id] });
  expect((await transport.request('/api/mail/messages/bulk-archive', 'POST', JSON.stringify({ ids: [id] }))).body.moved).toEqual([id]);
  expect((await transport.request(`/api/mail/messages/${id}`, 'DELETE')).body.deleted).toEqual([id]);
  expect((await transport.request(`/api/mail/messages/${id}`, 'DELETE')).status).toBe(422);
  expect((await transport.request('/api/mail/messages/bulk-delete', 'POST', JSON.stringify({ ids: [id] }))).status).toBe(422);
  expect(calls.filter(([a]) => ['move', 'set-read'].includes(a)).map(([a, input]) => [a, input.destinationFolderId || input.isRead])).toEqual([['set-read', true], ['move', 'archive-id'], ['move', 'trash-id']]);
  expect((await transport.request(`/api/mail/messages/${id}`)).body.id).toBe(id);
});

test('uncertain mutation retries only read the stored outcome and never dispatch another provider write', async () => {
  const { transport, calls } = mutationProvider('indeterminate');
  await transport.inventory();
  const id = (await transport.request('/api/mail/messages')).body.messages[0].id;
  const input = JSON.stringify({ ids: [id], read: true });
  expect((await transport.request('/api/mail/messages/bulk-read', 'POST', input)).status).toBe(409);
  expect((await transport.request('/api/mail/messages/bulk-read', 'POST', input)).status).toBe(409);
  const writes = calls.filter(([a]) => a === 'set-read'), outcomes = calls.filter(([a]) => a === 'operation-outcome');
  expect(writes).toHaveLength(1);
  expect(outcomes).toHaveLength(1);
  expect(outcomes[0][1].operationId).toBe(writes[0][1].operationId);
});

test('unverified destination folders and malformed read flags cannot cause provider mutations', async () => {
  const { transport, calls } = mutationProvider();
  await transport.inventory();
  const id = (await transport.request('/api/mail/messages')).body.messages[0].id;
  expect((await transport.request('/api/mail/messages/bulk-move', 'POST', JSON.stringify({ ids: [id], folder: 'guessed-provider-folder' }))).status).toBe(409);
  expect((await transport.request('/api/mail/messages/bulk-read', 'POST', JSON.stringify({ ids: [id], read: 'true' }))).status).toBe(409);
  expect(calls.filter(([a]) => ['move', 'set-read'].includes(a))).toHaveLength(0);
});
