import { InMemorySessionStore, Sessions } from '@truefoundry/utils/agent-session';
import { RequestReplyRouter } from '@truefoundry/utils/request-reply';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { brotliCompressSync, brotliDecompressSync, gunzipSync } from 'node:zlib';
import { createClient, type RedisClientType } from 'redis';
import winston from 'winston';
import { createServerApp } from './app';
import { ActiveTurnRegistry } from './runtime/activeTurns';
import { McpStore } from './store/McpStore';
import { ModelStore } from './store/ModelStore';
import { SkillStore } from './store/SkillStore';

const INDEX_HTML = '<!doctype html><title>Harness</title>';
const ASSET_JS = 'console.log("app")';
/** Long enough to clear the compress() threshold. */
const WORKER_JS = `self.onmessage = () => {};${' '.repeat(2048)}`;

/** The shell, a hashed asset with its precompressed sibling, and an uncompressed worker. */
function writeFrontendBuild(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'harness-frontend-'));
  mkdirSync(path.join(dir, 'assets'));
  mkdirSync(path.join(dir, 'monacoeditorwork'));
  writeFileSync(path.join(dir, 'index.html'), INDEX_HTML);
  writeFileSync(path.join(dir, 'assets/app-abc123.js'), ASSET_JS);
  writeFileSync(path.join(dir, 'assets/app-abc123.js.br'), brotliCompressSync(ASSET_JS));
  writeFileSync(path.join(dir, 'monacoeditorwork/editor.worker.bundle.js'), WORKER_JS);
  return dir;
}

// Unconnected: no request below reaches Redis.
const redis: RedisClientType = createClient();

function createApp(frontendDir: string | undefined) {
  const sessionStore = new InMemorySessionStore();
  return createServerApp({
    modelStore: ModelStore.load(),
    mcpStore: McpStore.load(),
    skillStore: SkillStore.load(),
    sessionStore,
    sessions: new Sessions({ sessionStore }),
    activeTurns: new ActiveTurnRegistry(),
    redis,
    requestReplyRouter: new RequestReplyRouter(),
    ...(frontendDir === undefined ? {} : { frontendDir }),
    logger: winston.createLogger({ silent: true }),
  });
}

const navigation = { headers: { accept: 'text/html,*/*;q=0.8' } };

describe('frontend serving', () => {
  const app = createApp(writeFrontendBuild());

  it('serves the app shell at the root and for in-app routes', async () => {
    const root = await app.request('/', navigation);
    assert.equal(root.status, 200);
    assert.equal(await root.text(), INDEX_HTML);
    assert.equal(root.headers.get('cache-control'), 'no-cache');

    const inApp = await app.request('/some/app/route', navigation);
    assert.equal(inApp.status, 200);
    assert.equal(await inApp.text(), INDEX_HTML);
  });

  it('serves hashed assets as immutable', async () => {
    const response = await app.request('/assets/app-abc123.js');
    assert.equal(response.status, 200);
    assert.equal(await response.text(), ASSET_JS);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(response.headers.get('content-encoding'), null);
  });

  it('serves the precompressed sibling when the client accepts brotli', async () => {
    const response = await app.request('/assets/app-abc123.js', { headers: { 'accept-encoding': 'br' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-encoding'), 'br');
    assert.equal(brotliDecompressSync(await response.bytes()).toString(), ASSET_JS);
  });

  it('compresses a file that has no precompressed sibling', async () => {
    const response = await app.request('/monacoeditorwork/editor.worker.bundle.js', {
      headers: { 'accept-encoding': 'gzip' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-encoding'), 'gzip');
    assert.equal(response.headers.get('cache-control'), 'no-cache');
    assert.equal(gunzipSync(await response.bytes()).toString(), WORKER_JS);
  });

  it('never compresses API responses, whose streams must flush per event', async () => {
    const response = await app.request('/v1/models', { headers: { 'accept-encoding': 'gzip, br' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-encoding'), null);
  });

  it('keeps unknown API routes as JSON 404s', async () => {
    const response = await app.request('/v1/nope', navigation);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('content-type')?.includes('application/json'), true);
  });

  it('404s a missing asset instead of returning the shell', async () => {
    const response = await app.request('/assets/gone-000000.js');
    assert.equal(response.status, 404);
  });

  it('still answers the health check', async () => {
    const response = await app.request('/healthz');
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'OK!');
  });
});

describe('without a frontend build', () => {
  const app = createApp(path.join(tmpdir(), 'harness-frontend-absent'));

  it('404s the root', async () => {
    const response = await app.request('/', navigation);
    assert.equal(response.status, 404);
  });
});
