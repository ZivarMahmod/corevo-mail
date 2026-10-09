// AGPL-3.0: review the provider's saved draft before Corevo's manual send.
import { useEffect, useRef } from 'react';
export default function SendReview({ review, busy, error, onCancel, onSend }) {
  const dialog = useRef(null);
  useEffect(() => { dialog.current.showModal(); }, []);
  return <dialog ref={dialog} aria-labelledby="corevo-send-review-title" onCancel={e => { e.preventDefault(); if (!busy) onCancel(); }}
    style={{ width: 'min(560px,calc(100vw - 32px))', maxHeight: 'calc(100vh - 32px)', overflow: 'auto', padding: 24, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', boxShadow: 'var(--shadow-modal)' }}>
    <h2 id="corevo-send-review-title" style={{ fontSize: 18 }}>Granska innan du skickar</h2>
    <dl>{[['Från', review.from], ['Till', review.to.join(', ')], ['Kopia', review.cc.join(', ')], ['Hemlig kopia', review.bcc.join(', ')], ['Ämne', review.subject || '(Utan ämne)']].filter(([, value]) => value).map(([label, value]) => <div key={label} style={{ marginBottom: 8 }}><dt style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{label}</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{value}</dd></div>)}</dl>
    <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', font: 'inherit', maxHeight: '32vh', overflow: 'auto', padding: 12, background: 'var(--bg-secondary)' }}>{review.text}</pre>
    <p>{review.attachments.length ? 'Bilagor: ' + review.attachments.map(a => `${a.name} (${Math.ceil(a.size / 1024)} kB)`).join(', ') : 'Inga bilagor'}</p>
    <p style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Utkastet är sparat hos leverantören. Mejlet skickas först när du bekräftar nedan.</p>
    {error && <p role="alert">{error}</p>}
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
      <button type="button" disabled={busy} onClick={onCancel} className="btn-secondary">Fortsätt redigera</button>
      <button type="button" disabled={busy} onClick={onSend} className="btn-primary">{busy ? 'Kontrollerar utskicket…' : 'Bekräfta och skicka'}</button>
    </div>
  </dialog>;
}
