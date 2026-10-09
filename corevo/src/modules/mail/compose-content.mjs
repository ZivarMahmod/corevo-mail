// AGPL-3.0; adapted from MailFlow backend/src/routes/{draft,send}.js at 677553f3a9d4d4507cd8ec29b542164a1366948a.
// Keep MailFlow's body/signature/quote assembly; use the installed browser sanitizer instead of its server package.
import DOMPurify from 'dompurify';
const escapeHtml = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function textToHtml(text) {
  return '<div style="font-family:sans-serif;font-size:14px;line-height:1.6">' +
    text.split('\n').map(l => `<p style="margin:0">${escapeHtml(l) || '&nbsp;'}</p>`).join('') + '</div>';
}
function plain(html) {
  const clean = DOMPurify.sanitize(html, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
  return new DOMParser().parseFromString(clean, 'text/html').body.textContent || '';
}
// MailFlow's RFC 5322 recipient forms are normalized to Corevo's bounded address arrays.
function address(value) {
  if (typeof value !== 'string' || /[\r\n\0]/.test(value)) throw new Error('Ogiltig mottagaradress.');
  const match = value.match(/^(?:.+?\s*)?<([^>]+)>\s*$/);
  return (match ? match[1] : value).trim();
}
export function composeContent(data) {
  const raw = data.body || '', signature = data.editedSignature ? DOMPurify.sanitize(data.editedSignature) : '';
  const bodyText = data.bodyIsHtml ? plain(raw) : raw, sigText = signature ? plain(signature).trim() : '';
  const body = sigText ? `${bodyText}\n\n-- \n${sigText}${data.quotedBody || ''}` : `${bodyText}${data.quotedBody || ''}`;
  const rawHtml = (data.bodyIsHtml ? DOMPurify.sanitize(raw) : textToHtml(raw)) +
    (signature ? `<div data-mailflow-signature="1" style="margin-top:16px;color:#555;font-size:13px">${signature}</div>` : '') +
    (data.quotedBodyHtml || (data.quotedBody ? textToHtml(data.quotedBody) : ''));
  return { to: (data.to || []).map(address), cc: (data.cc || []).map(address), bcc: (data.bcc || []).map(address),
    subject: data.subject || '', body, ...(data.bodyIsHtml ? { bodyHtml: DOMPurify.sanitize(rawHtml) } : {}) };
}
