import winston from 'winston';
import { createAvailableMcpServersRouter, createMcpServersRouter } from '../../../src/apis/mcpServers';
import { McpCatalog } from '../../../src/catalog/McpCatalog';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteMcpServerStore } from '../../../src/db/sqlite/mcp-server-store/SqliteMcpServerStore';
import { SqliteOAuthTokenStore } from '../../../src/db/sqlite/token-store/SqliteOAuthTokenStore';

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
    const tokenStore = new SqliteOAuthTokenStore(db);
    settingsRouter = createMcpServersRouter({
      mcpCatalog: McpCatalog.load(),
      mcpServerStore,
      tokenStore,
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

    const badName = await settingsRouter.request('/', putInit({ ...putBody, name: 'Not A Name' }));
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

  it('GET /{name}/authorize short-circuits non-DCR servers and 404s unknowns', async () => {
    const authenticated = await settingsRouter.request('/deepwiki/authorize?redirect_url=https://example.com/callback');
    expect(authenticated.status).toBe(200);
    expect(await authenticated.json()).toEqual({ status: 'authenticated' });

    const headerAuth = await settingsRouter.request('/private-mcp/authorize?redirect_url=https://example.com/callback');
    expect(headerAuth.status).toBe(200);
    expect(await headerAuth.json()).toEqual({ status: 'authenticated' });

    const missing = await settingsRouter.request('/missing/authorize?redirect_url=https://example.com/callback');
    expect(missing.status).toBe(404);
  });

  it('GET /{name}/authorize for DCR returns auth_required with an authorization_url', async () => {
    const asOrigin = 'https://auth.example.com';
    const mcpUrl = 'https://mcp.example.com/sse';
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.includes('oauth-protected-resource')) {
        return new Response(JSON.stringify({ resource: mcpUrl, authorization_servers: [asOrigin] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('oauth-authorization-server') || url.includes('openid-configuration')) {
        return new Response(
          JSON.stringify({
            issuer: asOrigin,
            authorization_endpoint: `${asOrigin}/authorize`,
            token_endpoint: `${asOrigin}/token`,
            registration_endpoint: `${asOrigin}/register`,
            response_types_supported: ['code'],
            code_challenge_methods_supported: ['S256'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
            token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/register') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            client_id: 'dyn-client-1',
            client_secret: 'dyn-secret-1',
            token_endpoint_auth_method: 'client_secret_post',
            redirect_uris: [`${process.env['PUBLIC_BASE_URL'] ?? ''}/api/v1/mcp-servers/oauth/callback`],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(`unexpected url: ${url}`, { status: 404 });
    }) as typeof fetch;

    try {
      const put = await settingsRouter.request(
        '/',
        putInit({
          type: 'remote',
          name: 'oauth-mcp',
          url: mcpUrl,
          auth: { type: 'dcr' },
        }),
      );
      expect(put.status).toBe(200);

      const authorize = await settingsRouter.request(
        '/oauth-mcp/authorize?redirect_url=https://example.com/after-oauth',
      );
      expect(authorize.status).toBe(200);
      const body = (await authorize.json()) as { status: string; authorization_url?: string };
      expect(body.status).toBe('auth_required');
      expect(body.authorization_url).toBeDefined();
      const authUrl = new URL(body.authorization_url ?? '');
      expect(authUrl.origin).toBe(asOrigin);
      expect(authUrl.searchParams.get('client_id')).toBe('dyn-client-1');
      expect(authUrl.searchParams.get('state')).toBeTruthy();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
