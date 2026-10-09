import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'node:path';
import {corevoMailPlugin} from './platform/build/corevo-mail-plugin';

// Standalone source rebuild only; Corevo serves these assets in its existing app.
export default defineConfig({
 plugins:[react(),corevoMailPlugin()],
 build:{target:['es2020','edge111','firefox128','chrome111','safari16.4'],rollupOptions:{input:{mail:path.resolve('src/modules/mail/client.html')}}},
 resolve:{dedupe:['react','react-dom','react/jsx-runtime','react/jsx-dev-runtime']},
});
