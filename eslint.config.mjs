// @ts-check

import react from '@eslint-react/eslint-plugin';
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

/** Minimal browser globals for the Vite React frontend (avoid adding a globals dep). */
const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  fetch: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  FormData: 'readonly',
  Headers: 'readonly',
  Request: 'readonly',
  Response: 'readonly',
  HTMLElement: 'readonly',
  HTMLButtonElement: 'readonly',
  HTMLInputElement: 'readonly',
  HTMLSelectElement: 'readonly',
  HTMLDivElement: 'readonly',
  Event: 'readonly',
  CustomEvent: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  crypto: 'readonly',
  process: 'readonly', // Vite injects import.meta / some env via process in configs
};

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.pnpm-store/**',
      '**/.eslintcache',
      // Excluded from package tsconfigs; run via tsx/jest, not the type-aware ESLint project.
      '**/*.test.ts',
      // Fern-generated SDK: not part of any tsconfig project, and not ours to lint.
      'packages/trueforge-sdk/**',
      // Build-generated sources (catalogs, sandbox scripts); not in package tsconfigs.
      '**/*.gen.ts',
      // Railway IaC config: consumed by the railway CLI, not part of a package tsconfig.
      '.railway/**',
    ],
  },
  {
    // Require braces on every control statement, including single-line and multi-line.
    rules: {
      curly: ['error', 'all'],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs,ts}'],
    ignores: ['packages/frontend/**'],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['packages/frontend/src/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      react.configs['recommended-type-checked'],
      reactHooks.configs.flat['recommended-latest'],
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        ecmaFeatures: { jsx: true },
      },
      globals: browserGlobals,
    },
  },
  {
    // Vite config is outside the frontend src tsconfig project.
    files: ['packages/frontend/*.{ts,mts,cts}', 'packages/frontend/*.config.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
      },
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
      // Flat config does not support /* eslint-env node */; Node scripts and CJS configs need Node globals.
      globals: {
        module: 'readonly',
        require: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        exports: 'writable',
        console: 'readonly',
        process: 'readonly',
      },
    },
  },
);
