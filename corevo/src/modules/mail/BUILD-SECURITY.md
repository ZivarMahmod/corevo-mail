# Corevo Mail build dependency checkpoint, 2026-10-09

The standalone client builds and its 14 module tests and 64 selected original MailFlow tests pass. The original tests require jsdom 30.0.1, already used by upstream, now included in the standalone build's development dependencies.

`npm audit` reports seven findings (five high, two moderate) in the Tailwind 3 build dependency chain: braces, chokidar, fast-glob, micromatch, postcss-nested, postcss-selector-parser and tailwindcss. These are build dependencies; this checkpoint does not declare them irrelevant or the complete runtime dependency graph secure. U8 must verify reachability and address patched dependencies/contain the unpatched build-time input paths before release.

- [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): recursive braces patterns can exhaust the Node stack; the advisory lists no patched release as of this checkpoint. Source-controlled build patterns are the current input, and no user-supplied patterns may be introduced into this build path.
- [GHSA-rj75-hqrm-r3gf](https://github.com/advisories/GHSA-rj75-hqrm-r3gf): flat selector parsing can exhaust CPU. The pinned 6.1.4 parser requires a compatibility-tested replacement with a patched version.

Do not run `npm audit fix --force` across the private platform: it proposes replacing the isolated upstream Tailwind 3 toolchain with Tailwind 4. Preserve the original client's CSS behavior while applying the necessary fixes. No production or external tenant deployment is authorized by this checkpoint.
