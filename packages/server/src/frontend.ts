/**
 * Serves the built frontend, so one container answers both the UI and the API.
 * With no build on disk the server runs API-only.
 */
import { serveStatic } from '@hono/node-server/serve-static';
import type { MiddlewareHandler } from 'hono';
import { every } from 'hono/combine';
import { compress } from 'hono/compress';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Routes the server answers itself; never served from the build. */
const SERVER_PATH_PREFIXES = ['/v1', '/docs', '/openapi.json', '/healthz'];

/** Only Vite's hashed asset names can be cached forever. */
const HASHED_ASSET_PREFIX = '/assets/';
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const REVALIDATE_CACHE_CONTROL = 'no-cache';

export interface FrontendAssets {
  readonly middleware: MiddlewareHandler;
  readonly indexHtml: string;
}

function isServerPath(pathname: string): boolean {
  return SERVER_PATH_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Browser navigation accepts HTML; a missing script does not, and gets the JSON 404. */
export function wantsAppShell(request: { method: string; pathname: string; accept: string | undefined }): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  if (isServerPath(request.pathname)) return false;
  return request.accept?.toLowerCase().includes('text/html') ?? false;
}

export function loadFrontendAssets(dir: string): FrontendAssets | undefined {
  const indexPath = path.join(dir, 'index.html');
  if (!existsSync(indexPath)) return undefined;

  // serveStatic resolves `root` against the working directory; absolute paths are outside its contract.
  const root = path.relative(process.cwd(), dir) || '.';
  const serveFile = serveStatic({ root, precompressed: true });

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
   * compress() ignores responses that already carry Content-Encoding, so this only reaches the files
   * the build could not precompress — the Monaco workers, written outside Vite's asset pipeline. It
   * sits inside the isServerPath guard below: compressing an API response would buffer the SSE
   * streams that must flush per event.
   */
  const serveCompressed = every(compress(), serveWithCacheHeaders);

  const middleware: MiddlewareHandler = async (c, next) => {
    if (isServerPath(c.req.path)) return next();
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next();
    return serveCompressed(c, next);
  };

  return { middleware, indexHtml: readFileSync(indexPath, 'utf8') };
}
