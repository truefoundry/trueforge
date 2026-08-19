/** Serves the built frontend, so one container answers both the UI and the API. */
import { serveStatic } from '@hono/node-server/serve-static';
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { MiddlewareHandler } from 'hono';
import { every } from 'hono/combine';
import { compress } from 'hono/compress';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** Routes the server answers itself; never served from the build. /api covers every version below it. */
const SERVER_PATH_PREFIXES = ['/api', '/healthz'];

/** Only Vite's hashed asset names can be cached forever. */
const HASHED_ASSET_PREFIX = '/assets/';
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const REVALIDATE_CACHE_CONTROL = 'no-cache';

function isServerPath(pathname: string): boolean {
  return SERVER_PATH_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Must be called after the API routes are registered, so those always win over the static handler.
 * Returns false when `dir` holds no build, leaving the server API-only for UI work behind Vite.
 */
export function mountFrontend(app: OpenAPIHono, dir: string): boolean {
  if (!existsSync(path.join(dir, 'index.html'))) {
    return false;
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
    if (isServerPath(c.req.path)) {
      return next();
    }
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      return next();
    }
    return serveCompressed(c, next);
  };

  const serveAppShell = serveStatic({ root: dir, rewriteRequestPath: () => '/index.html', precompressed: true });

  /**
   * Client routes (`/sessions/{id}`, `/settings`) have no file on disk, so a
   * deep link only reaches the app when the shell answers the navigation.
   * Runs after `serveBuild`, so real files still win; requests that do not
   * accept HTML keep their 404 rather than getting the shell as a fake asset.
   */
  const serveSpaFallback: MiddlewareHandler = async (c, next) => {
    if (isServerPath(c.req.path)) {
      return next();
    }
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      return next();
    }
    if (c.req.header('accept')?.includes('text/html') !== true) {
      return next();
    }

    const response = await serveAppShell(c, next);
    if (response instanceof Response) {
      response.headers.set('Cache-Control', REVALIDATE_CACHE_CONTROL);
      response.headers.set('Vary', 'Accept-Encoding');
    }
    return response;
  };

  app.use('/*', serveBuild);
  app.use('/*', serveSpaFallback);

  return true;
}
