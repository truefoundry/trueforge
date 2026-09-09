/**
 * Public path from `window.__TRUEFORGE_BASE_PATH__` (the server substitutes
 * `PUBLIC_BASE_URL`'s pathname into the app shell). Always `/` or a path with a
 * trailing slash (e.g. `/custom/proxy/path/`). UI assets, React Router, and API/auth share
 * this prefix; a reverse proxy strips it so the server still sees `/` and `/api/...`.
 */
declare global {
  interface Window {
    __TRUEFORGE_BASE_PATH__?: string;
    MonacoEnvironment?: {
      globalAPI?: boolean;
      getWorkerUrl?: (moduleId: string, label: string) => string;
    };
  }
}

const SHELL_BASE_TOKEN = '%%TRUEFORGE_BASE_PATH%%';

function documentUiBasePath(): string {
  if (typeof window === 'undefined') {
    return '/';
  }
  const href = window.__TRUEFORGE_BASE_PATH__?.trim();
  if (href === undefined || href === '' || href.includes(SHELL_BASE_TOKEN)) {
    return '/';
  }
  return href.endsWith('/') ? href : `${href}/`;
}

export const UI_BASE_PATH = documentUiBasePath();

/** SDK `baseUrl` — same public prefix as the UI. */
export const API_BASE_URL = UI_BASE_PATH;

/** React Router basename: no trailing slash; `undefined` when serving from `/`. */
export function uiRouterBasename(): string | undefined {
  return UI_BASE_PATH.length > 1 ? UI_BASE_PATH.replace(/\/$/, '') : undefined;
}

/** Join the public base with an absolute app path (e.g. `/api/v1/auth/login`). */
export function apiPath(suffix: string): string {
  const path = suffix.startsWith('/') ? suffix : `/${suffix}`;
  if (UI_BASE_PATH === '/') {
    return path;
  }
  return `${UI_BASE_PATH.replace(/\/$/, '')}${path}`;
}

const MONACO_WORKER_DIR = 'monacoeditorwork';

/** Origin-absolute Monaco worker URL, including the public UI prefix. */
export function monacoWorkerUrl(filename: string): string {
  const name = filename.split('/').pop();
  if (name === undefined || name === '') {
    return `${UI_BASE_PATH}${MONACO_WORKER_DIR}/`;
  }
  return `${UI_BASE_PATH}${MONACO_WORKER_DIR}/${name}`;
}

/**
 * vite-plugin-monaco-editor-esm emits worker URLs from Vite `base` (`./` in
 * production), so they stay page-relative. Rewrite them through the public
 * prefix before Monaco loads a worker on a nested client route.
 */
export function installMonacoWorkerPublicPath(): void {
  if (typeof window === 'undefined') {
    return;
  }
  const previous = window.MonacoEnvironment?.getWorkerUrl;
  window.MonacoEnvironment = {
    ...window.MonacoEnvironment,
    getWorkerUrl(moduleId: string, label: string) {
      const raw = previous?.call(window.MonacoEnvironment, moduleId, label);
      if (typeof raw === 'string' && raw.length > 0) {
        return monacoWorkerUrl(raw);
      }
      return monacoWorkerUrl(`${label}.worker.bundle.js`);
    },
  };
}
