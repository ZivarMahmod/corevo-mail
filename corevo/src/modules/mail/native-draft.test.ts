import { test, expect } from 'vitest';
import { createMailboxTransport } from './mailbox-transport.mjs';
import { mailboxUUID } from './mailbox-uuid.mjs';
const account = { binding: { tenantId: 'tenant', ownerUserId: 'owner', mailboxId: 'mailbox', connectionId: 'connection', generation: 'generation', scopeRevision: 'scope' }, address: 'owner@example.test', provider: 'microsoft_graph', status: 'connected', capabilities: { read: true, draftWrite: true, send: true } };
const envelope = data => ({ schemaVersion: 'personal-mailbox-v1', data });
function fixture() {
  const persisted = new Map(), storage = { getItem: key => persisted.get(key) || null, setItem: (key, value) => persisted.set(key, value) };
  let current, revision = 0, lost = false, unresolved = false, fileId = 0;
  const fileContents = new Map();
  const calls = [], outcomes = new Map(), folders = [{ id: 'drafts', displayName: 'Utkast', parentFolderId: null, childFolderCount: 0, unreadItemCount: 0, totalItemCount: 0 }];
  const call = async (action, input) => {
    calls.push([action, input]);
    if (action === 'accounts') return envelope({ items: [account] });
    if (action === 'folders') return envelope({ items: folders, nextCursor: null, wellKnown: { drafts: 'drafts' } });
    if (action === 'message') { expect(input.messageId).toBe('provider-draft'); return envelope(structuredClone(current)); }
    if (action === 'attachment') { const file = fileContents.get(input.attachmentId); expect(input.expectedRevisionHash).toBe(current.revisionHash); return envelope({ name: file.name, bytesBase64: file.bytesBase64, byteLength: 5, messageRevisionHash: current.revisionHash }); }
    if (action === 'operation-outcome') return envelope(unresolved ? { ...outcomes.get(input.operationId), state: 'indeterminate' } : outcomes.get(input.operationId));
    expect(JSON.stringify([...persisted.values()])).toContain(input.operationId);
    if (['draft-save', 'draft-attachment-add', 'draft-attachment-remove', 'send'].includes(action)) {
      if (input.expectedRevisionHash !== current.revisionHash) return { error: { code: 'revision_conflict' } };
    }
    if (action === 'send') {
      expect(input.expectedContentDigest).toBe(current.contentDigest);
      current.isDraft = false;
    } else {
      const content = input.content || (current ? { to: current.to, cc: current.cc, bcc: current.bcc, subject: current.subject, body: current.body.content, bodyHtml: current.body.html } : { to: [], cc: [], bcc: [], subject: 'Re: Synthetic', body: 'Quote' });
      const attachments = current?.attachments || [];
      if (action === 'draft-attachment-add') { const id = 'attachment-' + fileId++; fileContents.set(id, input.file); attachments.push({ id, name: input.file.name, size: 5, type: 'file' }); }
      if (action === 'draft-attachment-remove') { const index = attachments.findIndex(a => a.id === input.attachmentId); expect(index).toBeGreaterThanOrEqual(0); attachments.splice(index, 1); fileContents.delete(input.attachmentId); }
      current = { id: 'provider-draft', conversationId: 'thread', folderId: 'drafts', isDraft: true, isRead: true, subject: content.subject, from: account.address, to: content.to, cc: content.cc, bcc: content.bcc, revisionHash: String(++revision).padStart(64, '0'), hasAttachments: attachments.length > 0, body: { contentType: 'text', content: content.body, ...(content.bodyHtml ? { html: content.bodyHtml } : {}) }, attachments, contentDigest: 'a'.repeat(64) };
    }
    const operation = { operationId: input.operationId, kind: action, state: action === 'send' ? 'provider_accepted' : 'provider_saved', providerMessageId: current.id, providerRevisionHash: current.revisionHash, ...(action === 'draft-attachment-add' ? { attachmentId: current.attachments.at(-1).id } : {}) }; outcomes.set(input.operationId, operation);
    if (lost) { lost = false; throw Object.assign(new Error(), { code: 'operation_indeterminate' }); }
    return envelope({ operation });
  };
  const mount = () => createMailboxTransport(call, { storage });
  return { mount, calls, persisted, lose: () => { lost = true; unresolved = true; }, resolve: () => { unresolved = false; }, change: () => { current.revisionHash = 'f'.repeat(64); } };
}
const content = { to: ['recipient@example.test'], cc: [], bcc: [], subject: 'Synthetic', body: 'Reply', bodyHtml: '<p><strong>Reply</strong></p>' };
async function form(transport) { const [a] = await transport.inventory(); return { accountId: a.id, corevoComposeId: mailboxUUID(), corevoKind: 'compose', corevoContent: content }; }
const save = (transport, body) => transport.request('/api/mail/draft', 'POST', JSON.stringify(body));

