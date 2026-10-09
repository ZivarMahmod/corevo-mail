# Corevo Mail

This public fork preserves MailFlow's AGPL-3.0 license and original copyright/attribution. The upstream project is https://github.com/maathimself/mailflow, pinned for this port at `677553f3a9d4d4507cd8ec29b542164a1366948a`.

Corevo Mail incorporates the actual MailFlow client source into an existing host application. It uses no separate MailFlow server, database, login or runtime GitHub connection. The modified upstream frontend files are in `frontend/src`; the complete, independently rebuildable module source is in `corevo/`, matching the local Corevo source export. `main` is the official open version. External changes are reviewed before merging; forks are independent of Corevo's deployed copy.

## Current milestone

U2: original inbox/navigation, lists/reading, rich composition, attachments, preferences and helpers are incorporated. Demonstration data is explicit, transient and synthetic. Sending is refused. This is not a claim of completed Graph/Gmail/IMAP connections. Corevo's existing provider services will be connected in U3–U8 without replacing working client implementations.

## Rebuild without the private Corevo repository

Linux, Node 22+ and GNU tar:

```sh
cd corevo
npm ci --ignore-scripts
npm run build
npm test
```

The result is static client assets. A compatible host serves them and implements the documented message/API interface (`corevo/src/modules/mail/HOST.md`). The client's own bootstrap cannot access mail without a host's authority check. No MailFlow server or background service is installed by this build.

The source archive offered in the UI is generated from the same module files and preserves the original notices and Inter font license. Corevo-specific modifications are recorded in `corevo/vendor/mailflow/UPSTREAM.md`. The private platform, configuration, credentials and customer data are not included in this repository.

The build rejects imports of private platform modules into the client's static/dynamic dependency closure. That is a technical check, not a legal opinion that an iframe/API alone determines combined-work scope. AGPL license/source rights apply to this module; no additional restriction is imposed on downstream modification.
