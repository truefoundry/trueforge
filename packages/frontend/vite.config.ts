import react from '@vitejs/plugin-react';
import path from 'node:path';
import type { Plugin, ProxyOptions } from 'vite';
import { defaultClientConditions, defineConfig } from 'vite';
import { compression } from 'vite-plugin-compression2';
// Maintained ESM fork of vite-plugin-monaco-editor (works with Vite 6 ESM config).
import monacoEditorPlugin from 'vite-plugin-monaco-editor-esm';

const SERVER = process.env.VITE_SERVER_URL ?? 'http://localhost:8790';
const PORT = Number(process.env.FRONTEND_PORT ?? 3000);
if (!Number.isInteger(PORT)) {
  throw new Error(`FRONTEND_PORT must be an integer, got "${process.env.FRONTEND_PORT}"`);
}

/** Vite writes this into the production shell; the server substitutes at process start. Must not appear in JS identifiers. */
const SHELL_BASE_TOKEN = '%%TRUEFORGE_BASE_PATH%%';

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

function shellBaseTokenPlugin(): Plugin {
  return {
    name: 'trueforge-shell-base-token',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html
          .replaceAll('src="./assets/', `src="${SHELL_BASE_TOKEN}assets/`)
          .replaceAll('href="./assets/', `href="${SHELL_BASE_TOKEN}assets/`);
      },
    },
  };
}

/** Dev-only: production leaves `<!-- trueforge-app-brand -->` for the server to fill. */
function serveDefaultBrandPlugin(): Plugin {
  const brandHtml = [
    '    <title>TrueForge</title>',
    '    <meta name="title" content="TrueForge" />',
    '    <meta content="TrueForge" property="og:title" />',
    '    <meta content="TrueForge" property="twitter:title" />',
    '    <meta property="og:type" content="website" />',
    '    <meta property="twitter:card" content="summary_large_image" />',
  ].join('\n');
  return {
    name: 'trueforge-serve-default-brand',
    transformIndexHtml(html) {
      if (!html.includes('<!-- trueforge-app-brand -->')) {
        return html;
      }
      return html.replace(/^[ \t]*<!-- trueforge-app-brand -->\n?/m, `${brandHtml}\n`);
    },
  };
}

export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  plugins: [
    react(),
    monacoEditorPlugin({
      languageWorkers: ['editorWorkerService', 'css', 'html', 'json', 'typescript'],
      // Production `base` is `./`; without this the plugin writes workers under `./monacoeditorwork`.
      customDistPath: (root, buildOutDir) => path.join(root, buildOutDir, 'monacoeditorwork'),
    }),
    // The server serves these siblings instead of compressing per request.
    compression({
      algorithms: ['br', 'gz'],
      threshold: 1024,
      skipIfLargerOrEqual: true,
    }),
    ...(command === 'build' ? [shellBaseTokenPlugin()] : [serveDefaultBrandPlugin()]),
  ],
  // Single React / assistant-ui Context instance (avoids "requires an AuiProvider").
  resolve: {
    // Never add 'import'/'require' here: Vite applies those per import kind, and
    // forcing 'import' makes CJS deps require @babel/runtime's ESM helpers.
    conditions: ['trueforge-dev', ...defaultClientConditions],
    dedupe: ['react', 'react-dom', '@assistant-ui/core', '@assistant-ui/store', '@assistant-ui/react'],
  },
  server: {
    port: PORT,
    // Fail if FRONTEND_PORT is taken — never silently hop to 3001/3010/etc.
    strictPort: true,
    // Proxy API routes (including /api/internal) to the Harness.
    proxy: { '/api': apiProxy },
  },
}));
