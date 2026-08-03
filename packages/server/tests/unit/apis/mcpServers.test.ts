import winston from 'winston';
import { createAvailableMcpServersRouter, createMcpServersRouter } from '../../../src/apis/mcpServers';
import { McpCatalog } from '../../../src/catalog/McpCatalog';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteMcpServerStore } from '../../../src/db/sqlite/mcp-server-store/SqliteMcpServerStore';

const putBody = {
  type: 'remote' as const,
  name: 'deepwiki',
  url: 'https://mcp.deepwiki.com/mcp',
};

const putBodyWithDcr = {
  type: 'remote' as const,
  name: 'linear',
  url: 'https://mcp.linear.app/mcp',
  auth: { type: 'dcr' as const },
};

const putBodyWithHeaderAuth = {
  type: 'remote' as const,
  name: 'private-mcp',
  url: 'https://mcp.example.com/mcp',
  auth: {
    type: 'header' as const,
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

describe('mcp-servers routers', () => {
  let settingsRouter: ReturnType<typeof createMcpServersRouter>;
  let availableRouter: ReturnType<typeof createAvailableMcpServersRouter>;

  beforeAll(async () => {
    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    const mcpServerStore = new SqliteMcpServerStore(db);
    settingsRouter = createMcpServersRouter({
      mcpCatalog: McpCatalog.load(),
      mcpServerStore,
      logger: winston.createLogger({ silent: true }),
    });
    availableRouter = createAvailableMcpServersRouter(mcpServerStore);
  });

  it('GET /catalog returns the shipped catalog verbatim', async () => {
    const response = await settingsRouter.request('/catalog');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { name: string }[] };
    expect(body.data.map(server => server.name)).toEqual(
      McpCatalog.load()
        .list()
        .map(server => server.name),
    );
  });

  it('PUT upserts a server and returns stub auth_status', async () => {
    const response = await settingsRouter.request('/', putInit(putBody));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { ...putBody, auth_status: { status: 'authenticated' } },
    });

    const list = await settingsRouter.request('/');
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({
      data: [{ ...putBody, auth_status: { status: 'authenticated' } }],
    });
  });

  it('PUT with DCR auth stubs auth_required without authorization_url', async () => {
    const response = await settingsRouter.request('/', putInit(putBodyWithDcr));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { ...putBodyWithDcr, auth_status: { status: 'auth_required' } },
    });
  });

  it('PUT with header auth stores headers and reports authenticated', async () => {
    const response = await settingsRouter.request('/', putInit(putBodyWithHeaderAuth));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { ...putBodyWithHeaderAuth, auth_status: { status: 'authenticated' } },
    });
  });

  it('GET / on the chat router returns the slim projection without auth fields', async () => {
    const response = await availableRouter.request('/');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { name: string; url: string }[] };
    expect(body.data.map(server => server.name).sort()).toEqual(['deepwiki', 'linear', 'private-mcp']);
    expect(body.data.every(server => Object.keys(server).sort().join(',') === 'name,url')).toBe(true);
  });

  it('PUT rejects invalid bodies at the Zod layer', async () => {
    const { url: _, ...withoutUrl } = putBody;
    const missingUrl = await settingsRouter.request('/', putInit(withoutUrl));
    expect(missingUrl.status).toBe(400);

    const badName = await settingsRouter.request('/', putInit({ ...putBody, name: 'Not A Slug' }));
    expect(badName.status).toBe(400);

    const emptyHeaders = await settingsRouter.request(
      '/',
      putInit({
        ...putBodyWithHeaderAuth,
        name: 'bad-empty-headers',
        auth: { type: 'header', headers: {} },
      }),
    );
    expect(emptyHeaders.status).toBe(400);
  });

  it('GET /{name}/authorize stubs auth for configured servers', async () => {
    const authenticated = await settingsRouter.request('/deepwiki/authorize?redirect_url=https://example.com/callback');
    expect(authenticated.status).toBe(200);
    expect(await authenticated.json()).toEqual({ status: 'authenticated' });

    const headerAuth = await settingsRouter.request('/private-mcp/authorize?redirect_url=https://example.com/callback');
    expect(headerAuth.status).toBe(200);
    expect(await headerAuth.json()).toEqual({ status: 'authenticated' });

    const required = await settingsRouter.request('/linear/authorize?redirect_url=https://example.com/callback');
    expect(required.status).toBe(200);
    const body = (await required.json()) as { status: string; authorization_url?: string };
    expect(body.status).toBe('auth_required');
    expect(body.authorization_url?.includes('redirect_uri=')).toBe(true);

    const missing = await settingsRouter.request('/missing/authorize?redirect_url=https://example.com/callback');
    expect(missing.status).toBe(404);
  });
});
