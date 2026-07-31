import react from '@vitejs/plugin-react';
import type { ProxyOptions } from 'vite';
import { defineConfig } from 'vite';
import { compression } from 'vite-plugin-compression2';
// Maintained ESM fork of vite-plugin-monaco-editor (works with Vite 6 ESM config).
import monacoEditorPlugin from 'vite-plugin-monaco-editor-esm';

const SERVER = process.env.VITE_SERVER_URL ?? 'http://localhost:8790';
const PORT = Number(process.env.FRONTEND_PORT ?? 3000);
if (!Number.isInteger(PORT)) {
  throw new Error(`FRONTEND_PORT must be an integer, got "${process.env.FRONTEND_PORT}"`);
}

const apiProxy: ProxyOptions = {
  target: SERVER,
  changeOrigin: true,
  // Keep SSE streams open without buffering.
  configure(proxy) {
    proxy.on('proxyRes', proxyRes => {
      if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
        proxyRes.headers['cache-control'] = 'no-cache';
        proxyRes.headers['x-accel-buffering'] = 'no';
      }
    });
  },
};

export default defineConfig({
  plugins: [
    react(),
    monacoEditorPlugin({
      languageWorkers: ['editorWorkerService', 'css', 'html', 'json', 'typescript'],
    }),
    // The server serves these siblings instead of compressing per request.
    compression({
      algorithms: ['br', 'gz'],
      threshold: 1024,
      skipIfLargerOrEqual: true,
    }),
  ],
  // Single React / assistant-ui Context instance (avoids "requires an AuiProvider").
  resolve: {
    dedupe: [
      'react',
      'react-dom',
      '@assistant-ui/core',
      '@assistant-ui/store',
      '@assistant-ui/react',
      'tfy-web-components',
    ],
  },
  server: {
    port: PORT,
    // Plain passthrough: harnessFetch already maps SDK paths onto harness routes.
    proxy: {
      '/api': apiProxy,
    },
  },
});
