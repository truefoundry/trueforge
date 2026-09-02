/**
 * UI public path from Vite `base` (`VITE_BASE_PATH`). Always `/` or a path with a
 * trailing slash (e.g. `/trueforge/`). Distinct from the API origin: with a
 * reverse proxy that strips this prefix, API calls stay at `/api/...`.
 */
export const UI_BASE_PATH =
  typeof import.meta.env === 'object' &&
  typeof import.meta.env.BASE_URL === 'string' &&
  import.meta.env.BASE_URL.length > 0
    ? import.meta.env.BASE_URL
    : '/';

/** React Router basename: no trailing slash; `undefined` when serving from `/`. */
export function uiRouterBasename(): string | undefined {
  return UI_BASE_PATH.length > 1 ? UI_BASE_PATH.replace(/\/$/, '') : undefined;
}
