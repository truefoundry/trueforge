/**
 * Public path from Vite `base` (`VITE_BASE_PATH`). Always `/` or a path with a
 * trailing slash (e.g. `/trueforge/`). UI assets, React Router, and API/auth
 * share this prefix; Caddy strips it before Harness so the server still sees
 * `/` and `/api/...`.
 */
export const UI_BASE_PATH =
  typeof import.meta.env === 'object' &&
  typeof import.meta.env.BASE_URL === 'string' &&
  import.meta.env.BASE_URL.length > 0
    ? import.meta.env.BASE_URL
    : '/';

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
