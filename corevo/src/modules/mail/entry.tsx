import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import clientCss from 'virtual:corevo-mail-css';
import { connectCorevoHost, corevoFetch } from '../../../vendor/mailflow/frontend/src/utils/corevoTransport.js';

const host = document.getElementById('root')!;
const hostChannel = location.hash.slice(1); // Mobile history must not change the host binding.
// The separate document confines the upstream client's CSS, portals, shortcuts,
// viewport/history and module timers to Corevo's embedded module, with no new service.
connectCorevoHost().then(async context => {
  (window as any).corevoMailHosted = true;
  for (const key of Object.keys(localStorage)) if (key.startsWith('mailflow_')) localStorage.removeItem(key);
  const style = document.createElement('style');
  style.textContent = clientCss + '\n:root{--font-sans:Inter,sans-serif;--font-display:Inter,sans-serif;--font-mono:monospace}body{font-family:Inter,sans-serif}';
  document.head.appendChild(style);
  const [{ default: MailApp }, { useStore }, { default: i18n }, themes] = await Promise.all([
    import('../../../vendor/mailflow/frontend/src/components/MailApp.jsx'),
    import('../../../vendor/mailflow/frontend/src/store/index.js'),
    import('../../../vendor/mailflow/frontend/src/i18n.js'),
    import('../../../vendor/mailflow/frontend/src/themes.js'),
    import('../../../vendor/mailflow/frontend/src/plugins/index.js'),
  ]);
  i18n.addResourceBundle('sv', 'translation', {
    common: { cancel: 'Avbryt', save: 'Spara', delete: 'Ta bort', edit: 'Redigera', add: 'Lägg till', remove: 'Ta bort', back: 'Tillbaka', undo: 'Ångra', view: 'Visa', retry: 'Försök igen', loading: 'Läser in…', saving: 'Sparar…', noSubject: '(utan ämne)', dismiss: 'Stäng', loadMore: 'Visa fler' },
    sidebar: { compose: 'Skriv mejl', allInboxes: 'Alla inkorgar', settings: 'Inställningar', toggleSidebar: 'Visa/dölj mappar', folders: 'Mappar', addAccount: 'Anslut brevlåda' },
    folders: { inbox: 'Inkorg', sent: 'Skickat', drafts: 'Utkast', trash: 'Papperskorg', spam: 'Skräppost', archive: 'Arkiv' },
    compose: { newMessage: context.testData ? 'Nytt mejl – testdata' : 'Nytt mejl', reply: 'Svara', replyAll: 'Svara alla', forward: 'Vidarebefordra', from: 'Från', to: 'Till', subject: 'Ämne', subjectPh: 'Lägg till ämne', bodyPh: 'Skriv ditt mejl…', send: 'Skicka', sending: 'Skickar…', discard: 'Kasta', saveDraft: context.testData ? 'Spara testutkast' : 'Spara utkast', draftSaved: context.testData ? 'Testutkast sparat' : 'Utkast sparat', closeDraft: {title:context.testData?'Spara testutkast?':'Spara utkast?',save:'Spara',discard:'Kasta',keepEditing:'Fortsätt skriva'} },
    message: { selectToRead: 'Välj ett mejl för att läsa' },
  }, true, true);
  await i18n.changeLanguage('sv');
  useStore.getState().setUser(context.user);
  useStore.setState({ theme: context.theme === 'light' ? 'light' : 'dark', selectedAccountId: null, selectedFolder: 'INBOX', fontSize: 100, senderFavicons: false, showFaviconBadge: false, showAppBadge: false, enabledPlugins: [], autoLockMinutes: 0 });
  await useStore.getState().loadPreferences();
  if (context.connectionError) useStore.getState().addNotification({ type: 'error', title: 'Anslut brevlåda', body: context.connectionError });
  themes.applyTheme(context.theme === 'light' ? 'light' : 'dark');
  const palette = context.palette;
  for (const [key, value] of Object.entries(palette || {})) document.documentElement.style.setProperty(key, String(value));
  document.documentElement.style.setProperty('--font-sans', 'Inter, sans-serif');
  document.documentElement.style.setProperty('--font-display', 'Inter, sans-serif');
  const root = createRoot(host);
  const download = async (event: MouseEvent) => {
    const anchor = (event.target as Element)?.closest('a[href]') as HTMLAnchorElement | null;
    if (!anchor) return;
    const url = new URL(anchor.href);
    if (url.origin !== location.origin || !/^\/(api|oauth)(?:\/|$)/.test(url.pathname)) return;
    event.preventDefault();
    try {
      const response = await corevoFetch(url.pathname + url.search);
      if (!response.ok) throw new Error((await response.json()).error);
      const blob = URL.createObjectURL(await response.blob()), link = document.createElement('a');
      link.href = blob; link.download = anchor.download || 'corevo-mail-download'; link.click();
      setTimeout(() => URL.revokeObjectURL(blob), 1000);
    } catch (error) { useStore.getState().addNotification({type:'error',title:'Corevo Mail',body:(error as Error).message}); }
  };
  document.addEventListener('click', download, true);
  const stopEditing = useStore.subscribe(state => parent.postMessage({ channel: hostChannel, type: 'editing', editing: !!state.composing }, location.origin));
  root.render(<MemoryRouter><MailApp /></MemoryRouter>);
  addEventListener('pagehide', () => {
    stopEditing();
    document.removeEventListener('click', download, true);
    root.unmount();
    useStore.getState().setUser(null);
    for (const key of Object.keys(localStorage)) if (key.startsWith('mailflow_')) localStorage.removeItem(key);
  }, { once: true });
}).catch(error => { console.error('Corevo Mail startfel:', error.message); host.textContent = 'Mejlytan kunde inte öppnas. Återgå till Corevo och öppna Mejl igen.'; });
