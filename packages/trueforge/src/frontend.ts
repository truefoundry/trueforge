/** Serves the built frontend, so one container answers both the UI and the API. */
import { serveStatic } from '@hono/node-server/serve-static';
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { MiddlewareHandler } from 'hono';
import { every } from 'hono/combine';
import { compress } from 'hono/compress';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Routes the server answers itself; never served from the build. /api covers every version below it. */
const SERVER_PATH_PREFIXES = ['/api', '/healthz'];

/** Only Vite's hashed asset names can be cached forever. */
const HASHED_ASSET_PREFIX = '/assets/';
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const REVALIDATE_CACHE_CONTROL = 'no-cache';

/** Vite writes these into the production shell; replaced once at process start. Must not appear in JS identifiers. */
const SHELL_BASE_TOKEN = '%%TRUEFORGE_BASE_PATH%%';
const SHELL_AUTH_MODE_TOKEN = '%%TRUEFORGE_AUTH_MODE%%';

function isServerPath(pathname: string): boolean {
  return SERVER_PATH_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isAppShellPath(pathname: string): boolean {
  return pathname === '/' || pathname === '/index.html';
}

function applyShellTokens(options: { html: string; uiBasePath: string; authMode: string }): string {
  return options.html
    .replaceAll(SHELL_BASE_TOKEN, options.uiBasePath)
    .replaceAll(SHELL_AUTH_MODE_TOKEN, options.authMode);
}

function createShellResponse(options: { html: string; method: string }): Response {
  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': REVALIDATE_CACHE_CONTROL,
    Vary: 'Accept-Encoding',
  });
  if (options.method === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }
  return new Response(options.html, { status: 200, headers });
}

/**
 * Must be called after the API routes are registered, so those always win over the static handler.
 * Returns false when `dir` holds no build, leaving the server API-only for UI work behind Vite.
 */
export function mountFrontend(
  app: OpenAPIHono,
  options: { dir: string; uiBasePath: string; authMode: string },
): boolean {
  const indexPath = path.join(options.dir, 'index.html');
  if (!existsSync(indexPath)) {
    return false;
  }

  const shellHtml = applyShellTokens({
    html: readFileSync(indexPath, 'utf8'),
    uiBasePath: options.uiBasePath,
    authMode: options.authMode,
  });

  // serveStatic joins `root` with the request path, so an absolute dir is working-directory proof.
  const serveFile = serveStatic({ root: options.dir, precompressed: true });

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
    if (isAppShellPath(c.req.path)) {
      return createShellResponse({ html: shellHtml, method: c.req.method });
    }
    return serveCompressed(c, next);
  };

  /**
   * Client routes (`/sessions/{id}`, `/settings`, `/library`) have no file on disk, so a
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

    return createShellResponse({ html: shellHtml, method: c.req.method });
  };

  app.use('/*', serveBuild);
  app.use('/*', serveSpaFallback);

  return true;
}