test('native attachment edits retain the second upload without duplication and remove the first at the provider', async () => {
  const f = fixture(), t = f.mount(), body = await form(t);
  const files = ['one.txt', 'two.txt'].map(filename => ({ filename, content: 'SGVsbG8=', contentType: 'text/plain' }));
  const first = await save(t, { ...body, attachments: files }); expect(first.status).toBe(200);
  const edited = { ...body, existingUid: first.body.uid, existingFolder: first.body.folder, existingAccountId: body.accountId, attachments: files.slice(1) };
  expect((await save(t, edited)).status).toBe(200);
  expect(f.calls.filter(c => c[0] === 'draft-attachment-add')).toHaveLength(2);
  expect(f.calls.filter(c => c[0] === 'draft-attachment-remove')).toHaveLength(1);
  const read = await t.request('/api/mail/messages/' + first.body.uid + '/body');
  expect(read.body.attachments.map(a => a.filename)).toEqual(['two.txt']);
  const reopened = { ...edited, attachments: [], forwardedAttachments: [{ messageId: first.body.uid, part: read.body.attachments[0].part }] };
  expect((await save(t, reopened)).status).toBe(200);
  expect(f.calls.filter(c => c[0] === 'draft-attachment-add')).toHaveLength(2);
  expect((await save(t, { ...reopened, forwardedAttachments: [] })).status).toBe(200);
  expect((await t.request('/api/mail/messages/' + first.body.uid + '/body')).body.attachments).toEqual([]);
});

test('a lost attachment-removal response recovers the same operation before saving further edits', async () => {
  const f = fixture(), t = f.mount(), body = await form(t);
  const first = await save(t, { ...body, attachments: [{ filename: 'one.txt', content: 'SGVsbG8=', contentType: 'text/plain' }] });
  const edited = { ...body, existingUid: first.body.uid, existingFolder: first.body.folder, existingAccountId: body.accountId };
  const original = f.calls.length;
  // Lose the removal response rather than the preceding content save.
  const intercept = f.calls.push.bind(f.calls);
  f.calls.push = (...items) => { if (items.some(item => item[0] === 'draft-attachment-remove')) f.lose(); return intercept(...items); };
  expect((await save(t, edited)).status).toBe(409);
  f.calls.push = intercept; f.resolve();
  expect((await save(t, { ...edited, corevoContent: { ...content, body: 'Still here' } })).status).toBe(200);
  expect(f.calls.slice(original).filter(c => c[0] === 'draft-attachment-remove')).toHaveLength(1);
  expect((await t.request('/api/mail/messages/' + first.body.uid + '/body')).body).toMatchObject({ text: 'Still here', attachments: [] });
});

