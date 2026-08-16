import path from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const exampleRoot = path.dirname(fileURLToPath(import.meta.url));
const sdkRoot = path.resolve(exampleRoot, '..');

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    dedupe: ['react', 'react-dom', '@assistant-ui/core', '@assistant-ui/react', '@assistant-ui/store'],
  },
  optimizeDeps: {
    exclude: ['@truefoundry/trueforge-ui'],
  },
  server: {
    fs: {
      allow: [sdkRoot, exampleRoot],
    },
  },
});
