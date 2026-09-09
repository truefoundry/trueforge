import { OpenAPIHono } from '@hono/zod-openapi';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { mountFrontend } from '../../src/frontend';

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
  mountFrontend(app, dir);
  return app;
}

const HTML_ACCEPT = { accept: 'text/html,application/xhtml+xml' };

describe('mountFrontend', () => {
  it('reports whether the directory holds a build', () => {
    expect(mountFrontend(new OpenAPIHono(), path.join(tmpdir(), 'trueforge-missing-build'))).toBe(false);
    expect(mountFrontend(new OpenAPIHono(), buildDir())).toBe(true);
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
