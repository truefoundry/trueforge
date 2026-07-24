import react from '@vitejs/plugin-react';
import type { ProxyOptions } from 'vite';
import { defineConfig } from 'vite';
// Maintained ESM fork of vite-plugin-monaco-editor (works with Vite 6 ESM config).
import monacoEditorPlugin from 'vite-plugin-monaco-editor-esm';

const SERVER = process.env.VITE_SERVER_URL ?? 'http://localhost:8790';

/** Rewrite SDK draft/session paths onto harness /v1/sessions. */
function rewriteAgentsToSessions(path: string): string {
  return path
    .replace(/^\/v1\/agents\/draft-sessions/, '/v1/sessions')
    .replace(/^\/v1\/agents\/sessions/, '/v1/sessions');
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
    port: 3000,
    proxy: {
      '/v1/agents': {
        ...apiProxy,
        rewrite: rewriteAgentsToSessions,
      },
      '/v1/capabilities': apiProxy,
      '/v1/models': apiProxy,
      '/v1/mcp-servers': apiProxy,
      '/v1/skills': apiProxy,
      '/v1/sessions': apiProxy,
    },
  },
});
