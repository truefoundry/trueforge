import { TENANT_ID } from '../../../src/apis/sessions';
import { LOCAL_USER_CONTEXT } from '../../../src/auth/identity';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteMcpServerStore } from '../../../src/db/sqlite/mcp-server-store/SqliteMcpServerStore';
import { SqliteOAuthTokenStore } from '../../../src/db/sqlite/token-store/SqliteOAuthTokenStore';
import { mcpOAuthCallbackUrl } from '../../../src/mcp/auth/mcpOAuthHelpers';
import { getMcpConnection } from '../../../src/runtime/sessionResources';

describe('getMcpConnection', () => {
  let db: ReturnType<typeof createSqliteDb>;
  let mcpServerStore: SqliteMcpServerStore;
  let tokenStore: SqliteOAuthTokenStore;

  beforeAll(async () => {
    db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    mcpServerStore = new SqliteMcpServerStore(db);
    tokenStore = new SqliteOAuthTokenStore(db);
  });

  it('returns an async DCR headers resolver keyed by server name on authRequired', async () => {
    const asOrigin = 'https://auth.example.com';
    const mcpUrl = 'https://mcp.oauth.example/sse';
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
            redirect_uris: [mcpOAuthCallbackUrl()],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(`unexpected url: ${url}`, { status: 404 });
    }) as typeof fetch;

    try {
      const record = await mcpServerStore.upsertServer({
        tenant_id: TENANT_ID,
        name: 'oauth-mcp',
        manifest: {
          type: 'remote',
          name: 'oauth-mcp',
          url: mcpUrl,
          description: 'OAuth MCP server.',
          auth: { type: 'dcr' },
        },
      });

      const connection = await getMcpConnection({
        tenant_id: TENANT_ID,
        name: 'oauth-mcp',
        store: mcpServerStore,
        tokenStore,
        clientName: 'test-client',
        userRef: LOCAL_USER_CONTEXT.userRef,
      });
      expect(connection).toBeDefined();
      if (connection === undefined) {
        throw new Error('expected connection');
      }

      expect(connection.url).toBe(mcpUrl);
      expect(typeof connection.headers).toBe('function');
      if (typeof connection.headers !== 'function') {
        throw new Error('expected async headers resolver');
      }

      const headersResult = await connection.headers();
      expect('authRequired' in headersResult).toBe(true);
      if (!('authRequired' in headersResult)) {
        throw new Error('expected authRequired');
      }
      expect(headersResult.authRequired.servers).toEqual([
        {
          id: 'oauth-mcp',
          name: 'oauth-mcp',
          auth_url: expect.stringContaining(`${asOrigin}/authorize`),
        },
      ]);
      expect(record.id).not.toBe('oauth-mcp');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('returns Bearer headers when a usable token is already stored', async () => {
    const record = await mcpServerStore.upsertServer({
      tenant_id: TENANT_ID,
      name: 'tokened-mcp',
      manifest: {
        type: 'remote',
        name: 'tokened-mcp',
        url: 'https://mcp.tokened.example/mcp',
        description: 'Tokened MCP server.',
        auth: { type: 'dcr' },
      },
    });
    await tokenStore.saveToken({
      id: record.id,
      userRef: LOCAL_USER_CONTEXT.userRef,
      token: {
        accessToken: 'live-access',
        refreshToken: null,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        scope: null,
      },
    });

    const connection = await getMcpConnection({
      tenant_id: TENANT_ID,
      name: 'tokened-mcp',
      store: mcpServerStore,
      tokenStore,
      clientName: 'test-client',
      userRef: LOCAL_USER_CONTEXT.userRef,
    });
    expect(connection).toBeDefined();
    if (connection === undefined || typeof connection.headers !== 'function') {
      throw new Error('expected async headers resolver');
    }
    await expect(connection.headers()).resolves.toEqual({
      headers: { Authorization: 'Bearer live-access' },
    });
  });

  it('returns empty static headers when the server has no auth', async () => {
    await mcpServerStore.upsertServer({
      tenant_id: TENANT_ID,
      name: 'open-mcp',
      manifest: {
        type: 'remote',
        name: 'open-mcp',
        url: 'https://mcp.open.example/mcp',
        description: 'Open MCP server.',
      },
    });

    const connection = await getMcpConnection({
      tenant_id: TENANT_ID,
      name: 'open-mcp',
      store: mcpServerStore,
      tokenStore,
      clientName: 'test-client',
      userRef: LOCAL_USER_CONTEXT.userRef,
    });
    expect(connection).toBeDefined();
    if (connection === undefined) {
      throw new Error('expected connection');
    }

    expect(connection.url).toBe('https://mcp.open.example/mcp');
    expect(connection.headers).toEqual({});
  });

  it('returns configured static headers for header-auth servers', async () => {
    await mcpServerStore.upsertServer({
      tenant_id: TENANT_ID,
      name: 'header-mcp',
      manifest: {
        type: 'remote',
        name: 'header-mcp',
        url: 'https://mcp.header.example/mcp',
        description: 'Header MCP server.',
        auth: { type: 'header', headers: { Authorization: 'Bearer static-token' } },
      },
    });

    const connection = await getMcpConnection({
      tenant_id: TENANT_ID,
      name: 'header-mcp',
      store: mcpServerStore,
      tokenStore,
      clientName: 'test-client',
      userRef: LOCAL_USER_CONTEXT.userRef,
    });
    expect(connection).toBeDefined();
    if (connection === undefined) {
      throw new Error('expected connection');
    }

    expect(connection.url).toBe('https://mcp.header.example/mcp');
    expect(connection.headers).toEqual({ Authorization: 'Bearer static-token' });
  });

  it('returns undefined when the server is not registered', async () => {
    await expect(
      getMcpConnection({
        tenant_id: TENANT_ID,
        name: 'missing-mcp',
        store: mcpServerStore,
        tokenStore,
        clientName: 'test-client',
        userRef: LOCAL_USER_CONTEXT.userRef,
      }),
    ).resolves.toBeUndefined();
  });
});
