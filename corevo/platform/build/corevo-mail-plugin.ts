import type { Plugin } from 'vite';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import postcss from 'postcss';
import tailwind from 'tailwindcss-mailflow';

export function corevoMailPlugin(): Plugin {
  return {
    name: 'corevo-mail-source-client',
    async generateBundle(_options, bundle) {
      const entry = Object.values(bundle).find(item => item.type === 'chunk' && item.isEntry && item.facadeModuleId?.endsWith('/src/modules/mail/client.html'));
      const checked = new Set<string>();
      function check(file: string) {
        if (checked.has(file)) return;
        checked.add(file);
        const item = bundle[file];
        if (!item || item.type !== 'chunk') return;
        for (const id of Object.keys(item.modules)) {
          const relative = path.relative(process.cwd(), id).replaceAll('\\', '/');
          if (!id.startsWith('\0') && !relative.startsWith('node_modules/') && !relative.startsWith('vendor/mailflow/') && !relative.startsWith('src/modules/mail/')) throw new Error('Private code reached the AGPL mail bundle: ' + relative);
        }
        [...item.imports, ...item.dynamicImports].forEach(check);
      }
      if (!entry) throw new Error('Corevo Mail entry is missing from the build.');
      check(entry.fileName);
      for (const file of ['fonts.css', 'fonts/InterVariable.woff2', 'fonts/InterVariable-Italic.woff2', 'fonts/LICENSE.txt', 'fonts/manifest.json']) {
        if (!bundle['assets/' + file]) this.emitFile({ type: 'asset', fileName: 'assets/' + file, source: await readFile('admin/assets/' + file) });
      }
      this.emitFile({ type: 'asset', fileName: 'src/modules/mail/test-transport.mjs', source: await readFile('src/modules/mail/test-transport.mjs', 'utf8') });
      this.emitFile({ type: 'asset', fileName: 'src/modules/mail/mailbox-transport.mjs', source: await readFile('src/modules/mail/mailbox-transport.mjs', 'utf8') });
      this.emitFile({ type: 'asset', fileName: 'corevo-mail-license.txt', source: await readFile('vendor/mailflow/LICENSE', 'utf8') });
      this.emitFile({ type: 'asset', fileName: 'corevo-mail-notices.txt', source: await readFile('vendor/mailflow/THIRD-PARTY-NOTICES.txt', 'utf8') });
      const source = execFileSync('tar', ['-czf', '-', '--exclude=node_modules', '--exclude=dist', '--exclude=.git', '--exclude=.env*', '--exclude=*.pem', '--exclude=*.key', 'vendor/mailflow', 'src/modules/mail', 'platform/build/corevo-mail-plugin.ts', 'admin/assets/agency-mail.js', 'admin/assets/fonts.css', 'admin/assets/fonts'], { maxBuffer: 32 * 1024 * 1024 });
      this.emitFile({ type: 'asset', fileName: 'corevo-mail-source.tar.gz', source });
    },
    resolveId(id) { if (id === 'virtual:corevo-mail-css') return '\0corevo-mail-css'; },
    async load(id) {
      if (id !== '\0corevo-mail-css') return;
      const source = path.resolve('vendor/mailflow/frontend/src');
      this.addWatchFile(path.join(source, 'index.css'));
      const css = await readFile(path.join(source, 'index.css'), 'utf8');
      const result = await postcss([tailwind({
        content: [source + '/**/*.{js,jsx}'],
        theme: { extend: { fontFamily: { sans: ['var(--font-sans)', 'Inter', 'sans-serif'], mono: ['var(--font-mono)', 'monospace'], display: ['var(--font-display)', 'Inter', 'sans-serif'] } } },
        plugins: [],
      })]).process(css, { from: path.join(source, 'index.css') });
      return 'export default ' + JSON.stringify(result.css);
    },
  };
}