test('native drafts use the provider identity, keep rich text and preserve the editor revision', async () => {
  const f = fixture(), t = f.mount(), body = await form(t), first = await save(t, body);
  expect(first.status).toBe(200); expect(first.body).toMatchObject({ folder: 'Drafts', accountId: body.accountId, storage: 'provider' });
  const edited = { ...body, existingUid: first.body.uid, existingFolder: first.body.folder, existingAccountId: body.accountId, corevoContent: { ...content, body: 'Edited', bodyHtml: '<p>Edited</p>' } };
  expect((await save(t, edited)).status).toBe(200);
  expect(f.calls.filter(c => c[0] === 'draft-create')).toHaveLength(1);
  expect(f.calls.find(c => c[0] === 'draft-save')[1].content.bodyHtml).toBe('<p>Edited</p>');
  expect(JSON.stringify([...f.persisted.values()])).not.toMatch(/recipient@example|Reply|<p>|bodyHtml/);
  f.change(); expect((await save(t, edited)).status).toBe(409);
});
test('unknown draft creation survives remount, never duplicates the draft, and applies newly typed text only after recovery', async () => {
  const f = fixture(), t = f.mount(), body = await form(t); f.lose(); expect((await save(t, body)).status).toBe(409); t.dispose();
  const reopened = f.mount(); await reopened.inventory();
  expect((await save(reopened, body)).status).toBe(409); expect(f.calls.filter(c => c[0] === 'draft-create')).toHaveLength(1);
  f.resolve(); const recovered = await save(reopened, { ...body, corevoContent: { ...content, body: 'New text', bodyHtml: '<p>New text</p>' } });
  expect(recovered.status).toBe(200); expect(f.calls.filter(c => c[0] === 'draft-create')).toHaveLength(1);
  expect(f.calls.find(c => c[0] === 'draft-save')[1].content.body).toBe('New text');
});
test('missing durable storage, aliases, attachments and unknown draft identities cannot cause a new provider write', async () => {
  const f = fixture(), t = f.mount(), body = await form(t);
  for (const extra of [{ aliasId: 'unsupported' }, { attachments: [{ filename: 'a.txt' }] }, { existingUid: 'not-owned' }]) expect((await save(t, { ...body, ...extra })).status).not.toBe(200);
  const blocked = createMailboxTransport(async action => action === 'accounts' ? envelope({ items: [account] }) : (() => { throw Error('unexpected write'); })()); await blocked.inventory();
  expect((await save(blocked, body)).body.error).toContain('identifierare');
  expect(f.calls.filter(c => c[0].startsWith('draft-'))).toHaveLength(0);
});

test('verified local attachments survive repeated draft saves without duplicate uploads or private bytes in the operation journal', async () => {
  const f = fixture(), t = f.mount(), body = { ...await form(t), attachments: [{ filename: 'proof.txt', content: btoa('proof'), contentType: 'text/plain' }] };
  const first = await save(t, body); expect(first.status).toBe(200);
  const again = await save(t, { ...body, existingUid: first.body.uid, existingFolder: first.body.folder, existingAccountId: body.accountId }); expect(again.status).toBe(200);
  expect(f.calls.filter(c => c[0] === 'draft-attachment-add')).toHaveLength(1);
  const read = await t.request('/api/mail/messages/' + again.body.uid + '/body'); expect(read.body.attachments).toHaveLength(1); expect(read.body.attachments_complete).toBe(true);
  expect(JSON.stringify([...f.persisted.values()])).not.toMatch(/proof\.txt|cHJvb2Y=|recipient@example/);
});

test('review saves and reads the actual draft but only explicit approval can send unchanged content', async () => {
  const f = fixture(), t = f.mount(), body = await form(t);
  const review = await t.request('/api/mail/review', 'POST', JSON.stringify(body)); expect(review.status).toBe(200);
  expect(review.body).toMatchObject({ to: content.to, text: content.body, delivery: 'not_sent' }); expect(f.calls.some(c => c[0] === 'send')).toBe(false);
  const send = input => t.request('/api/mail/send', 'POST', JSON.stringify(input));
  expect((await send(body)).status).toBe(409);
  expect((await send({ ...body, corevoReviewId: review.body.reviewId, corevoContent: { ...content, to: ['changed@example.test'] } })).status).toBe(409);
  expect((await send({ ...body, corevoReviewId: review.body.reviewId })).body).toMatchObject({ ok: true, providerAccepted: true, sentObserved: false, delivery: 'unknown' });
  expect(f.calls.filter(c => c[0] === 'send')).toHaveLength(1);
});

test('a lost send response is recovered through the same operation and never dispatches twice', async () => {
  const f = fixture(), t = f.mount(), body = await form(t), review = await t.request('/api/mail/review', 'POST', JSON.stringify(body));
  const approved = { ...body, corevoReviewId: review.body.reviewId }; f.lose();
  expect((await t.request('/api/mail/send', 'POST', JSON.stringify(approved))).status).toBe(409);
  expect((await t.request('/api/mail/send', 'POST', JSON.stringify(approved))).status).toBe(409);
  f.resolve(); expect((await t.request('/api/mail/send', 'POST', JSON.stringify(approved))).status).toBe(200);
  expect(f.calls.filter(c => c[0] === 'send')).toHaveLength(1); expect(f.calls.filter(c => c[0] === 'operation-outcome')).toHaveLength(2);
  const reopened = f.mount(); await reopened.inventory(); expect((await reopened.request('/api/mail/send', 'POST', JSON.stringify(approved))).status).toBe(409);
  expect(f.calls.filter(c => c[0] === 'send')).toHaveLength(1);
});
