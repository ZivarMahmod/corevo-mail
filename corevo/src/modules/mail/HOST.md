# Corevo Mail host protocol (AGPL-3.0)

The client runs as an embedded same-origin document. Its URL fragment carries a random UUID channel. Both sides check the channel, sender window and exact origin. This is lifecycle/cross-window binding, not an authentication credential or protection against same-origin XSS.

Client sends `ready`; host verifies its existing session and mail authority before replying with `bootstrap`. The context contains a minimal user DTO (id, display name, is_admin=false), theme, palette and testData flag. It never contains credentials, tokens, private configuration or a database client.

Client sends `request` with an integer id, API-style path, method and serialized JSON body. Host replies `response` with the same id, HTTP status and JSON body, or attachment bytes/contentType. The client preserves upstream Response-based handling. CorevoFetch does not patch global fetch.

Client sends `editing` with a boolean to protect composition during host navigation. Closing the view or losing authority destroys the frame, transport state and client storage namespace; stale messages cannot revive it.

The exported host mount currently uses an existing host `CorevoZentum.personalMailbox('accounts', {})` authority check, `CorevoAuth.primarySession()` and `subscribePersonalMailboxContext(listener)`. Those are the public adapter's interface to independently existing host services, not implementations shipped with this client. Only the mount/adapter and this interface definition are included here. Real DTO mappings and provider calls are pending U3–U8. No upstream auth, SQL or websocket server is started.

U2's test transport is an in-memory demonstration. No network and no outbound send exist in it. Synthetic example.test accounts are labelled by the host. Unknown actions fail explicitly; they do not pretend that a provider feature succeeded.

The bundled source offer is generated from an explicit allowlist of the imported client, module, host adapter, build helper, and Inter assets/licenses. The build traverses the client's static/dynamic chunk closure and fails if private platform modules enter it. This establishes a testable technical source boundary; it does not claim a legal exemption solely from an iframe or API.

To rebuild the offered source independently, copy `src/modules/mail/package.build.json` to `package.json`, `package.build-lock.json` to `package-lock.json`, and `vite.config.build.ts` to the root `vite.config.ts`. Run `npm ci`, `npm test`, then `npm run build` with Node 22 or later. The public fork's `corevo/` directory already includes these root copies. No original MailFlow server, Corevo private repository or GitHub connection is needed for the client build. Runtime data still needs the host protocol above.
