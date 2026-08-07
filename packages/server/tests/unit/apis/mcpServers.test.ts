import winston from 'winston';
import { createMcpServersRouter, createSettingsMcpServersRouter } from '../../../src/apis/mcpServers';
import { TENANT_ID } from '../../../src/apis/sessions';
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
  let settingsRouter: ReturnType<typeof createSettingsMcpServersRouter>;
  let mcpServersRouter: ReturnType<typeof createMcpServersRouter>;
  let mcpServerStore: SqliteMcpServerStore;
  let tokenStore: SqliteOAuthTokenStore;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    // Eager DCR registration dials the MCP server's authorization server. Fail that outbound call
    // fast so DCR upserts stay hermetic; the handler treats it as transient and still returns 200.
    globalThis.fetch = (async () => {
      throw new Error('network disabled in tests');
    }) as typeof fetch;
    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    mcpServerStore = new SqliteMcpServerStore(db);
    tokenStore = new SqliteOAuthTokenStore(db);
    const logger = winston.createLogger({ silent: true });
    settingsRouter = createSettingsMcpServersRouter({
      mcpCatalog: McpCatalog.load(),
      mcpServerStore,
      tokenStore,
      logger,
    });
    mcpServersRouter = createMcpServersRouter({
      mcpServerStore,
      tokenStore,
      logger,
    });
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
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

  it('PUT upserts a server and returns not_required auth_status for no-auth servers', async () => {
    const response = await settingsRouter.request('/', putInit(putBody));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { ...putBody, auth_status: { status: 'not_required' } },
    });

    const list = await settingsRouter.request('/');
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({
      data: [{ ...putBody, auth_status: { status: 'not_required' } }],
    });
  });

  it('GET /{name} returns the configured server and 404s unknowns', async () => {
    const response = await settingsRouter.request(`/${putBody.name}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { ...putBody, auth_status: { status: 'not_required' } },
    });

    const missing = await settingsRouter.request('/missing');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: { message: 'MCP server not found: missing' },
    });
  });

  it('PUT with DCR auth reports auth_required while no token is stored', async () => {
    const response = await settingsRouter.request('/', putInit(putBodyWithDcr));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { ...putBodyWithDcr, auth_status: { status: 'auth_required' } },
    });
  });

  it('DCR server reads authenticated once an unexpired token is stored, auth_required once expired', async () => {
    await settingsRouter.request('/', putInit(putBodyWithDcr));
    const record = await mcpServerStore.getServer({ tenant_id: TENANT_ID, name: putBodyWithDcr.name });
    if (record === undefined) throw new Error('expected DCR server to exist');

    await tokenStore.saveToken({
      id: record.id,
      token: {
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: '2099-01-01T00:00:00.000Z',
        scope: null,
      },
    });

    const authed = await settingsRouter.request('/');
    const authedBody = (await authed.json()) as { data: { name: string; auth_status: { status: string } }[] };
    expect(authedBody.data.find(server => server.name === putBodyWithDcr.name)?.auth_status).toEqual({
      status: 'authenticated',
    });

    await tokenStore.saveToken({
      id: record.id,
      token: {
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: '2000-01-01T00:00:00.000Z',
        scope: null,
      },
    });

    const expired = await settingsRouter.request('/');
    const expiredBody = (await expired.json()) as { data: { name: string; auth_status: { status: string } }[] };
    expect(expiredBody.data.find(server => server.name === putBodyWithDcr.name)?.auth_status).toEqual({
      status: 'auth_required',
    });

    await tokenStore.deleteToken({ id: record.id });
  });

  it('PUT re-upsert of a DCR server reports authenticated when a usable token already exists', async () => {
    // First upsert creates the row (no token yet) so we can key a token off its id.
    await settingsRouter.request('/', putInit(putBodyWithDcr));
    const record = await mcpServerStore.getServer({ tenant_id: TENANT_ID, name: putBodyWithDcr.name });
    if (record === undefined) throw new Error('expected DCR server to exist');

    await tokenStore.saveToken({
      id: record.id,
      token: {
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: '2099-01-01T00:00:00.000Z',
        scope: null,
      },
    });

    // A re-upsert preserves the id, so the PUT response must reflect the carried-over token.
    const response = await settingsRouter.request('/', putInit(putBodyWithDcr));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { ...putBodyWithDcr, auth_status: { status: 'authenticated' } },
    });

    await tokenStore.deleteToken({ id: record.id });
  });

  it('PUT with header auth stores headers and reports authenticated', async () => {
    const response = await settingsRouter.request('/', putInit(putBodyWithHeaderAuth));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { ...putBodyWithHeaderAuth, auth_status: { status: 'authenticated' } },
    });
  });

  it('GET / on the chat router returns the slim projection without auth fields', async () => {
    const response = await mcpServersRouter.request('/');
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
    const noAuth = await mcpServersRouter.request('/deepwiki/authorize?redirect_url=https://example.com/callback');
    expect(noAuth.status).toBe(200);
    expect(await noAuth.json()).toEqual({ status: 'not_required' });

    const headerAuth = await mcpServersRouter.request(
      '/private-mcp/authorize?redirect_url=https://example.com/callback',
    );
    expect(headerAuth.status).toBe(200);
    expect(await headerAuth.json()).toEqual({ status: 'authenticated' });

    const missing = await mcpServersRouter.request('/missing/authorize?redirect_url=https://example.com/callback');
    expect(missing.status).toBe(404);
  });

  it('GET /{name}/authorize returns 424 when upstream DCR registration fails', async () => {
    const asOrigin = 'https://auth-failure.example.com';
    const mcpUrl = 'https://mcp-failure.example.com/sse';
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async input => {
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
      if (url.includes('/register')) {
        return new Response('upstream unavailable', { status: 500 });
      }
      return new Response(`unexpected url: ${url}`, { status: 404 });
    }) as typeof fetch;

    try {
      const put = await settingsRouter.request(
        '/',
        putInit({
          type: 'remote',
          name: 'failing-oauth-mcp',
          url: mcpUrl,
          auth: { type: 'dcr' },
        }),
      );
      expect(put.status).toBe(200);

      const authorize = await mcpServersRouter.request('/failing-oauth-mcp/authorize');
      expect(authorize.status).toBe(424);
      expect(await authorize.json()).toEqual({
        error: { message: "Failed to dynamically register OAuth client for MCP server 'failing-oauth-mcp'" },
      });
    } finally {
      globalThis.fetch = realFetch;
    }
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

      const authorize = await mcpServersRouter.request(
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

  it('DELETE /{name}/authorize removes the DCR token, keeps the client, and reports auth_required', async () => {
    await settingsRouter.request('/', putInit(putBodyWithDcr));
    const record = await mcpServerStore.getServer({ tenant_id: TENANT_ID, name: putBodyWithDcr.name });
    if (!record) {
      throw new Error('expected DCR server to exist');
    }

    await mcpServerStore.saveClient({
      id: record.id,
      record: {
        server: {
          authorizationEndpoint: 'https://auth.example.com/authorize',
          tokenEndpoint: 'https://auth.example.com/token',
          codeChallengeMethodsSupported: ['S256'],
        },
        client: {
          clientId: 'keep-me',
          clientSecret: 'keep-secret',
        },
      },
    });
    await tokenStore.saveToken({
      id: record.id,
      token: {
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: '2099-01-01T00:00:00.000Z',
        scope: null,
      },
    });

    const response = await mcpServersRouter.request(`/${putBodyWithDcr.name}/authorize`, { method: 'DELETE' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { ...putBodyWithDcr, auth_status: { status: 'auth_required' } },
    });
    expect(await tokenStore.getToken({ id: record.id })).toBeUndefined();
    expect(await mcpServerStore.getClient({ id: record.id })).toEqual({
      server: {
        authorizationEndpoint: 'https://auth.example.com/authorize',
        tokenEndpoint: 'https://auth.example.com/token',
        codeChallengeMethodsSupported: ['S256'],
      },
      client: {
        clientId: 'keep-me',
        clientSecret: 'keep-secret',
      },
    });
  });

  it('DELETE /{name}/authorize is a no-op for non-DCR servers and 404s unknowns', async () => {
    const noAuth = await mcpServersRouter.request('/deepwiki/authorize', { method: 'DELETE' });
    expect(noAuth.status).toBe(200);
    expect(await noAuth.json()).toEqual({
      data: { ...putBody, auth_status: { status: 'not_required' } },
    });

    const headerAuth = await mcpServersRouter.request('/private-mcp/authorize', { method: 'DELETE' });
    expect(headerAuth.status).toBe(200);
    expect(await headerAuth.json()).toEqual({
      data: { ...putBodyWithHeaderAuth, auth_status: { status: 'authenticated' } },
    });

    const missing = await mcpServersRouter.request('/missing/authorize', { method: 'DELETE' });
    expect(missing.status).toBe(404);
  });
});
