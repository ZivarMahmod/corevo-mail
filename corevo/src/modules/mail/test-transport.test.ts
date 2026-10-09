import {it,expect} from 'vitest';
import {createMailTestTransport} from './test-transport.mjs';

it('confines fixture changes to a mount and cannot send or access another host',()=>{
 const a=createMailTestTransport(),b=createMailTestTransport();
 const result=a.request('/api/mail/messages?folder=INBOX');
 result.body.messages[0].subject='mutated';
 expect(a.request('/api/mail/messages?folder=INBOX').body.messages[0].subject).toContain('Testdata');
 expect(a.request('/api/mail/send','POST','{}').status).toBe(409);
 expect(a.request('https://evil.invalid/api/accounts').status).toBe(400);
 expect(a.request('/api/mail/draft','POST','{').status).toBe(400);
 expect(a.request('/api/unknown').status).toBe(501);
 expect(a.request('/api/accounts').body[0].email_address).toBe('konsult@example.test');
 a.request('/api/mail/draft','POST',JSON.stringify({subject:'Only A',text:'synthetic'}));
 expect(a.request('/api/mail/messages?folder=Drafts').body.total).toBe(1);
 expect(b.request('/api/mail/messages?folder=Drafts').body.total).toBe(0);
 const draft=a.request('/api/mail/messages?folder=Drafts').body.messages[0];
 a.request('/api/mail/draft/'+draft.uid,'DELETE');
 expect(a.request('/api/mail/messages?folder=Drafts').body.total).toBe(0);
 expect(new TextDecoder().decode(new Uint8Array(a.request('/api/mail/messages/corevo-message-1/attachments/1.2').bytes))).toContain('syntetisk testbilaga');
 a.dispose();expect(a.request('/api/accounts').status).toBe(410);
 expect(b.request('/api/accounts').status).toBe(200);b.dispose();
});
