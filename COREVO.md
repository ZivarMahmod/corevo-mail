# Corevo Mail

This public fork preserves MailFlow's AGPL-3.0 license and original copyright/attribution. The upstream project is https://github.com/maathimself/mailflow, pinned for this port at `677553f3a9d4d4507cd8ec29b542164a1366948a`.

Corevo Mail incorporates the actual MailFlow client source into an existing host application. It uses no separate MailFlow server, database, login or runtime GitHub connection. The modified upstream frontend files are in `frontend/src`; the complete, independently rebuildable module source is in `corevo/`, matching the local Corevo source export. `main` is the official open version. External changes are reviewed before merging; forks are independent of Corevo's deployed copy.

## Current milestone

U2–U5 are incorporated; U6–U7 are being verified. Normal mounts use the host's verified account inventory and provider connection lifecycle. The actual native client is connected to paginated folders, lists, search, threads, sanitized rich content, attachments, read state, journaled moves and provider drafts. Manual sending has a separate review step and a durable operation identity; uncertain writes are reconciled rather than automatically repeated. Forwarded/saved-draft attachments are reconciled against the provider, including removal. A bounded background sync respects hidden/offline states and the original client's current reading, search and composer.

On 2026-10-09 the protected Dev API's actual HTTPS One.com connection, native adapter reading and provider sync were verified using the explicitly approved test mailbox. Feedback ownership and anonymous/substitution rejection also passed. This does not establish a completed native browser journey or Gmail/Microsoft production connectivity. Gmail OAuth remains unconfigured in this host, and Microsoft requires a fresh completed provider login. Provider search limits are explicit. Remaining settings, advanced operations, durable remount recovery and U8 release checks remain open; the mail block is not marked complete.

The separate U2 demonstration mode remains explicit, transient and synthetic. It refuses sending and never connects a provider. Normal account results do not fall back to demonstration mail when a real connection fails. Unsupported functions fail with an explicit message and perform no provider action.

## Rebuild without the private Corevo repository

Linux, Node 22+ and GNU tar:

```sh
cd corevo
npm ci --ignore-scripts
npm run build
npm test
npm run test:native
```

The result is static client assets. A compatible host serves them and implements the documented message/API interface (`corevo/src/modules/mail/HOST.md`). The client's own bootstrap cannot access mail without a host's authority check. No MailFlow server or background service is installed by this build.

The source archive offered in the UI is generated from the same module files and preserves the original notices and Inter font license. Corevo-specific modifications are recorded in `corevo/vendor/mailflow/UPSTREAM.md`. The private platform, configuration, credentials and customer data are not included in this repository.

The build rejects imports of private platform modules into the client's static/dynamic dependency closure. That is a technical check, not a legal opinion that an iframe/API alone determines combined-work scope. AGPL license/source rights apply to this module; no additional restriction is imposed on downstream modification.

Known build-tool advisories and required release checks are documented in [BUILD-SECURITY.md](corevo/src/modules/mail/BUILD-SECURITY.md). This source checkpoint is not a production release.
