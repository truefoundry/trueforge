/** Vitest: jsdom for React containers; MUI alias for CJS/ESM dual-package quirk. */
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import svgr from 'vite-plugin-svgr';
import { defineConfig } from 'vitest/config';

// Node 25+ installs a stub Web Storage global that shadows jsdom's localStorage
// (no clear/getItem/setItem), so ThemeProvider / ShellMode tests crash. Disable
// it on the worker so jsdom owns the global. Flag does not exist on Node < 25.
// See https://github.com/vitest-dev/vitest/issues/8757
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
const execArgv = nodeMajor >= 25 ? ['--no-webstorage'] : [];

export default defineConfig({
  plugins: [
    svgr({
      include: '**/*.svg',
      svgrOptions: {
        icon: true,
        replaceAttrValues: {
          '#000': 'currentColor',
          '#000000': 'currentColor',
        },
      },
    }),
  ],
  resolve: {
    // Vite's client defaults plus trueforge-dev. Never add 'import'/'require':
    // Vite applies those per import kind, and forcing 'import' makes CJS deps
    // resolve @babel/runtime's ESM helpers and fail interop at runtime.
    conditions: ['trueforge-dev', 'module', 'browser', 'development|production'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@mui/material/styles/styled': '@mui/material/styles/styled.js',
    },
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    globals: true,
    setupFiles: ['./test/testSetup.ts'],
    execArgv,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['test/**', 'src/svg.d.ts'],
      thresholds: {
        // Floors stay below the measured baseline (~82/76/75) while preventing large regressions.
        lines: 78,
        functions: 73,
        branches: 72,
      },
    },
  },
});
