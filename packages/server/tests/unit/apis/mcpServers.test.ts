import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import winston from 'winston';
import { createMcpServersRouter } from '../../../src/apis/mcpServers';
import { McpCatalog } from '../../../src/catalog/McpCatalog';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteMcpServerStore } from '../../../src/db/sqlite/mcp-server-store/SqliteMcpServerStore';

const putBody = {
  name: 'deepwiki',
  url: 'https://mcp.deepwiki.com/mcp',
};

const putBodyWithDcr = {
  name: 'linear',
  url: 'https://mcp.linear.app/mcp',
  auth: { type: 'dcr' as const },
};

const putBodyWithHeaderAuth = {
  name: 'private-mcp',
  url: 'https://mcp.example.com/mcp',
  auth: {
    type: 'header' as const,
    auth_level: 'global' as const,
    headers: { Authorization: 'Bearer test-token' },
  },
};

function putInit(body: unknown): RequestInit {
  return {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

describe('mcp-servers router', () => {
  let router: ReturnType<typeof createMcpServersRouter>;

  before(async () => {
    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    router = createMcpServersRouter({
      mcpCatalog: McpCatalog.load(),
      mcpServerStore: new SqliteMcpServerStore(db),
      logger: winston.createLogger({ silent: true }),
    });
  });

  it('GET /catalog returns the shipped catalog verbatim', async () => {
    const response = await router.request('/catalog');
    assert.equal(response.status, 200);
    const body = (await response.json()) as { data: { name: string }[] };
    assert.deepEqual(
      body.data.map(server => server.name),
      McpCatalog.load()
        .list()
        .map(server => server.name),
    );
  });

  it('PUT upserts a server and returns stub auth_status', async () => {
    const response = await router.request('/', putInit(putBody));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      data: { ...putBody, auth_status: { status: 'authenticated' } },
    });

    const list = await router.request('/');
    assert.equal(list.status, 200);
    assert.deepEqual(await list.json(), {
      data: [{ ...putBody, auth_status: { status: 'authenticated' } }],
    });
  });

  it('PUT with DCR auth stubs auth_required without authorization_url', async () => {
    const response = await router.request('/', putInit(putBodyWithDcr));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      data: { ...putBodyWithDcr, auth_status: { status: 'auth_required' } },
    });
  });

  it('PUT with header global auth stores headers and reports authenticated', async () => {
    const response = await router.request('/', putInit(putBodyWithHeaderAuth));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      data: { ...putBodyWithHeaderAuth, auth_status: { status: 'authenticated' } },
    });
  });

  it('GET /available returns the slim chat projection without auth fields', async () => {
    const response = await router.request('/available');
    assert.equal(response.status, 200);
    const body = (await response.json()) as { data: { name: string; url: string }[] };
    assert.deepEqual(body.data.map(server => server.name).sort(), ['deepwiki', 'linear', 'private-mcp']);
    assert.ok(body.data.every(server => Object.keys(server).sort().join(',') === 'name,url'));
  });

  it('PUT rejects invalid bodies at the Zod layer', async () => {
    const { url: _, ...withoutUrl } = putBody;
    const missingUrl = await router.request('/', putInit(withoutUrl));
    assert.equal(missingUrl.status, 400);

    const badName = await router.request('/', putInit({ ...putBody, name: 'Not A Slug' }));
    assert.equal(badName.status, 400);

    const perUser = await router.request(
      '/',
      putInit({
        ...putBodyWithHeaderAuth,
        name: 'bad-per-user',
        auth: {
          type: 'header',
          auth_level: 'per_user',
          headers: { Authorization: 'Bearer x' },
        },
      }),
    );
    assert.equal(perUser.status, 400);

    const emptyHeaders = await router.request(
      '/',
      putInit({
        ...putBodyWithHeaderAuth,
        name: 'bad-empty-headers',
        auth: { type: 'header', auth_level: 'global', headers: {} },
      }),
    );
    assert.equal(emptyHeaders.status, 400);
  });

  it('GET /{name}/authorize stubs auth for configured servers', async () => {
    const authenticated = await router.request('/deepwiki/authorize?redirect_url=https://example.com/callback');
    assert.equal(authenticated.status, 200);
    assert.deepEqual(await authenticated.json(), { status: 'authenticated' });

    const headerAuth = await router.request('/private-mcp/authorize?redirect_url=https://example.com/callback');
    assert.equal(headerAuth.status, 200);
    assert.deepEqual(await headerAuth.json(), { status: 'authenticated' });

    const required = await router.request('/linear/authorize?redirect_url=https://example.com/callback');
    assert.equal(required.status, 200);
    const body = (await required.json()) as { status: string; authorization_url?: string };
    assert.equal(body.status, 'auth_required');
    assert.ok(body.authorization_url?.includes('redirect_uri='));

    const missing = await router.request('/missing/authorize?redirect_url=https://example.com/callback');
    assert.equal(missing.status, 404);
  });
});
