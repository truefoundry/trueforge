import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProxyOptions } from 'vite';
import { defaultClientConditions, defineConfig } from 'vite';
import { compression } from 'vite-plugin-compression2';
// Maintained ESM fork of vite-plugin-monaco-editor (works with Vite 6 ESM config).
import monacoEditorPlugin from 'vite-plugin-monaco-editor-esm';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const gatewaySdkStub = path.join(rootDir, 'src/gatewaySdkStubs.ts');

const SERVER = process.env.VITE_SERVER_URL ?? 'http://localhost:8790';
const PORT = Number(process.env.FRONTEND_PORT ?? 3000);
if (!Number.isInteger(PORT)) {
  throw new Error(`FRONTEND_PORT must be an integer, got "${process.env.FRONTEND_PORT}"`);
}

/** Optional public path (e.g. `/trueforge`). Empty/unset → `/`. Vite requires a trailing slash. */
function resolveViteBase(raw: string | undefined): string {
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed === '' || trimmed === '/') {
    return '/';
  }
  const withLead = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLead.endsWith('/') ? withLead : `${withLead}/`;
}

const BASE = resolveViteBase(process.env.VITE_BASE_PATH);

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

/** When UI+API share a public path, strip it so Harness still sees `/api` / `/internal`. */
const prefixedApiProxy: ProxyOptions =
  BASE === '/'
    ? apiProxy
    : {
        ...apiProxy,
        rewrite: requestPath => requestPath.slice(BASE.length - 1),
      };

const proxy: Record<string, ProxyOptions> =
  BASE === '/'
    ? {
        '/api': apiProxy,
        '/internal': apiProxy,
      }
    : {
        // Prefer the prefixed keys so `/trueforge/api` is not matched as a bare `/api` miss.
        [`${BASE}api`]: prefixedApiProxy,
        [`${BASE}internal`]: prefixedApiProxy,
        '/api': apiProxy,
        '/internal': apiProxy,
      };

export default defineConfig({
  base: BASE,
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
    // Never add 'import'/'require' here: Vite applies those per import kind, and
    // forcing 'import' makes CJS deps require @babel/runtime's ESM helpers.
    conditions: ['trueforge-dev', ...defaultClientConditions],
    alias: {
      'truefoundry-gateway-sdk/agents/private': gatewaySdkStub,
      'truefoundry-gateway-sdk/agents': gatewaySdkStub,
      'truefoundry-gateway-sdk': gatewaySdkStub,
    },
    dedupe: ['react', 'react-dom', '@assistant-ui/core', '@assistant-ui/store', '@assistant-ui/react'],
  },
  server: {
    port: PORT,
    // Fail if FRONTEND_PORT is taken — never silently hop to 3001/3010/etc.
    strictPort: true,
    // Proxy both public SDK routes and internal UI-only routes to the Harness.
    proxy,
  },
});
