// @vitest-environment jsdom
import { test, expect, vi } from 'vitest';
import { api } from '../../../vendor/mailflow/frontend/src/utils/api.js';
import { corevoFetch } from '../../../vendor/mailflow/frontend/src/utils/corevoTransport.js';
vi.mock('../../../vendor/mailflow/frontend/src/utils/corevoTransport.js', () => ({ corevoFetch: vi.fn() }));

test('native body API preserves safe rich mail and removes active content and remote resources before reading or quoting', async () => {
  (window as any).corevoMailHosted = true;
  const html = '<style>@import url(https://tracker.example/style)</style><script>alert(1)</script><iframe src="https://tracker.example/frame"></iframe><form action="https://tracker.example/form"><input value="private"></form><p style="color:red;background-image:url(https://tracker.example/bg);font-weight:bold"><strong>Synthetic</strong></p><img src="https://tracker.example/pixel" srcset="https://tracker.example/pixel 2x" onerror="alert(1)"><a href="javascript:alert(1)">unsafe</a><a href="https://safe.example/">safe</a><img src="data:image/svg+xml;base64,PHN2Zy8+">';
  vi.mocked(corevoFetch).mockResolvedValue(new Response(JSON.stringify({ text: 'Synthetic', html }), { headers: { 'content-type': 'application/json' } }));
  const body = await api.getMessageBody('synthetic-security-test');
  expect(body.text).toBe('Synthetic');
  expect(body.html).toContain('<strong>Synthetic</strong>');
  const doc = new DOMParser().parseFromString(body.html, 'text/html');
  expect(doc.querySelector('p')!.style.color).toBe('red');
  expect(doc.querySelector('p')!.style.fontWeight).toBe('bold');
  expect(doc.querySelector('p')!.style.backgroundImage).toBe('');
  expect(doc.querySelectorAll('script,iframe,form,style,input,object')).toHaveLength(0);
  expect(body.html).not.toMatch(/tracker\.example|onerror|javascript:|svg\+xml|srcset/);
  expect(doc.querySelector('a[href]')!.getAttribute('rel')).toBe('noopener noreferrer');
  delete (window as any).corevoMailHosted;
});
