/** Vitest: jsdom for React containers; MUI alias for CJS/ESM dual-package quirk. */
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@mui/material/styles/styled': '@mui/material/styles/styled.js',
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
    setupFiles: ['./src/testSetup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/testSetup.ts', 'src/svg.d.ts'],
      thresholds: {
        // Floor just under measured baseline (~70/67/56) so CI stays green.
        lines: 65,
        functions: 60,
        branches: 50,
      },
    },
  },
});
