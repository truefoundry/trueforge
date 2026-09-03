import winston from 'winston';
import { createCatalogRouter } from '../../../src/apis/catalog';
import { createMcpServersRouter, createSettingsMcpServersRouter } from '../../../src/apis/mcpServers';
import { TENANT_ID } from '../../../src/apis/sessions';
import { LOCAL_USER_CONTEXT } from '../../../src/auth/identity';
import { McpCatalog } from '../../../src/catalog/McpCatalog';
import { ModelCatalog } from '../../../src/catalog/ModelCatalog';
import { SandboxCatalog } from '../../../src/catalog/SandboxCatalog';
import { SkillCatalog } from '../../../src/catalog/SkillCatalog';
import configuration from '../../../src/config';
import { McpServerWithAuthStore } from '../../../src/db/McpServerWithAuthStore';
import type { IMcpServerWithAuthStore } from '../../../src/db/mcpServerStore';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteMcpServerStore } from '../../../src/db/sqlite/mcp-server-store/SqliteMcpServerStore';
import { SqliteOAuthTokenStore } from '../../../src/db/sqlite/token-store/SqliteOAuthTokenStore';
import { mcpOAuthCallbackUrl } from '../../../src/mcp/auth/mcpOAuthHelpers';

const putBody = {
  type: 'remote' as const,
  name: 'deepwiki',
  url: 'https://mcp.deepwiki.com/mcp',
  description: 'DeepWiki MCP server.',
};

const putBodyWithDcr = {
  type: 'remote' as const,
  name: 'linear',
  url: 'https://mcp.linear.app/mcp',
  description: 'Linear MCP server.',
  auth: { type: 'dcr' as const },
};

const HEADER_TOKEN = 'Bearer test-token';
/** Wire form of HEADER_TOKEN for length ≥ 10: first 3 + SECRET_REDACTION + last 3. */
const HEADER_TOKEN_REDACTED = 'Bea-***REDACTED***-ken';

const putBodyWithHeaderAuth = {
  type: 'remote' as const,
  name: 'private-mcp',
  url: 'https://mcp.example.com/mcp',
  description: 'Private MCP server.',
  auth: {
    type: 'header' as const,
    headers: { Authorization: HEADER_TOKEN },
  },
};

const putBodyWithHeaderAuthWire = {
  ...putBodyWithHeaderAuth,
  auth: {
    type: 'header' as const,
    headers: { Authorization: HEADER_TOKEN_REDACTED },
  },
};

function wrapManifest(manifest: unknown) {
  return { manifest };
}

function configured(manifest: { name: string } & Record<string, unknown>, status: string) {
  return {
    name: manifest.name,
    manifest,
    auth_status: { status },
  };
}

