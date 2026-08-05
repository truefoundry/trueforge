/**
 * Authorize + OAuth callback against real sqlite stores with fetch stubbed
 * (same pattern as packages/harness MCP OAuth tests).
 */
import { mcpOAuthCallbackUrl } from '@truefoundry/utils-core/core';
import winston from 'winston';
import { createMcpOAuthRouter } from '../../../src/apis/mcpOAuth';
import { createMcpServersRouter } from '../../../src/apis/mcpServers';
import { McpCatalog } from '../../../src/catalog/McpCatalog';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteMcpServerStore } from '../../../src/db/sqlite/mcp-server-store/SqliteMcpServerStore';
import { SqliteOAuthTokenStore } from '../../../src/db/sqlite/token-store/SqliteOAuthTokenStore';

const AS_ORIGIN = 'https://auth.example.com';
const MCP_URL = 'https://mcp.example.com/sse';
const FE_REDIRECT = 'https://app.example.com/mcp/connected';

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
  let settingsRouter: ReturnType<typeof createMcpServersRouter>;
  let oauthRouter: ReturnType<typeof createMcpOAuthRouter>;
  let mcpServerStore: SqliteMcpServerStore;
  let tokenStore: SqliteOAuthTokenStore;

  beforeAll(async () => {
    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    mcpServerStore = new SqliteMcpServerStore(db);
    tokenStore = new SqliteOAuthTokenStore(db);
    const logger = winston.createLogger({ silent: true });
    settingsRouter = createMcpServersRouter({
      mcpCatalog: McpCatalog.load(),
      mcpServerStore,
      tokenStore,
      logger,
    });
    oauthRouter = createMcpOAuthRouter({ tokenStore, mcpServerStore, logger });
  });

  beforeEach(() => {
    stubOauthFetch();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /** Registers a dcr server and authorizes it, returning the pending authorization's `state`. */
  async function pendingState(name: string, redirectUrl?: string): Promise<string> {
    const put = await settingsRouter.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'remote', name, url: MCP_URL, auth: { type: 'dcr' } }),
    });
    expect(put.status).toBe(200);

    let query = '';
    if (redirectUrl) {
      query = `?redirect_url=${encodeURIComponent(redirectUrl)}`;
    }
    const authorize = await settingsRouter.request(`/${name}/authorize${query}`);
    expect(authorize.status).toBe(200);
    const body = (await authorize.json()) as { authorization_url?: string };
    return new URL(body.authorization_url ?? '').searchParams.get('state') ?? '';
  }

  it('authorize runs DCR and returns an authorization URL; callback exchanges the code', async () => {
    const put = await settingsRouter.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'remote',
        name: 'oauth-mcp',
        url: MCP_URL,
        auth: { type: 'dcr' },
      }),
    });
    expect(put.status).toBe(200);

    const authorize = await settingsRouter.request(
      `/oauth-mcp/authorize?redirect_url=${encodeURIComponent(FE_REDIRECT)}`,
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
    expect(callback.headers.get('location')).toBe(`${FE_REDIRECT}?isSuccess=true`);

    const record = await mcpServerStore.getServer({ tenant_id: 'default', name: 'oauth-mcp' });
    expect(record).toBeDefined();
    const token = await tokenStore.getToken({ id: record?.id ?? '' });
    expect(token?.accessToken).toBe('access-1');
    expect(token?.refreshToken).toBe('refresh-1');

    const reauthorize = await settingsRouter.request(
      `/oauth-mcp/authorize?redirect_url=${encodeURIComponent(FE_REDIRECT)}`,
    );
    expect(reauthorize.status).toBe(200);
    expect(await reauthorize.json()).toEqual({ status: 'authenticated' });
  });

  it('callback returns 400 JSON when the pending row is gone, since its landing URL went with it', async () => {
    const unknown = await oauthRouter.request('/callback?state=no-such-state&code=x');
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: { message: 'Unknown or expired OAuth state' } });

    // The missing row is the reason reported, even when the IdP also sent an `error`.
    const denied = await oauthRouter.request('/callback?state=any&error=access_denied&error_description=user%20denied');
    expect(denied.status).toBe(400);
    expect(await denied.json()).toEqual({ error: { message: 'Unknown or expired OAuth state' } });
  });

  it('callback redirects with the failure reason when the IdP denies consent', async () => {
    const landing = 'https://app.example.com/mcp/connected?tab=mcp';
    const state = await pendingState('oauth-mcp-denied', landing);

    const denied = await oauthRouter.request(
      `/callback?state=${encodeURIComponent(state)}&error=access_denied&error_description=user%20denied`,
    );
    expect(denied.status).toBe(302);
    expect(denied.headers.get('location')).toBe(`${landing}&isSuccess=false&reason=access_denied`);
  });

  it('callback returns success JSON when authorize supplied no redirect_url', async () => {
    const state = await pendingState('oauth-mcp-no-redirect');

    const callback = await oauthRouter.request(`/callback?state=${encodeURIComponent(state)}&code=auth-code-1`);
    expect(callback.status).toBe(200);
    expect(await callback.json()).toEqual({ success: true });
  });
});
