/** Serves the built frontend, so one container answers both the UI and the API. */
import { serveStatic } from '@hono/node-server/serve-static';
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Context, MiddlewareHandler } from 'hono';
import { every } from 'hono/combine';
import { compress } from 'hono/compress';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { routeNotFound } from './app';

/** Routes the server answers itself; never served from the build. /api covers every version below it. */
const SERVER_PATH_PREFIXES = ['/api', '/healthz'];

/** Only Vite's hashed asset names can be cached forever. */
const HASHED_ASSET_PREFIX = '/assets/';
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const REVALIDATE_CACHE_CONTROL = 'no-cache';

function isServerPath(pathname: string): boolean {
  return SERVER_PATH_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Only a browser navigating to a client-side route gets index.html; scripts and fetches keep their 404. */
function isUiNavigation(c: Context): boolean {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return false;
  if (isServerPath(c.req.path)) return false;
  return c.req.header('accept')?.toLowerCase().includes('text/html') ?? false;
}

/**
 * Must be called after the API routes are registered, so those always win over the static handler.
 * Returns false when `dir` holds no build, leaving the server API-only for UI work behind Vite.
 */
export function mountFrontend(app: OpenAPIHono, dir: string): boolean {
  const indexPath = path.join(dir, 'index.html');
  if (!existsSync(indexPath)) return false;
  let lastIndexHtml = readFileSync(indexPath, 'utf8');

  /** Fresh per navigation, so a rebuild needs no restart to stop serving stale asset hashes. */
  function readIndexHtml(): string {
    try {
      lastIndexHtml = readFileSync(indexPath, 'utf8');
    } catch {
      // A rebuild empties the directory first, so the previous copy beats failing the navigation.
    }
    return lastIndexHtml;
  }

  // serveStatic joins `root` with the request path, so an absolute dir is working-directory proof.
  const serveFile = serveStatic({ root: dir, precompressed: true });

  const serveWithCacheHeaders: MiddlewareHandler = async (c, next) => {
    const response = await serveFile(c, next);
    // Only when a file was served: a missing asset must not cache its 404.
    if (response instanceof Response) {
      const cacheControl = c.req.path.startsWith(HASHED_ASSET_PREFIX)
        ? IMMUTABLE_CACHE_CONTROL
        : REVALIDATE_CACHE_CONTROL;
      response.headers.set('Cache-Control', cacheControl);
      // compress() below encodes without advertising it, which a shared cache would get wrong.
      response.headers.set('Vary', 'Accept-Encoding');
    }
    return response;
  };

  /**
   * compress() skips responses that already carry Content-Encoding, so it only reaches what the build
   * could not precompress: the Monaco workers. It stays behind the isServerPath guard below because
   * compressing an API response would buffer the SSE streams that must flush per event.
   */
  const serveCompressed = every(compress(), serveWithCacheHeaders);

  const serveBuild: MiddlewareHandler = async (c, next) => {
    if (isServerPath(c.req.path)) return next();
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next();
    return serveCompressed(c, next);
  };

  app.use('/*', serveBuild);

  // Vary because compress() above may encode index.html without advertising it.
  const indexHtmlHeaders = { 'Cache-Control': REVALIDATE_CACHE_CONTROL, Vary: 'Accept-Encoding' };

  // A client-side route like /sessions/ses_1 has no file on disk, so a reload or a shared link would 404
  // without this; index.html boots the app and its router then renders the path the browser asked for.
  app.notFound(c => (isUiNavigation(c) ? c.html(readIndexHtml(), 200, indexHtmlHeaders) : routeNotFound(c)));

  return true;
}
