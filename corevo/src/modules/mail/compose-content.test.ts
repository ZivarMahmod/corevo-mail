// @vitest-environment jsdom
import { test, expect } from 'vitest';
import { composeContent } from './compose-content.mjs';
test('adapted MailFlow composition keeps recipients, formatting, signature marker and quoted reply together', () => {
  const data = { to: ['Example <recipient@example.test>'], cc: [], bcc: [], subject: 'Synthetic', body: '<p><strong>Reply</strong> &amp; text</p>', bodyIsHtml: true, editedSignature: '<p>Signature</p>', quotedBody: '\n\nQuote', quotedBodyHtml: '<blockquote>Quote</blockquote>' };
  const content = composeContent(data);
  expect(content.to).toEqual(['recipient@example.test']);
  expect(content.body).toBe('Reply & text\n\n-- \nSignature\n\nQuote');
  expect(content.bodyHtml).toContain('<strong>Reply</strong>');
  expect(content.bodyHtml).toContain('data-mailflow-signature="1"');
  expect(content.bodyHtml).toContain('<blockquote>Quote</blockquote>');
  expect(composeContent({ ...data, body: 'Plain\nreply', bodyIsHtml: false })).not.toHaveProperty('bodyHtml');
  expect(() => composeContent({ ...data, to: ['evil\r\n@example.test'] })).toThrow('Ogiltig');
});
