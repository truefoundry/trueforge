import { OpenAPIHono } from '@hono/zod-openapi';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { type AppShellBrand, mountFrontend } from '../../src/frontend';

const defaultBrand = (): AppShellBrand => ({
  title: 'TrueForge',
  description: undefined,
  ogImage: undefined,
  ogUrl: undefined,
  twitterImage: undefined,
  favicon: undefined,
  favicon16: undefined,
  favicon32: undefined,
  manifest: undefined,
});

function buildDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'trueforge-frontend-'));
  writeFileSync(path.join(dir, 'index.html'), '<html><body><div id="root"></div></body></html>');
  mkdirSync(path.join(dir, 'assets'));
  writeFileSync(path.join(dir, 'assets', 'app-abc123.js'), 'console.log("app");');
  return dir;
}

function appWithFrontend(dir: string): OpenAPIHono {
  const app = new OpenAPIHono();
  app.get('/api/v1/health', c => c.json({ ok: true }));
  mountFrontend(app, { dir, uiBasePath: '/', brand: defaultBrand() });
  return app;
}

const HTML_ACCEPT = { accept: 'text/html,application/xhtml+xml' };

describe('mountFrontend', () => {
  it('reports whether the directory holds a build', () => {
    expect(
      mountFrontend(new OpenAPIHono(), {
        dir: path.join(tmpdir(), 'trueforge-missing-build'),
        uiBasePath: '/',
        brand: defaultBrand(),
      }),
    ).toBe(false);
    expect(mountFrontend(new OpenAPIHono(), { dir: buildDir(), uiBasePath: '/', brand: defaultBrand() })).toBe(true);
  });

  it('substitutes the public UI prefix into the cached app shell', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'trueforge-frontend-'));
    writeFileSync(
      path.join(dir, 'index.html'),
      "<html><script>window.__TRUEFORGE_BASE_PATH__='%%TRUEFORGE_BASE_PATH%%';</script></html>",
    );
    const app = new OpenAPIHono();
    mountFrontend(app, { dir, uiBasePath: '/custom/proxy/path/', brand: defaultBrand() });

    const response = await app.request('/', { headers: HTML_ACCEPT });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("window.__TRUEFORGE_BASE_PATH__='/custom/proxy/path/'");
  });

  it('injects branded meta tags and escapes attribute values', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'trueforge-frontend-'));
    writeFileSync(
      path.join(dir, 'index.html'),
      '<html><head>\n    <!-- trueforge-app-brand -->\n</head><body><div id="root"></div></body></html>',
    );
    const app = new OpenAPIHono();
    mountFrontend(app, {
      dir,
      uiBasePath: '/',
      brand: {
        ...defaultBrand(),
        title: 'Acme "Labs" <v2>',
        description: 'Hello & welcome',
        ogImage: '/og.png',
        ogUrl: 'https://example.com/',
      },
    });

    const html = await (await app.request('/', { headers: HTML_ACCEPT })).text();
    expect(html).toContain('<title>Acme &quot;Labs&quot; &lt;v2></title>');
    expect(html).toContain('content="Acme &quot;Labs&quot; &lt;v2>" property="og:title"');
    expect(html).toContain('name="description" content="Hello &amp; welcome"');
    expect(html).toContain('content="/og.png" property="og:image"');
    expect(html).toContain('content="https://example.com/" property="og:url"');
    expect(html).toContain('property="og:type" content="website"');
    expect(html).not.toContain('<!-- trueforge-app-brand -->');
    expect(html).not.toContain('property="twitter:image"');
  });

  it('emits og:type for title-only brand without empty description tags', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'trueforge-frontend-'));
    writeFileSync(
      path.join(dir, 'index.html'),
      '<html><head>\n    <!-- trueforge-app-brand -->\n</head><body></body></html>',
    );
    const app = new OpenAPIHono();
    mountFrontend(app, { dir, uiBasePath: '/', brand: defaultBrand() });

    const html = await (await app.request('/', { headers: HTML_ACCEPT })).text();
    expect(html).toContain('<title>TrueForge</title>');
    expect(html).toContain('property="og:type" content="website"');
    expect(html).not.toContain('name="description"');
    expect(html).not.toContain('property="og:image"');
    expect(html).not.toContain('rel="icon"');
  });

  it('serves the app shell for client-only deep links', async () => {
    const app = appWithFrontend(buildDir());

    for (const clientPath of [
      '/',
      '/settings',
      '/library',
      '/library/agent-1',
      '/sessions/abc123',
      '/agents/my-agent',
    ]) {
      const response = await app.request(clientPath, { headers: HTML_ACCEPT });
      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toContain('id="root"');
    }
  });

  it('keeps real files, API routes, and missing assets intact', async () => {
    const app = appWithFrontend(buildDir());

    const asset = await app.request('/assets/app-abc123.js');
    expect(asset.status).toBe(200);
    await expect(asset.text()).resolves.toContain('console.log');

    const api = await app.request('/api/v1/health', { headers: HTML_ACCEPT });
    expect(api.status).toBe(200);
    await expect(api.json()).resolves.toEqual({ ok: true });

    // A missing asset must 404 rather than receive HTML under a JS content type.
    expect((await app.request('/assets/gone-000000.js')).status).toBe(404);

    // Navigations are the only thing the shell answers.
    expect((await app.request('/sessions/abc123', { method: 'POST', headers: HTML_ACCEPT })).status).toBe(404);
  });
});
