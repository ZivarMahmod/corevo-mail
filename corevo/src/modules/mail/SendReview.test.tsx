import { test, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import SendReview from './SendReview.jsx';
test('manual send review shows the provider draft and escaped recipients, body and files before the explicit send button', () => {
  const html = renderToStaticMarkup(<SendReview review={{ from: 'sender@example.test', to: ['recipient@example.test'], cc: [], bcc: ['hidden@example.test'], subject: '<script>not code</script>', text: '<img src=x onerror=alert(1)>', attachments: [{ name: '<b>proof.txt</b>', size: 1000 }] }} busy={false} error="" onCancel={() => {}} onSend={() => {}} />);
  expect(html).toContain('Bekräfta och skicka'); expect(html).toContain('Hemlig kopia'); expect(html).toContain('hidden@example.test');
  expect(html).not.toContain('<script>'); expect(html).not.toContain('<img'); expect(html).toContain('&lt;b&gt;proof.txt&lt;/b&gt;');
  expect(html).toContain('Utkastet är sparat hos leverantören');
});
