import '@testing-library/jest-dom/vitest';
import { createElement, type ReactNode } from 'react';
import { vi } from 'vitest';

// Mirror `src/index.ts`: agent SVGs register into the Icon map. Tests that import
// atoms/theme modules directly never hit the package entry, so load them here.
import '../src/icons/registerAgentIcons.js';

// react-syntax-highlighter ships both CJS and ESM; refractor (its dependency)
// is ESM-only and breaks when required via CJS. Mock in tests since it is
// external in production anyway.
vi.mock('react-syntax-highlighter', () => ({
  Prism: ({
    children,
    language,
  }: {
    children?: string;
    language?: string;
    PreTag?: unknown;
    CodeTag?: unknown;
    style?: unknown;
    showLineNumbers?: boolean;
  }) =>
    createElement(
      'pre',
      { className: `language-${language ?? 'text'}`, 'data-testid': 'aui-syntax-highlighter' },
      createElement('code', null, children),
    ),
}));

vi.mock('react-syntax-highlighter/dist/esm/styles/prism', () => ({
  oneDark: {},
  oneLight: {},
}));

vi.mock('@openuidev/react-lang', () => ({
  Renderer: ({ response, isStreaming }: { response?: string | null; isStreaming?: boolean }) =>
    createElement('div', { 'data-testid': 'aui-openui-renderer', 'data-streaming': String(!!isStreaming) }, response),
}));

vi.mock('@openuidev/react-ui', () => ({
  ThemeProvider: ({ children }: { children?: ReactNode }) => children,
  openuiLibrary: {},
}));

// jsdom does not implement ResizeObserver; assistant-ui's viewport/scroll
// tracking primitives use it, so tests need a no-op stand-in.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: ResizeObserverStub,
  });
}

// Node 25+ exposes a broken `localStorage` getter unless `--localstorage-file` is
// set; that shadows jsdom's implementation and makes `window.localStorage` undefined.
const localStorageWorks =
  typeof globalThis.localStorage?.getItem === 'function' && typeof globalThis.localStorage?.removeItem === 'function';
if (!localStorageWorks) {
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.has(key) ? (store.get(key) ?? null) : null;
    },
    key(index) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key) {
      store.delete(key);
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: memoryStorage,
  });
}
