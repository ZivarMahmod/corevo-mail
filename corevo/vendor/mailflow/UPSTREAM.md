# Corevo Mail source record

Upstream: https://github.com/maathimself/mailflow

Imported revision: `677553f3a9d4d4507cd8ec29b542164a1366948a` (frontend 3.8.3).

Public fork: https://github.com/ZivarMahmod/corevo-mail

License: AGPL-3.0. Original copyright and license notices remain. Corevo modifications below were made on 2026-10-09. The original commercial-license information is preserved for provenance; Corevo uses the AGPL option.

Imported: `frontend/src` including upstream tests, frontend package/lock manifests, LICENSE and LICENSE-COMMERCIAL. MailApp, Sidebar, MessageList, ReadingPane/MessagePane, ComposeModal, ContactsPage, attachment preview, preferences, rich editor, state and helpers remain actual upstream implementations. Upstream App/login/server/bootstrap are not mounted or built into Corevo's client entry. They are retained in the source record, not used as parallel authentication.

Not imported: upstream server, PostgreSQL/Redis data layer, migrations, Docker, Electron/Android app packaging, original server fonts. Corevo retains its existing backend and permissions; Inter is supplied with its own license. Capacitor core remains a dependency of upstream browser helpers but no native app is installed.

Modified upstream files: utils/api.js and spamApi.js, components/MailApp.jsx, Sidebar.jsx, MessageList.jsx, MessagePane.jsx, AttachmentViewer.jsx, AdminPanel.jsx, BackupSettings.jsx, ErrorBoundary.jsx, and hooks/useWebSocket.js. Local transport replaces direct upstream network calls; the upstream websocket is disabled in the hosted module. Mobile history preserves the embedded module URL/channel. Sidebar branding uses Corevo Mail; attribution is available in About.

Added AGPL module files: utils/corevoTransport.js, the host mount, src/modules/mail entry and fixture transport, module build configuration and source-offer generator. Private backend implementations and unrelated platform files are not copied into the client bundle or this source package.

Current milestone: U2 uses synthetic accounts/messages and in-memory test drafts. Sending and account mutations are refused. Real provider integration remains U3–U8; this source record makes no claim that those connections or the full mail block are complete.

`source-manifest.json` records upstream and incorporated SHA-256 hashes for all 271 imported files. Of these, 260 remain byte-for-byte identical and 11 are adapted; new module/transport files are listed above. Regenerate this record whenever imported source changes.

The embedded document contains styles, portals, viewport, keyboard shortcuts and lifecycle within the existing Corevo workspace. It starts no separate service. A documented message protocol carries mail DTOs between the AGPL client/host adapter and Corevo's existing API; no private JavaScript modules, Supabase client, JWT or credentials are imported into the mail client. The build rejects a dependency edge into private platform source.

Technical separation is not itself a legal opinion about combined-work scope. The user has accepted AGPL source availability for the mail module. Before public production delivery, verify the concrete interface and any backend additions against AGPL sections 1, 5 and 13; a repository boundary alone does not resolve that question.

Rebuild the offered source on Linux with Node 22+ and GNU tar: unpack corevo-mail-source.tar.gz, copy src/modules/mail/package.build.json to package.json, package.build-lock.json to package-lock.json, and vite.config.build.ts to the root vite.config.ts. Run `npm ci --ignore-scripts`, `npm test`, then `npm run build`. All imported client source and build instructions are included. The host interface is described in src/modules/mail/HOST.md. No GitHub or upstream server is needed at runtime. Ordinary npm libraries remain build dependencies.
