/**
 * Unit tests for MCP OAuth helpers.
 * HTTP is hermetic by stubbing global fetch (production code uses real fetch only).
 */
import { McpConnectionError } from '@truefoundry/utils/core';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type {
  IMcpTokenStore,
  McpOAuthClientRecord,
  McpOAuthPendingAuthorization,
  McpOAuthToken,
} from './IMcpTokenStore';
import {
  buildAuthorizationUrl,
  ensureClientRegistered,
  McpAuthStatus,
  normalizeResourceUri,
  oauthCallbackUrl,
  resolveAuth,
  type McpOAuthRuntimeConfig,
} from './mcpOAuth';

const CONFIG: McpOAuthRuntimeConfig = {
  publicBaseUrl: 'https://harness.example.com',
  clientName: 'TrueFoundry Harness',
};

const SERVER_URL = 'https://mcp.example.com/sse';
const AS_ORIGIN = 'https://auth.example.com';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function clientKey(tenantId: string, serverName: string): string {
  return `${tenantId}:${serverName}`;
}

function createMemoryTokenStore(): IMcpTokenStore & {
  clients: Map<string, McpOAuthClientRecord>;
  tokens: Map<string, McpOAuthToken>;
  pending: Map<string, McpOAuthPendingAuthorization>;
  saveClientCalls: number;
  savePendingCalls: number;
  saveTokenCalls: number;
} {
  const clients = new Map<string, McpOAuthClientRecord>();
  const tokens = new Map<string, McpOAuthToken>();
  const pending = new Map<string, McpOAuthPendingAuthorization>();
  let saveClientCalls = 0;
  let savePendingCalls = 0;
  let saveTokenCalls = 0;

  return {
    clients,
    tokens,
    pending,
    get saveClientCalls() {
      return saveClientCalls;
    },
    get savePendingCalls() {
      return savePendingCalls;
    },
    get saveTokenCalls() {
      return saveTokenCalls;
    },
    async saveOAuthClient(params) {
      saveClientCalls += 1;
      clients.set(clientKey(params.tenantId, params.serverName), params.record);
    },
    async getOAuthClient(params) {
      return clients.get(clientKey(params.tenantId, params.serverName));
    },
    async savePendingAuthorization(row) {
      savePendingCalls += 1;
      pending.set(row.state, row);
    },
    async getPendingAuthorization(params) {
      return pending.get(params.state);
    },
    async saveToken(params) {
      saveTokenCalls += 1;
      tokens.set(clientKey(params.tenantId, params.serverName), params.token);
    },
    async getToken(params) {
      return tokens.get(clientKey(params.tenantId, params.serverName));
    },
    async delete(params) {
      const key = clientKey(params.tenantId, params.serverName);
      clients.delete(key);
      tokens.delete(key);
      for (const [state, row] of pending) {
        if (row.tenantId === params.tenantId && row.serverName === params.serverName) {
          pending.delete(state);
        }
      }
    },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const AS_METADATA = {
  issuer: AS_ORIGIN,
  authorization_endpoint: `${AS_ORIGIN}/authorize`,
  token_endpoint: `${AS_ORIGIN}/token`,
  registration_endpoint: `${AS_ORIGIN}/register`,
  response_types_supported: ['code'],
  code_challenge_methods_supported: ['S256'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
};

function stubOauthFetch(options: {
  registrationFailFirst?: boolean;
  registrationFailAlways?: boolean;
  skipRegistrationEndpoint?: boolean;
  refreshFails?: boolean;
  registeredClient?: { client_id: string; client_secret?: string };
}): { registerBodies: unknown[]; registerCallCount: () => number } {
  let registerCalls = 0;
  const registerBodies: unknown[] = [];
  const registered = options.registeredClient ?? {
    client_id: 'dyn-client-1',
    client_secret: 'dyn-secret-1',
  };

  globalThis.fetch = (async (input, init) => {
    const url = String(input);

    if (url.includes('oauth-protected-resource')) {
      return json({ resource: SERVER_URL, authorization_servers: [AS_ORIGIN] });
    }

    if (url.includes('oauth-authorization-server') || url.includes('openid-configuration')) {
      const metadata = options.skipRegistrationEndpoint
        ? Object.fromEntries(Object.entries(AS_METADATA).filter(([k]) => k !== 'registration_endpoint'))
        : AS_METADATA;
      return json(metadata);
    }

    if (url === `${AS_ORIGIN}/register` && init?.method === 'POST') {
      registerCalls += 1;
      registerBodies.push(JSON.parse(String(init.body)));
      if (options.registrationFailAlways || (options.registrationFailFirst && registerCalls === 1)) {
        return json({ error: 'invalid_client_metadata' }, 400);
      }
      return json({
        ...registered,
        redirect_uris: [oauthCallbackUrl(CONFIG.publicBaseUrl)],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      });
    }

    if (url === `${AS_ORIGIN}/token` && init?.method === 'POST') {
      if (options.refreshFails) return json({ error: 'invalid_grant' }, 400);
      return json({
        access_token: 'fresh-access',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'fresh-refresh',
      });
    }

    return new Response(`unexpected url: ${url}`, { status: 404 });
  }) as typeof fetch;

  return { registerBodies, registerCallCount: () => registerCalls };
}

const sampleClient: McpOAuthClientRecord = {
  clientId: 'cached-client',
  clientSecret: 'cached-secret',
  authorizationEndpoint: `${AS_ORIGIN}/authorize`,
  tokenEndpoint: `${AS_ORIGIN}/token`,
  codeChallengeMethodsSupported: ['S256'],
};

const base = {
  tenantId: 't1',
  serverName: 'svc',
  serverUrl: SERVER_URL,
  config: CONFIG,
};

describe('normalizeResourceUri', () => {
  it('lowercases scheme and host and strips fragment', () => {
    const resource = normalizeResourceUri('HTTPS://MCP.Example.COM/sse#frag');
    assert.equal(resource.protocol, 'https:');
    assert.equal(resource.hostname, 'mcp.example.com');
    assert.equal(resource.pathname, '/sse');
    assert.equal(resource.hash, '');
  });
});

describe('ensureClientRegistered', () => {
  it('returns the cached client without discovery or registration', async () => {
    const store = createMemoryTokenStore();
    await store.saveOAuthClient({ tenantId: 't1', serverName: 'svc', record: sampleClient });
    const before = store.saveClientCalls;
    const { registerCallCount } = stubOauthFetch({});

    const result = await ensureClientRegistered({ ...base, tokenStore: store });

    assert.deepEqual(result, sampleClient);
    assert.equal(registerCallCount(), 0);
    assert.equal(store.saveClientCalls, before);
  });

  it('discovers, registers confidential client, and saves the record', async () => {
    const store = createMemoryTokenStore();
    const { registerBodies } = stubOauthFetch({});

    const result = await ensureClientRegistered({ ...base, tokenStore: store });

    assert.equal(result.clientId, 'dyn-client-1');
    assert.equal(result.clientSecret, 'dyn-secret-1');
    assert.equal(result.authorizationEndpoint, `${AS_ORIGIN}/authorize`);
    assert.equal(result.tokenEndpoint, `${AS_ORIGIN}/token`);
    assert.deepEqual(result.codeChallengeMethodsSupported, ['S256']);
    assert.equal(store.saveClientCalls, 1);
    assert.equal(registerBodies.length, 1);
    const body = registerBodies[0] as Record<string, unknown>;
    assert.equal(body['token_endpoint_auth_method'], 'client_secret_post');
    assert.equal(body['client_name'], CONFIG.clientName);
    assert.deepEqual(body['redirect_uris'], [oauthCallbackUrl(CONFIG.publicBaseUrl)]);
  });

  it('retries registration without token_endpoint_auth_method when the first attempt fails', async () => {
    const store = createMemoryTokenStore();
    const { registerBodies, registerCallCount } = stubOauthFetch({
      registrationFailFirst: true,
      registeredClient: { client_id: 'public-client' },
    });

    const result = await ensureClientRegistered({ ...base, tokenStore: store });

    assert.equal(result.clientId, 'public-client');
    assert.equal(result.clientSecret, undefined);
    assert.equal(registerCallCount(), 2);
    assert.equal((registerBodies[0] as Record<string, unknown>)['token_endpoint_auth_method'], 'client_secret_post');
    assert.equal(
      Object.prototype.hasOwnProperty.call(registerBodies[1] as object, 'token_endpoint_auth_method'),
      false,
    );
    assert.equal(store.saveClientCalls, 1);
  });

  it('throws when the AS has no registration_endpoint', async () => {
    const store = createMemoryTokenStore();
    stubOauthFetch({ skipRegistrationEndpoint: true });

    await assert.rejects(
      () => ensureClientRegistered({ ...base, tokenStore: store }),
      (err: unknown) =>
        err instanceof McpConnectionError && err.message.includes('no DCR support') && err.statusCode === 400,
    );
    assert.equal(store.saveClientCalls, 0);
  });

  it('does not save a client when both registration attempts fail', async () => {
    const store = createMemoryTokenStore();
    const { registerCallCount } = stubOauthFetch({ registrationFailAlways: true });

    await assert.rejects(
      () => ensureClientRegistered({ ...base, tokenStore: store }),
      (err: unknown) => err instanceof McpConnectionError && err.statusCode === 502,
    );
    assert.equal(registerCallCount(), 2);
    assert.equal(store.saveClientCalls, 0);
  });

  it('throws when publicBaseUrl is empty', async () => {
    const store = createMemoryTokenStore();
    stubOauthFetch({});

    await assert.rejects(
      () =>
        ensureClientRegistered({
          ...base,
          tokenStore: store,
          config: { publicBaseUrl: '   ', clientName: 'x' },
        }),
      (err: unknown) => err instanceof McpConnectionError && err.message.includes('PUBLIC_BASE_URL'),
    );
  });
});

describe('buildAuthorizationUrl', () => {
  it('saves pending authorization and returns a URL with state', async () => {
    const store = createMemoryTokenStore();
    await store.saveOAuthClient({ tenantId: 't1', serverName: 'svc', record: sampleClient });
    const saveClientBefore = store.saveClientCalls;
    const { registerCallCount } = stubOauthFetch({});

    const authUrl = await buildAuthorizationUrl({
      ...base,
      tokenStore: store,
      redirectUrl: 'https://app.example.com/after',
    });

    assert.equal(registerCallCount(), 0);
    assert.equal(store.saveClientCalls, saveClientBefore);
    assert.equal(store.savePendingCalls, 1);

    const pending = [...store.pending.values()][0];
    assert.ok(pending);
    assert.equal(pending.tenantId, 't1');
    assert.equal(pending.serverName, 'svc');
    assert.equal(pending.redirectUrl, 'https://app.example.com/after');
    assert.ok(pending.codeVerifier);
    assert.ok(pending.state);

    const url = new URL(authUrl);
    assert.equal(url.origin + url.pathname, `${AS_ORIGIN}/authorize`);
    assert.equal(url.searchParams.get('state'), pending.state);
    assert.equal(url.searchParams.get('client_id'), sampleClient.clientId);
    assert.equal(url.searchParams.get('redirect_uri'), oauthCallbackUrl(CONFIG.publicBaseUrl));
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(url.searchParams.get('code_challenge'));
    assert.equal(url.searchParams.get('resource'), normalizeResourceUri(SERVER_URL).href);
  });
});

describe('resolveAuth', () => {
  const resolveBase = { ...base, serverId: 'id-1' };

  it('returns bearer headers when the token is still valid', async () => {
    const store = createMemoryTokenStore();
    await store.saveToken({
      tenantId: 't1',
      serverName: 'svc',
      token: {
        accessToken: 'live-token',
        refreshToken: 'r',
        expiresAt: new Date(Date.now() + 10 * 60_000),
        scope: undefined,
      },
    });
    const { registerCallCount } = stubOauthFetch({});

    const result = await resolveAuth({ ...resolveBase, tokenStore: store });

    assert.deepEqual(result, {
      status: McpAuthStatus.Authenticated,
      headers: { Authorization: 'Bearer live-token' },
    });
    assert.equal(registerCallCount(), 0);
    assert.equal(store.savePendingCalls, 0);
  });

  it('refreshes an expired token and returns the new access token', async () => {
    const store = createMemoryTokenStore();
    await store.saveOAuthClient({ tenantId: 't1', serverName: 'svc', record: sampleClient });
    await store.saveToken({
      tenantId: 't1',
      serverName: 'svc',
      token: {
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
        expiresAt: new Date(Date.now() - 1000),
        scope: undefined,
      },
    });
    stubOauthFetch({});

    const result = await resolveAuth({ ...resolveBase, tokenStore: store });

    assert.deepEqual(result, {
      status: McpAuthStatus.Authenticated,
      headers: { Authorization: 'Bearer fresh-access' },
    });
    const saved = await store.getToken({ tenantId: 't1', serverName: 'svc' });
    assert.equal(saved?.accessToken, 'fresh-access');
    assert.equal(saved?.refreshToken, 'fresh-refresh');
  });

  it('falls back to auth_required when refresh fails', async () => {
    const store = createMemoryTokenStore();
    await store.saveOAuthClient({ tenantId: 't1', serverName: 'svc', record: sampleClient });
    await store.saveToken({
      tenantId: 't1',
      serverName: 'svc',
      token: {
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
        expiresAt: new Date(Date.now() - 1000),
        scope: undefined,
      },
    });
    stubOauthFetch({ refreshFails: true });

    const result = await resolveAuth({ ...resolveBase, tokenStore: store });

    assert.equal(result.status, McpAuthStatus.AuthRequired);
    if (result.status !== McpAuthStatus.AuthRequired) throw new Error('unreachable');
    assert.ok(result.authUrl.includes('/authorize'));
    assert.equal(store.savePendingCalls, 1);
  });

  it('returns auth_required when no token exists', async () => {
    const store = createMemoryTokenStore();
    await store.saveOAuthClient({ tenantId: 't1', serverName: 'svc', record: sampleClient });
    stubOauthFetch({});

    const result = await resolveAuth({ ...resolveBase, tokenStore: store });

    assert.equal(result.status, McpAuthStatus.AuthRequired);
    if (result.status !== McpAuthStatus.AuthRequired) throw new Error('unreachable');
    assert.ok(new URL(result.authUrl).searchParams.get('state'));
  });
});
