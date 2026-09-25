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

/** Vite writes this into the production shell; replaced once at process start. Must not appear in JS identifiers. */
const SHELL_BASE_TOKEN = '%%TRUEFORGE_BASE_PATH%%';

/** Placeholder in `index.html`; filled once at process start from `APP_*` config. */
const BRAND_MARKER = '<!-- trueforge-app-brand -->';

/** Brand values injected into the served app shell. */
export interface AppShellBrand {
  title: string;
  description: string | undefined;
  ogImage: string | undefined;
  ogUrl: string | undefined;
  twitterImage: string | undefined;
  favicon: string | undefined;
  favicon16: string | undefined;
  favicon32: string | undefined;
  manifest: string | undefined;
}

function escapeAttr(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

/** Builds title / OG / favicon tags; omits unset optional fields. */
function buildBrandHtml(brand: AppShellBrand): string {
  const title = brand.title.trim();
  const description = brand.description?.trim() ?? '';
  const ogImage = brand.ogImage?.trim() ?? '';
  const twitterImage = brand.twitterImage?.trim() ?? '';
  const ogUrl = brand.ogUrl?.trim() ?? '';
  const favicon = brand.favicon?.trim() ?? '';
  const favicon16 = brand.favicon16?.trim() ?? '';
  const favicon32 = brand.favicon32?.trim() ?? '';
  const manifest = brand.manifest?.trim() ?? '';

  const tags: string[] = [];

  if (title) {
    const t = escapeAttr(title);
    tags.push(`<title>${t}</title>`);
    tags.push(`<meta name="title" content="${t}" />`);
    tags.push(`<meta content="${t}" property="og:title" />`);
    tags.push(`<meta content="${t}" property="twitter:title" />`);
  }

  if (description) {
    const d = escapeAttr(description);
    tags.push(`<meta name="description" content="${d}" />`);
    tags.push(`<meta content="${d}" property="og:description" />`);
    tags.push(`<meta content="${d}" property="twitter:description" />`);
  }

  if (ogImage) {
    tags.push(`<meta content="${escapeAttr(ogImage)}" property="og:image" />`);
  }

  if (twitterImage) {
    tags.push(`<meta content="${escapeAttr(twitterImage)}" property="twitter:image" />`);
  }

  if (ogUrl) {
    const u = escapeAttr(ogUrl);
    tags.push(`<meta content="${u}" property="og:url" />`);
    tags.push(`<meta content="${u}" property="twitter:url" />`);
  }

  const hasOgOrTwitterContent = Boolean(title || description || ogImage || twitterImage || ogUrl);
  if (hasOgOrTwitterContent) {
    tags.push('<meta property="og:type" content="website" />');
    tags.push('<meta property="twitter:card" content="summary_large_image" />');
  }

  if (favicon) {
    const href = escapeAttr(favicon);
    tags.push(`<link rel="shortcut icon" href="${href}" type="image/x-icon" />`);
    tags.push(`<link rel="icon" href="${href}" type="image/x-icon" />`);
  }

  if (favicon32) {
    tags.push(`<link rel="icon" type="image/png" sizes="32x32" href="${escapeAttr(favicon32)}" />`);
  }

  if (favicon16) {
    tags.push(`<link rel="icon" type="image/png" sizes="16x16" href="${escapeAttr(favicon16)}" />`);
  }

  if (manifest) {
    tags.push(`<link rel="manifest" href="${escapeAttr(manifest)}" />`);
  }

  if (tags.length === 0) {
    return '';
  }
  return tags.map(tag => `    ${tag}`).join('\n');
}

function isServerPath(pathname: string): boolean {
  return SERVER_PATH_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isAppShellPath(pathname: string): boolean {
  return pathname === '/' || pathname === '/index.html';
}

function applyShellTokens(options: { html: string; uiBasePath: string; brand: AppShellBrand }): string {
  const brandHtml = buildBrandHtml(options.brand);
  const withBrand = options.html.includes(BRAND_MARKER)
    ? options.html.replace(/^[ \t]*<!-- trueforge-app-brand -->\n?/m, brandHtml ? `${brandHtml}\n` : '')
    : options.html;
  return withBrand.replaceAll(SHELL_BASE_TOKEN, options.uiBasePath);
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
  options: { dir: string; uiBasePath: string; brand: AppShellBrand },
): boolean {
  const indexPath = path.join(options.dir, 'index.html');
  if (!existsSync(indexPath)) {
    return false;
  }

  const shellHtml = applyShellTokens({
    html: readFileSync(indexPath, 'utf8'),
    uiBasePath: options.uiBasePath,
    brand: options.brand,
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
