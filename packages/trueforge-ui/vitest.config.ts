/** Vitest: jsdom for React containers; MUI alias for CJS/ESM dual-package quirk. */
import { fileURLToPath } from 'node:url';

import svgr from 'vite-plugin-svgr';
import { defineConfig } from 'vitest/config';

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
