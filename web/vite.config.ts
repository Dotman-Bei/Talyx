import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

// Three static pages: the landing page, the demo app and the verify page.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        landing: resolve(root, 'index.html'),
        app: resolve(root, 'app/index.html'),
        verify: resolve(root, 'verify/index.html'),
      },
    },
  },
});