function putInit(body: unknown): RequestInit {
  return {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function postInit(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

describe('mcp-servers routers', () => {
  let settingsRouter: ReturnType<typeof createSettingsMcpServersRouter>;
  let catalogRouter: ReturnType<typeof createCatalogRouter>;
  let mcpServersRouter: ReturnType<typeof createMcpServersRouter>;
  let mcpServerStore: IMcpServerWithAuthStore;
  let tokenStore: SqliteOAuthTokenStore;
  let withTransaction: <T>(callback: (transaction: unknown) => Promise<T>) => Promise<T>;
  let logger: ReturnType<typeof winston.createLogger>;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    // Eager DCR dials the authorization server. Fail that outbound call fast so hermetic tests
    // without an OAuth mock hit the "DCR before write" path and must not create rows.
    globalThis.fetch = (async () => {
      throw new Error('network disabled in tests');
    }) as typeof fetch;
    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    tokenStore = new SqliteOAuthTokenStore(db);
    mcpServerStore = new McpServerWithAuthStore({
      store: new SqliteMcpServerStore(db),
      tokenStore,
      clientName: configuration.MCP_DCR_OAUTH_CLIENT_NAME,
    });
    withTransaction = callback => db.transaction().execute(callback);
    logger = winston.createLogger({ silent: true });
    settingsRouter = createSettingsMcpServersRouter({
      resolveMcpServerStore: () => mcpServerStore,
      tokenStore,
      withTransaction,
      logger,
      resolveUserContext: () => LOCAL_USER_CONTEXT,
    });
    catalogRouter = createCatalogRouter({
      modelCatalog: ModelCatalog.load(),
      mcpCatalog: McpCatalog.load(),
      skillCatalog: SkillCatalog.load(),
      sandboxCatalog: SandboxCatalog.load(),
    });
    mcpServersRouter = createMcpServersRouter({
      resolveMcpServerStore: () => mcpServerStore,
      tokenStore,
      withTransaction,
      logger,
      resolveUserContext: () => LOCAL_USER_CONTEXT,
    });
  });

  /** Persist a DCR server + stub client without calling the authorization server. */
  async function seedDcrServerWithClient(body: typeof putBodyWithDcr = putBodyWithDcr) {
    const record = await mcpServerStore.upsertServer({
      tenant_id: TENANT_ID,
      name: body.name,
      manifest: body,
    });
    await mcpServerStore.saveClient({
      id: record.id,
      record: {
        server: {
          authorizationEndpoint: 'https://auth.example.com/authorize',
          tokenEndpoint: 'https://auth.example.com/token',
          codeChallengeMethodsSupported: ['S256'],
        },
        client: {
          clientId: 'seed-client',
          clientSecret: 'seed-secret',
        },
      },
    });
    return record;
  }

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it('GET /catalogs/mcp-servers returns the shipped catalog verbatim', async () => {
    const response = await catalogRouter.request('/mcp-servers');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { name: string }[] };
    expect(body.data.map(server => server.name)).toEqual(
      McpCatalog.load()
        .list()
        .map(server => server.name),
    );
  });

  it('PUT upserts a server and returns not_required auth_status for no-auth servers', async () => {
    const response = await settingsRouter.request('/', putInit(wrapManifest(putBody)));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: configured(putBody, 'not_required'),
    });

    const list = await settingsRouter.request('/');
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({
      data: [configured(putBody, 'not_required')],
    });
  });

  it('POST creates a server and returns 409 on name clash', async () => {
    const createBody = {
      type: 'remote' as const,
      name: 'create-only-mcp',
      url: 'https://mcp.example.com/create-only',
      description: 'Create-only MCP server.',
    };
    const created = await settingsRouter.request('/', postInit(wrapManifest(createBody)));
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({
      data: configured(createBody, 'not_required'),
    });

    const clash = await settingsRouter.request('/', postInit(wrapManifest(createBody)));
    expect(clash.status).toBe(409);
    expect(await clash.json()).toEqual({
      error: { message: 'MCP server name already exists: create-only-mcp' },
    });
  });

  it('GET /{name} returns the configured server and 404s unknowns', async () => {
    const response = await settingsRouter.request(`/${putBody.name}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: configured(putBody, 'not_required'),
    });

    const missing = await settingsRouter.request('/missing');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: { message: 'MCP server not found: missing' },
    });
  });

  it('PUT with DCR fails registration without writing a server row', async () => {
    const response = await settingsRouter.request('/', putInit(wrapManifest(putBodyWithDcr)));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: {
        message: "Failed to discover OAuth authorization server for MCP server 'linear'",
      },
    });
    expect(await mcpServerStore.getServer({ tenant_id: TENANT_ID, name: putBodyWithDcr.name })).toBeUndefined();
  });

  it('POST with DCR fails registration without writing a server row', async () => {
    const createDcr = {
      type: 'remote' as const,
      name: 'create-dcr-fail',
      url: 'https://mcp.example.com/dcr-fail',
      description: 'Create DCR fail MCP server.',
      auth: { type: 'dcr' as const },
    };
    const response = await settingsRouter.request('/', postInit(wrapManifest(createDcr)));
    expect(response.status).toBe(422);
    expect(await mcpServerStore.getServer({ tenant_id: TENANT_ID, name: createDcr.name })).toBeUndefined();
  });

  it('DCR server reads authenticated when a token row exists, auth_required once deleted', async () => {
    const record = await seedDcrServerWithClient();

    await tokenStore.saveToken({
      id: record.id,
      userRef: LOCAL_USER_CONTEXT.userRef,
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

    // List auth_status is presence-based; expiry is handled at resolve/refresh time.
    await tokenStore.saveToken({
      id: record.id,
      userRef: LOCAL_USER_CONTEXT.userRef,
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
      status: 'authenticated',
    });

    await tokenStore.deleteToken({ id: record.id, userRef: LOCAL_USER_CONTEXT.userRef });

    const cleared = await settingsRouter.request('/');
    const clearedBody = (await cleared.json()) as { data: { name: string; auth_status: { status: string } }[] };
    expect(clearedBody.data.find(server => server.name === putBodyWithDcr.name)?.auth_status).toEqual({
      status: 'auth_required',
    });
  });

  it('PUT re-upsert of a DCR server reports authenticated when a usable token already exists', async () => {
    // Existing client skips DCR over the wire so network-disabled tests only exercise the DB path.
    const record = await seedDcrServerWithClient();

    await tokenStore.saveToken({
      id: record.id,
      userRef: LOCAL_USER_CONTEXT.userRef,
      token: {
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: '2099-01-01T00:00:00.000Z',
        scope: null,
      },
    });

    // A re-upsert preserves the id, so the PUT response must reflect the carried-over token.
    const response = await settingsRouter.request('/', putInit(wrapManifest(putBodyWithDcr)));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: configured(putBodyWithDcr, 'authenticated'),
    });

    await tokenStore.deleteToken({ id: record.id, userRef: LOCAL_USER_CONTEXT.userRef });
  });

  it('PUT URL change re-registers DCR and clears tokens and pending authorizations', async () => {
    const record = await seedDcrServerWithClient();
    await tokenStore.saveToken({
      id: record.id,
      userRef: LOCAL_USER_CONTEXT.userRef,
      token: {
        accessToken: 'stale-for-old-url',
        refreshToken: 'stale-refresh',
        expiresAt: '2099-01-01T00:00:00.000Z',
        scope: null,
      },
    });
    await tokenStore.saveToken({
      id: record.id,
      userRef: 'other-user',
      token: {
        accessToken: 'stale-other-user',
        refreshToken: 'stale-other-refresh',
        expiresAt: '2099-01-01T00:00:00.000Z',
        scope: null,
      },
    });
    await tokenStore.savePendingAuthorization({
      state: 'stale-pending-state',
      id: record.id,
      userRef: LOCAL_USER_CONTEXT.userRef,
      mcpServerUrl: putBodyWithDcr.url,
      codeVerifier: 'stale-verifier',
      returnTo: null,
    });

    const newUrl = 'https://mcp.linear.app/v2/mcp';
    const asOrigin = 'https://auth.example.com';
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.includes('oauth-protected-resource')) {
        return new Response(JSON.stringify({ resource: newUrl, authorization_servers: [asOrigin] }), {
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
            client_id: 'new-url-client',
            client_secret: 'new-url-secret',
            token_endpoint_auth_method: 'client_secret_post',
            // Absolute URLs only — SDK parses registration responses with SafeUrlSchema.
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
      const response = await settingsRouter.request(
        '/',
        putInit(
          wrapManifest({
            ...putBodyWithDcr,
            url: newUrl,
          }),
        ),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        data: configured({ ...putBodyWithDcr, url: newUrl }, 'auth_required'),
      });
      expect(await tokenStore.getToken({ id: record.id, userRef: LOCAL_USER_CONTEXT.userRef })).toBeUndefined();
      expect(await tokenStore.getToken({ id: record.id, userRef: 'other-user' })).toBeUndefined();
      expect(await tokenStore.consumePendingAuthorization({ state: 'stale-pending-state' })).toBeUndefined();
      expect(await mcpServerStore.getClient({ id: record.id })).toMatchObject({
        client: { clientId: 'new-url-client' },
      });
    } finally {
      globalThis.fetch = realFetch;
      // Restore baseline for later suite cases that still expect original linear URL / no token.
      await mcpServerStore.upsertServer({
        tenant_id: TENANT_ID,
        name: putBodyWithDcr.name,
        manifest: putBodyWithDcr,
      });
      await mcpServerStore.saveClient({
        id: record.id,
        record: {
          server: {
            authorizationEndpoint: 'https://auth.example.com/authorize',
            tokenEndpoint: 'https://auth.example.com/token',
            codeChallengeMethodsSupported: ['S256'],
          },
          client: {
            clientId: 'seed-client',
            clientSecret: 'seed-secret',
          },
        },
      });
    }
  });

  it('PUT with header auth stores plaintext and returns redacted headers', async () => {
    const response = await settingsRouter.request('/', putInit(wrapManifest(putBodyWithHeaderAuth)));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: configured(putBodyWithHeaderAuthWire, 'authenticated'),
    });

    const stored = await mcpServerStore.getServer({ tenant_id: TENANT_ID, name: putBodyWithHeaderAuth.name });
    expect(stored?.manifest.auth).toEqual(putBodyWithHeaderAuth.auth);
  });

  it('PUT create with a redacted header value returns 400', async () => {
    const redactedOnly = {
      ...putBodyWithHeaderAuth,
      name: 'redacted-only-mcp',
      auth: {
        type: 'header' as const,
        headers: { Authorization: HEADER_TOKEN_REDACTED },
      },
    };
    const response = await settingsRouter.request('/', putInit(wrapManifest(redactedOnly)));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { message: 'Header secret is required' } });
  });

  it('PUT with a redacted header value keeps the stored secret', async () => {
    await settingsRouter.request('/', putInit(wrapManifest(putBodyWithHeaderAuth)));

    const keep = {
      ...putBodyWithHeaderAuth,
      url: 'https://mcp.example.com/v2/mcp',
      auth: {
        type: 'header' as const,
        headers: { Authorization: HEADER_TOKEN_REDACTED },
      },
    };
    const response = await settingsRouter.request('/', putInit(wrapManifest(keep)));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: configured(
        {
          ...keep,
          auth: {
            type: 'header',
            headers: { Authorization: HEADER_TOKEN_REDACTED },
          },
        },
        'authenticated',
      ),
    });

    const stored = await mcpServerStore.getServer({ tenant_id: TENANT_ID, name: putBodyWithHeaderAuth.name });
    expect(stored?.manifest).toEqual({
      ...putBodyWithHeaderAuth,
      url: keep.url,
      auth: putBodyWithHeaderAuth.auth,
    });
  });

  it('PUT with a different redacted header value still keeps the stored secret', async () => {
    await settingsRouter.request('/', putInit(wrapManifest(putBodyWithHeaderAuth)));

    // Any value containing ***REDACTED*** is treated as keep, not only the exact GET mask.
    const keep = {
      ...putBodyWithHeaderAuth,
      url: 'https://mcp.example.com/v3/mcp',
      auth: {
        type: 'header' as const,
        headers: { Authorization: 'oth-***REDACTED***-xxx' },
      },
    };
    const response = await settingsRouter.request('/', putInit(wrapManifest(keep)));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: configured(
        {
          ...keep,
          auth: {
            type: 'header',
            headers: { Authorization: HEADER_TOKEN_REDACTED },
          },
        },
        'authenticated',
      ),
    });

    const stored = await mcpServerStore.getServer({ tenant_id: TENANT_ID, name: putBodyWithHeaderAuth.name });
    expect(stored?.manifest).toEqual({
      ...putBodyWithHeaderAuth,
      url: keep.url,
      auth: putBodyWithHeaderAuth.auth,
    });
  });

  it('PUT with a real header value rotates the stored secret', async () => {
    await settingsRouter.request('/', putInit(wrapManifest(putBodyWithHeaderAuth)));

    const rotatedToken = 'Bearer rotated-token';
    const rotatedTokenRedacted = 'Bea-***REDACTED***-ken';
    const rotated = {
      ...putBodyWithHeaderAuth,
      auth: {
        type: 'header' as const,
        headers: { Authorization: rotatedToken },
      },
    };
    const response = await settingsRouter.request('/', putInit(wrapManifest(rotated)));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: configured(
        {
          ...rotated,
          auth: {
            type: 'header',
            headers: { Authorization: rotatedTokenRedacted },
          },
        },
        'authenticated',
      ),
    });

    const stored = await mcpServerStore.getServer({ tenant_id: TENANT_ID, name: putBodyWithHeaderAuth.name });
    expect(stored?.manifest.auth).toEqual(rotated.auth);
  });

  it('GET / on the chat router returns per-user auth_status and public auth type', async () => {
    const response = await mcpServersRouter.request('/');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        name: string;
        url: string;
        auth?: { type: string };
        auth_status: { status: string };
      }[];
    };
    const byName = new Map(body.data.map(server => [server.name, server]));

    expect(byName.get('deepwiki')).toEqual({
      name: 'deepwiki',
      url: putBody.url,
      auth_status: { status: 'not_required' },
    });
    expect(byName.get('linear')).toEqual({
      name: 'linear',
      url: putBodyWithDcr.url,
      auth: { type: 'dcr' },
      auth_status: { status: 'auth_required' },
    });
    expect(byName.get('private-mcp')).toEqual({
      name: 'private-mcp',
      url: putBodyWithHeaderAuth.url,
      auth: { type: 'header' },
      auth_status: { status: 'authenticated' },
    });
  });

  it('GET / chat list auth_status is scoped to the calling user', async () => {
    const record = await mcpServerStore.getServer({ tenant_id: TENANT_ID, name: putBodyWithDcr.name });
    if (record === undefined) throw new Error('expected DCR server to exist');
    await tokenStore.saveToken({
      id: record.id,
      userRef: LOCAL_USER_CONTEXT.userRef,
      token: {
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: '2099-01-01T00:00:00.000Z',
        scope: null,
      },
    });

    const forLocal = await mcpServersRouter.request('/');
    const localBody = (await forLocal.json()) as {
      data: { name: string; auth_status: { status: string } }[];
    };
    expect(localBody.data.find(server => server.name === putBodyWithDcr.name)?.auth_status).toEqual({
      status: 'authenticated',
    });

    const otherRouter = createMcpServersRouter({
      resolveMcpServerStore: () => mcpServerStore,
      tokenStore,
      withTransaction,
      logger,
      resolveUserContext: () => ({ userRef: 'other-user', role: 'user' }),
    });
    const forOther = await otherRouter.request('/');
    const otherBody = (await forOther.json()) as {
      data: { name: string; auth_status: { status: string } }[];
    };
    expect(otherBody.data.find(server => server.name === putBodyWithDcr.name)?.auth_status).toEqual({
      status: 'auth_required',
    });

    await tokenStore.deleteToken({ id: record.id, userRef: LOCAL_USER_CONTEXT.userRef });
  });

  it('PUT rejects invalid bodies at the Zod layer', async () => {
    const { url: _, ...withoutUrl } = putBody;
    const missingUrl = await settingsRouter.request('/', putInit(wrapManifest(withoutUrl)));
    expect(missingUrl.status).toBe(400);

    const badName = await settingsRouter.request('/', putInit(wrapManifest({ ...putBody, name: 'Not A Name' })));
    expect(badName.status).toBe(400);

    const emptyHeaders = await settingsRouter.request(
      '/',
      putInit(
        wrapManifest({
          ...putBodyWithHeaderAuth,
          name: 'bad-empty-headers',
          auth: { type: 'header', headers: {} },
        }),
      ),
    );
    expect(emptyHeaders.status).toBe(400);
  });

  it('GET /{name}/authorize short-circuits non-DCR servers and 404s unknowns', async () => {
    const noAuth = await mcpServersRouter.request('/deepwiki/authorize?return_to=/settings');
    expect(noAuth.status).toBe(200);
    expect(await noAuth.json()).toEqual({ status: 'not_required' });

    const headerAuth = await mcpServersRouter.request('/private-mcp/authorize?return_to=/settings');
    expect(headerAuth.status).toBe(200);
    expect(await headerAuth.json()).toEqual({ status: 'authenticated' });

    const missing = await mcpServersRouter.request('/missing/authorize?return_to=/settings');
    expect(missing.status).toBe(404);
  });

  it('GET /{name}/authorize rejects unsafe return_to values with 400', async () => {
    await seedDcrServerWithClient();

    for (const returnTo of [
      'https://evil.example.com/phish',
      '//evil.example.com/phish',
      '/api/v1/sessions',
      '/api',
      'relative-not-absolute',
    ]) {
      const response = await mcpServersRouter.request(
        `/${putBodyWithDcr.name}/authorize?return_to=${encodeURIComponent(returnTo)}`,
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { message: 'Invalid return_to: must be a same-origin relative path' },
      });
    }
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
        putInit(
          wrapManifest({
            type: 'remote',
            name: 'failing-oauth-mcp',
            url: mcpUrl,
            description: 'Failing OAuth MCP server.',
            auth: { type: 'dcr' },
          }),
        ),
      );
      // Registration fails before any DB write — no server exists to authorize.
      expect(put.status).toBe(422);
      expect(await mcpServerStore.getServer({ tenant_id: TENANT_ID, name: 'failing-oauth-mcp' })).toBeUndefined();

      const authorize = await mcpServersRouter.request('/failing-oauth-mcp/authorize');
      expect(authorize.status).toBe(404);
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
      const put = await settingsRouter.request(
        '/',
        putInit(
          wrapManifest({
            type: 'remote',
            name: 'oauth-mcp',
            url: mcpUrl,
            description: 'OAuth MCP server.',
            auth: { type: 'dcr' },
          }),
        ),
      );
      expect(put.status).toBe(200);

      const authorize = await mcpServersRouter.request('/oauth-mcp/authorize?return_to=/settings/after-oauth');
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
    const record = await seedDcrServerWithClient();

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
      userRef: LOCAL_USER_CONTEXT.userRef,
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
      data: configured(putBodyWithDcr, 'auth_required'),
    });
    expect(await tokenStore.getToken({ id: record.id, userRef: LOCAL_USER_CONTEXT.userRef })).toBeUndefined();
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
      data: configured(putBody, 'not_required'),
    });

    // Ensure header-auth fixture is present with a known secret (later tests may have rotated it).
    await settingsRouter.request('/', putInit(wrapManifest(putBodyWithHeaderAuth)));
    const headerAuth = await mcpServersRouter.request('/private-mcp/authorize', { method: 'DELETE' });
    expect(headerAuth.status).toBe(200);
    expect(await headerAuth.json()).toEqual({
      data: configured(putBodyWithHeaderAuthWire, 'authenticated'),
    });

    const missing = await mcpServersRouter.request('/missing/authorize', { method: 'DELETE' });
    expect(missing.status).toBe(404);
  });
});
