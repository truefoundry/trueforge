/**
 * Authorize + OAuth callback against real sqlite stores with fetch stubbed
 * (same pattern as the server MCP OAuth helper tests).
 */
import winston from 'winston';
import { createMcpOAuthRouter } from '../../../src/apis/mcpOAuth';
import { createMcpServersRouter, createSettingsMcpServersRouter } from '../../../src/apis/mcpServers';
import { STANDALONE_REQUEST_CONTEXT } from '../../../src/auth/identity';
import configuration from '../../../src/config';
import { McpServerWithAuthStore } from '../../../src/db/McpServerWithAuthStore';
import type { IMcpServerWithAuthStore } from '../../../src/db/mcpServerStore';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteMcpServerStore } from '../../../src/db/sqlite/mcp-server-store/SqliteMcpServerStore';
import { SqliteOAuthTokenStore } from '../../../src/db/sqlite/token-store/SqliteOAuthTokenStore';
import { mcpOAuthCallbackUrl } from '../../../src/mcp/auth/mcpOAuthHelpers';

const AS_ORIGIN = 'https://auth.example.com';
const MCP_URL = 'https://mcp.example.com/sse';
const FE_RETURN_TO = '/mcp/connected';

const AS_METADATA = {
  issuer: AS_ORIGIN,
  authorization_endpoint: `${AS_ORIGIN}/authorize`,
  token_endpoint: `${AS_ORIGIN}/token`,
  registration_endpoint: `${AS_ORIGIN}/register`,
  response_types_supported: ['code'],
  code_challenge_methods_supported: ['S256'],
  grant_types_supported: ['authorization_code'],
  token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubOauthFetch(): void {
  globalThis.fetch = (async (input, init) => {
    const url = String(input);

    if (url.includes('oauth-protected-resource')) {
      return json({ resource: MCP_URL, authorization_servers: [AS_ORIGIN] });
    }

    if (url.includes('oauth-authorization-server') || url.includes('openid-configuration')) {
      return json(AS_METADATA);
    }

    if (url === `${AS_ORIGIN}/register` && init?.method === 'POST') {
      return json({
        client_id: 'dyn-client-1',
        client_secret: 'dyn-secret-1',
        token_endpoint_auth_method: 'client_secret_post',
        redirect_uris: [mcpOAuthCallbackUrl()],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      });
    }

    if (url === `${AS_ORIGIN}/token` && init?.method === 'POST') {
      return json({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_in: 3600,
        token_type: 'Bearer',
      });
    }

    return new Response(`unexpected url: ${url}`, { status: 404 });
  }) as typeof fetch;
}

describe('MCP OAuth authorize + callback', () => {
  const realFetch = globalThis.fetch;
  let settingsRouter: ReturnType<typeof createSettingsMcpServersRouter>;
  let mcpServersRouter: ReturnType<typeof createMcpServersRouter>;
  let oauthRouter: ReturnType<typeof createMcpOAuthRouter>;
  let mcpServerStore: IMcpServerWithAuthStore;
  let tokenStore: SqliteOAuthTokenStore;
  let withTransaction: <T>(callback: (transaction: unknown) => Promise<T>) => Promise<T>;
  let logger: ReturnType<typeof winston.createLogger>;

  beforeAll(async () => {
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
      resolveRequestContext: () => STANDALONE_REQUEST_CONTEXT,
    });
    mcpServersRouter = createMcpServersRouter({
      resolveMcpServerStore: () => mcpServerStore,
      tokenStore,
      withTransaction,
      logger,
      resolveRequestContext: () => STANDALONE_REQUEST_CONTEXT,
    });
    oauthRouter = createMcpOAuthRouter({
      tokenStore,
      mcpServerStore,
      logger,
    });
  });

  beforeEach(() => {
    stubOauthFetch();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /** Registers a dcr server and authorizes it, returning the pending authorization's `state`. */
  async function pendingState(name: string, returnTo?: string): Promise<string> {
    const put = await settingsRouter.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        manifest: {
          type: 'remote',
          name,
          url: MCP_URL,
          description: 'OAuth MCP server.',
          auth: { type: 'dcr' },
        },
      }),
    });
    expect(put.status).toBe(200);

    let query = '';
    if (returnTo) {
      query = `?return_to=${encodeURIComponent(returnTo)}`;
    }
    const authorize = await mcpServersRouter.request(`/${name}/authorize${query}`);
    expect(authorize.status).toBe(200);
    const body = (await authorize.json()) as { authorization_url?: string };
    return new URL(body.authorization_url ?? '').searchParams.get('state') ?? '';
  }

  it('authorize runs DCR and returns an authorization URL; callback exchanges the code', async () => {
    const put = await settingsRouter.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        manifest: {
          type: 'remote',
          name: 'oauth-mcp',
          url: MCP_URL,
          description: 'OAuth MCP server.',
          auth: { type: 'dcr' },
        },
      }),
    });
    expect(put.status).toBe(200);

    const authorize = await mcpServersRouter.request(
      `/oauth-mcp/authorize?return_to=${encodeURIComponent(FE_RETURN_TO)}`,
    );
    expect(authorize.status).toBe(200);
    const authorizeBody = (await authorize.json()) as { status: string; authorization_url?: string };
    expect(authorizeBody.status).toBe('auth_required');
    expect(authorizeBody.authorization_url).toBeDefined();

    const authUrl = new URL(authorizeBody.authorization_url ?? '');
    expect(authUrl.origin).toBe(AS_ORIGIN);
    expect(authUrl.searchParams.get('redirect_uri')).toBe(mcpOAuthCallbackUrl());
    const state = authUrl.searchParams.get('state');
    expect(state).toBeTruthy();

    const callback = await oauthRouter.request(`/callback?state=${encodeURIComponent(state ?? '')}&code=auth-code-1`);
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe(`${FE_RETURN_TO}?isSuccess=true`);

    const record = await mcpServerStore.getServer({ tenant_id: 'default', name: 'oauth-mcp' });
    expect(record).toBeDefined();
    const token = await tokenStore.getToken({ id: record?.id ?? '', userRef: STANDALONE_REQUEST_CONTEXT.subject.id });
    expect(token?.accessToken).toBe('access-1');
    expect(token?.refreshToken).toBe('refresh-1');

    const reauthorize = await mcpServersRouter.request(
      `/oauth-mcp/authorize?return_to=${encodeURIComponent(FE_RETURN_TO)}`,
    );
    expect(reauthorize.status).toBe(200);
    expect(await reauthorize.json()).toEqual({ status: 'authenticated' });
  });

  it('callback returns 400 JSON when the pending row is gone, since its landing path went with it', async () => {
    const unknown = await oauthRouter.request('/callback?state=no-such-state&code=x');
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: { message: 'Unknown or expired OAuth state' } });

    // The missing row is the reason reported, even when the IdP also sent an `error`.
    const denied = await oauthRouter.request('/callback?state=any&error=access_denied&error_description=user%20denied');
    expect(denied.status).toBe(400);
    expect(await denied.json()).toEqual({ error: { message: 'Unknown or expired OAuth state' } });
  });

  it('callback redirects with the failure reason when the IdP denies consent', async () => {
    const landing = '/mcp/connected?tab=mcp';
    const state = await pendingState('oauth-mcp-denied', landing);

    const denied = await oauthRouter.request(
      `/callback?state=${encodeURIComponent(state)}&error=access_denied&error_description=user%20denied`,
    );
    expect(denied.status).toBe(302);
    expect(denied.headers.get('location')).toBe(`${landing}&isSuccess=false&reason=access_denied`);
  });

  it('callback returns success JSON when authorize supplied no return_to', async () => {
    const state = await pendingState('oauth-mcp-no-redirect');

    const callback = await oauthRouter.request(`/callback?state=${encodeURIComponent(state)}&code=auth-code-1`);
    expect(callback.status).toBe(200);
    expect(await callback.json()).toEqual({ success: true });
  });

  it('authorize for one user does not authenticate another user on the same server', async () => {
    const otherRouter = createMcpServersRouter({
      resolveMcpServerStore: () => mcpServerStore,
      tokenStore,
      withTransaction,
      logger,
      resolveRequestContext: () => ({
        tenant_id: 'default',
        subject: { id: 'other-user', type: 'user', display_name: 'other-user' },
        is_admin: false,
        user_credential: null,
      }),
    });

    const put = await settingsRouter.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        manifest: {
          type: 'remote',
          name: 'oauth-mcp-scoped',
          url: MCP_URL,
          description: 'OAuth MCP server.',
          auth: { type: 'dcr' },
        },
      }),
    });
    expect(put.status).toBe(200);

    const authorizeA = await mcpServersRouter.request(
      `/oauth-mcp-scoped/authorize?return_to=${encodeURIComponent(FE_RETURN_TO)}`,
    );
    expect(authorizeA.status).toBe(200);
    const authorizeABody = (await authorizeA.json()) as { authorization_url?: string };
    const state = new URL(authorizeABody.authorization_url ?? '').searchParams.get('state');
    expect(state).toBeTruthy();

    const callback = await oauthRouter.request(`/callback?state=${encodeURIComponent(state ?? '')}&code=auth-code-1`);
    expect(callback.status).toBe(302);

    const reauthorizeA = await mcpServersRouter.request('/oauth-mcp-scoped/authorize');
    expect(await reauthorizeA.json()).toEqual({ status: 'authenticated' });

    const authorizeB = await otherRouter.request('/oauth-mcp-scoped/authorize');
    expect(authorizeB.status).toBe(200);
    const authorizeBBody = (await authorizeB.json()) as { status: string; authorization_url?: string };
    expect(authorizeBBody.status).toBe('auth_required');
    expect(authorizeBBody.authorization_url).toBeDefined();
  });
});
