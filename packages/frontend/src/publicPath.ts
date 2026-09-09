/**
 * Public path from `window.__TRUEFORGE_BASE_PATH__` (the server substitutes
 * `PUBLIC_BASE_URL`'s pathname into the app shell). Always `/` or a path with a
 * trailing slash (e.g. `/a/b/c/`). UI assets, React Router, and API/auth share
 * this prefix; a reverse proxy strips it so the server still sees `/` and `/api/...`.
 */
declare global {
  interface Window {
    __TRUEFORGE_BASE_PATH__?: string;
  }
}

const SHELL_BASE_TOKEN = '__TRUEFORGE_BASE_PATH__';

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
