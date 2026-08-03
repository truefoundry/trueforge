/**
 * MCP OAuth / DCR helper tests (node:test style via jest).
 * Global fetch is stubbed; production code uses real fetch only.
 */
import { resourceUrlFromServerUrl } from '@modelcontextprotocol/sdk/shared/auth-utils.js';
import {
  DEFAULT_MCP_ACCESS_TOKEN_TTL_SECONDS,
  InMemoryOAuthClientStore,
  InMemoryOAuthTokenStore,
  McpConnectionError,
  buildMcpAuthorizationUrl,
  createMcpOAuthClient,
  ensureMcpClientRegistered,
  isMcpAuthRequired,
  mcpOAuthCallbackUrl,
  resolveMcpAuth,
  type OAuthClientRecord,
} from '../../../../src/core';

interface Stores {
  tokenStore: InMemoryOAuthTokenStore;
  clientStore: InMemoryOAuthClientStore;
}

/** The two generic stores the helpers consume, freshly backed in memory per test. */
function newStores(): Stores {
  return { tokenStore: new InMemoryOAuthTokenStore(), clientStore: new InMemoryOAuthClientStore() };
}

const PUBLIC_BASE_URL = 'https://harness.example.com';
const CLIENT_NAME = 'harness';
const SERVER_URL = 'https://mcp.example.com/sse';
const AS_ORIGIN = 'https://auth.example.com';
const SERVER_ID = 'mcp-server-id-1';
const SERVER_NAME = 'svc';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

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
  grant_types_supported: ['authorization_code'],
  token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
};

function stubOauthFetch(options: {
  registrationFailFirst?: boolean;
  registrationFailAlways?: boolean;
  skipRegistrationEndpoint?: boolean;
  registeredClient?: { client_id: string; client_secret?: string; token_endpoint_auth_method?: string };
  tokenResponse?: { access_token: string; refresh_token?: string; expires_in?: number; token_type?: string };
  tokenFail?: boolean;
}): {
  registerBodies: unknown[];
  registerCallCount: () => number;
  tokenBodies: unknown[];
  tokenAuthHeaders: string[];
} {
  let registerCalls = 0;
  const registerBodies: unknown[] = [];
  const tokenBodies: unknown[] = [];
  const tokenAuthHeaders: string[] = [];
  const registered = options.registeredClient ?? {
    client_id: 'dyn-client-1',
    client_secret: 'dyn-secret-1',
    token_endpoint_auth_method: 'client_secret_post',
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
        redirect_uris: [mcpOAuthCallbackUrl(PUBLIC_BASE_URL)],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      });
    }

    if (url === `${AS_ORIGIN}/token` && init?.method === 'POST') {
      tokenBodies.push(String(init.body));
      const headers = new Headers(init.headers);
      tokenAuthHeaders.push(headers.get('Authorization') ?? '');
      if (options.tokenFail) {
        return json({ error: 'invalid_grant' }, 400);
      }
      const tokens = options.tokenResponse ?? {
        access_token: 'refreshed-access',
        refresh_token: 'refreshed-refresh',
        expires_in: 3600,
        token_type: 'Bearer',
      };
      return json({ token_type: 'Bearer', ...tokens });
    }

    return new Response(`unexpected url: ${url}`, { status: 404 });
  }) as typeof fetch;

  return { registerBodies, registerCallCount: () => registerCalls, tokenBodies, tokenAuthHeaders };
}

const sampleClient: OAuthClientRecord = {
  server: {
    authorizationEndpoint: `${AS_ORIGIN}/authorize`,
    tokenEndpoint: `${AS_ORIGIN}/token`,
    codeChallengeMethodsSupported: ['S256'],
  },
  client: {
    clientId: 'cached-client',
    clientSecret: 'cached-secret',
  },
};

describe('resourceUrlFromServerUrl (SDK)', () => {
  it('strips fragment (RFC 8707 resource indicator)', () => {
    const resource = resourceUrlFromServerUrl('https://mcp.example.com/sse#frag');
    expect(resource.hash).toBe('');
    expect(resource.pathname).toBe('/sse');
  });
});

describe('createMcpOAuthClient / ensureMcpClientRegistered', () => {
  it('returns the cached client without discovery or registration', async () => {
    const { clientStore } = newStores();
    await clientStore.saveClient({ id: SERVER_ID, record: sampleClient });
    const { registerCallCount } = stubOauthFetch({});

    const result = await ensureMcpClientRegistered({
      clientStore,
      serverId: SERVER_ID,
      mcpServerUrl: SERVER_URL,
      mcpServerName: SERVER_NAME,
      publicBaseUrl: PUBLIC_BASE_URL,
      clientName: CLIENT_NAME,
    });

    expect(result).toEqual(sampleClient);
    expect(registerCallCount()).toBe(0);
  });

  it('discovers, registers confidential client, and saves the record', async () => {
    const { clientStore } = newStores();
    const { registerBodies } = stubOauthFetch({});

    const result = await ensureMcpClientRegistered({
      clientStore,
      serverId: SERVER_ID,
      mcpServerUrl: SERVER_URL,
      mcpServerName: SERVER_NAME,
      publicBaseUrl: PUBLIC_BASE_URL,
      clientName: CLIENT_NAME,
    });

    expect(result.client.clientId).toBe('dyn-client-1');
    expect(result.client.clientSecret).toBe('dyn-secret-1');
    expect(result.server.authorizationEndpoint).toBe(`${AS_ORIGIN}/authorize`);
    expect(result.server.tokenEndpoint).toBe(`${AS_ORIGIN}/token`);
    expect(result.server.codeChallengeMethodsSupported).toEqual(['S256']);
    expect(registerBodies).toHaveLength(1);
    const body = registerBodies[0] as Record<string, unknown>;
    expect(body['token_endpoint_auth_method']).toBe('client_secret_post');
    expect(body['grant_types']).toEqual(['authorization_code', 'refresh_token']);
    expect(body['client_name']).toBe(CLIENT_NAME);
    expect(body['redirect_uris']).toEqual([mcpOAuthCallbackUrl(PUBLIC_BASE_URL)]);
  });

  it('retries registration without token_endpoint_auth_method when the first attempt fails', async () => {
    const { clientStore } = newStores();
    const { registerBodies, registerCallCount } = stubOauthFetch({
      registrationFailFirst: true,
      registeredClient: { client_id: 'public-client' },
    });

    const result = await ensureMcpClientRegistered({
      clientStore,
      serverId: SERVER_ID,
      mcpServerUrl: SERVER_URL,
      mcpServerName: SERVER_NAME,
      publicBaseUrl: PUBLIC_BASE_URL,
      clientName: CLIENT_NAME,
    });

    expect(result.client.clientId).toBe('public-client');
    expect(result.client.clientSecret).toBeNull();
    expect(registerCallCount()).toBe(2);
    expect((registerBodies[0] as Record<string, unknown>)['token_endpoint_auth_method']).toBe('client_secret_post');
    expect((registerBodies[1] as Record<string, unknown>)['token_endpoint_auth_method']).toBeUndefined();
  });

  it('throws when the AS has no registration_endpoint', async () => {
    const { clientStore } = newStores();
    stubOauthFetch({ skipRegistrationEndpoint: true });

    await expect(
      ensureMcpClientRegistered({
        clientStore,
        serverId: SERVER_ID,
        mcpServerUrl: SERVER_URL,
        mcpServerName: SERVER_NAME,
        publicBaseUrl: PUBLIC_BASE_URL,
        clientName: CLIENT_NAME,
      }),
    ).rejects.toMatchObject({
      name: 'McpConnectionError',
      message: expect.stringContaining('no DCR support'),
    });
  });

  it('does not save a client when both registration attempts fail', async () => {
    const { clientStore } = newStores();
    const { registerCallCount } = stubOauthFetch({ registrationFailAlways: true });

    await expect(
      createMcpOAuthClient({
        mcpServerUrl: SERVER_URL,
        mcpServerName: SERVER_NAME,
        redirectUri: mcpOAuthCallbackUrl(PUBLIC_BASE_URL),
        clientName: CLIENT_NAME,
      }),
    ).rejects.toBeInstanceOf(McpConnectionError);
    expect(registerCallCount()).toBe(2);
    expect(await clientStore.getClient({ id: SERVER_ID })).toBeUndefined();
  });

  it('throws when publicBaseUrl is empty (no trimming)', async () => {
    await expect(
      ensureMcpClientRegistered({
        clientStore: new InMemoryOAuthClientStore(),
        serverId: SERVER_ID,
        mcpServerUrl: SERVER_URL,
        mcpServerName: SERVER_NAME,
        publicBaseUrl: '',
        clientName: CLIENT_NAME,
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('PUBLIC_BASE_URL') });
  });
});

describe('buildMcpAuthorizationUrl', () => {
  it('saves pending authorization with state and returns a URL object', async () => {
    const { tokenStore, clientStore } = newStores();
    await clientStore.saveClient({ id: SERVER_ID, record: sampleClient });
    stubOauthFetch({});

    const authUrl = await buildMcpAuthorizationUrl({
      tokenStore,
      clientStore,
      serverId: SERVER_ID,
      mcpServerUrl: SERVER_URL,
      mcpServerName: SERVER_NAME,
      publicBaseUrl: PUBLIC_BASE_URL,
      clientName: CLIENT_NAME,
      redirectUrl: 'https://app.example.com/after',
    });

    expect(authUrl).toBeInstanceOf(URL);
    expect(authUrl.origin + authUrl.pathname).toBe(`${AS_ORIGIN}/authorize`);
    expect(authUrl.searchParams.get('client_id')).toBe(sampleClient.client.clientId);
    expect(authUrl.searchParams.get('redirect_uri')).toBe(mcpOAuthCallbackUrl(PUBLIC_BASE_URL));
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authUrl.searchParams.get('code_challenge')).toBeTruthy();
    expect(authUrl.searchParams.get('resource')).toBe(resourceUrlFromServerUrl(SERVER_URL).href);

    const state = authUrl.searchParams.get('state');
    expect(state).toBeTruthy();
    const pending = await tokenStore.getPendingAuthorization({ state: state! });
    expect(pending).toMatchObject({
      state,
      id: SERVER_ID,
      redirectUrl: 'https://app.example.com/after',
    });
    expect(pending?.codeVerifier).toBeTruthy();
  });
});

const resolveParams = (stores: Stores, mcpServerUrl = SERVER_URL) => ({
  tokenStore: stores.tokenStore,
  clientStore: stores.clientStore,
  serverId: SERVER_ID,
  mcpServerUrl,
  mcpServerName: SERVER_NAME,
  publicBaseUrl: PUBLIC_BASE_URL,
  clientName: CLIENT_NAME,
});

describe('resolveMcpAuth', () => {
  it('returns bearer headers when the token is still valid', async () => {
    const stores = newStores();
    await stores.tokenStore.saveToken({
      id: SERVER_ID,
      token: {
        accessToken: 'live-token',
        refreshToken: null,
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        scope: null,
      },
    });

    const result = await resolveMcpAuth(resolveParams(stores));

    expect(result).toEqual({ headers: { Authorization: 'Bearer live-token' } });
  });

  it('refreshes an expired token when a refresh_token is stored', async () => {
    const stores = newStores();
    await stores.clientStore.saveClient({ id: SERVER_ID, record: sampleClient });
    await stores.tokenStore.saveToken({
      id: SERVER_ID,
      token: {
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        scope: null,
      },
    });
    const { tokenBodies, tokenAuthHeaders } = stubOauthFetch({
      tokenResponse: {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3600,
        token_type: 'Bearer',
      },
    });

    const result = await resolveMcpAuth(resolveParams(stores));

    expect(result).toEqual({ headers: { Authorization: 'Bearer new-access' } });
    expect(tokenBodies).toHaveLength(1);
    expect(String(tokenBodies[0])).toContain('grant_type=refresh_token');
    // Secret present → client_secret_post (form body), not HTTP Basic.
    expect(String(tokenBodies[0])).toContain('client_secret=cached-secret');
    expect(tokenAuthHeaders[0]).toBe('');
    const saved = await stores.tokenStore.getToken({ id: SERVER_ID });
    expect(saved?.accessToken).toBe('new-access');
    expect(saved?.refreshToken).toBe('new-refresh');
  });

  it('uses a default TTL when the token response omits expires_in', async () => {
    const stores = newStores();
    await stores.clientStore.saveClient({ id: SERVER_ID, record: sampleClient });
    await stores.tokenStore.saveToken({
      id: SERVER_ID,
      token: {
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        scope: null,
      },
    });
    const nowMs = Date.now();
    stubOauthFetch({
      tokenResponse: {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        token_type: 'Bearer',
      },
    });

    const result = await resolveMcpAuth({ ...resolveParams(stores), nowMs });

    expect(result).toEqual({ headers: { Authorization: 'Bearer new-access' } });
    const saved = await stores.tokenStore.getToken({ id: SERVER_ID });
    expect(saved?.expiresAt).toBe(new Date(nowMs + DEFAULT_MCP_ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString());
    // Still usable on the next resolve with a slightly later clock.
    const again = await resolveMcpAuth({ ...resolveParams(stores), nowMs: nowMs + 1_000 });
    expect(again).toEqual({ headers: { Authorization: 'Bearer new-access' } });
  });

  it('returns authentication_required and clears token when refresh fails', async () => {
    const stores = newStores();
    await stores.clientStore.saveClient({ id: SERVER_ID, record: sampleClient });
    await stores.tokenStore.saveToken({
      id: SERVER_ID,
      token: {
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        scope: null,
      },
    });
    stubOauthFetch({ tokenFail: true });

    const result = await resolveMcpAuth(resolveParams(stores));

    expect(isMcpAuthRequired(result)).toBe(true);
    if (!isMcpAuthRequired(result)) throw new Error('unreachable');
    expect(result.authUrl).toBeInstanceOf(URL);
    expect(await stores.tokenStore.getToken({ id: SERVER_ID })).toBeUndefined();
    expect(await stores.clientStore.getClient({ id: SERVER_ID })).toEqual(sampleClient);
  });

  it('returns authentication_required and clears expired token without refresh_token', async () => {
    const stores = newStores();
    await stores.clientStore.saveClient({ id: SERVER_ID, record: sampleClient });
    await stores.tokenStore.saveToken({
      id: SERVER_ID,
      token: {
        accessToken: 'old-access',
        refreshToken: null,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        scope: null,
      },
    });
    stubOauthFetch({});

    const result = await resolveMcpAuth(resolveParams(stores));

    expect(isMcpAuthRequired(result)).toBe(true);
    if (!isMcpAuthRequired(result)) throw new Error('unreachable');
    expect(result.authUrl).toBeInstanceOf(URL);
    expect(result.authUrl.href).toContain('/authorize');
    expect(await stores.tokenStore.getToken({ id: SERVER_ID })).toBeUndefined();
    expect(await stores.clientStore.getClient({ id: SERVER_ID })).toEqual(sampleClient);
  });

  it('returns authentication_required when no token exists', async () => {
    const stores = newStores();
    await stores.clientStore.saveClient({ id: SERVER_ID, record: sampleClient });
    stubOauthFetch({});

    const result = await resolveMcpAuth(resolveParams(stores));

    expect(isMcpAuthRequired(result)).toBe(true);
    if (!isMcpAuthRequired(result)) throw new Error('unreachable');
    expect(result.authUrl.searchParams.get('state')).toBeTruthy();
  });
});

describe('end-to-end DCR + authorize with normalised MCP URL', () => {
  it('registers, builds auth URL with resource, and resolves auth_required without a token', async () => {
    // Mixed-case scheme/host + fragment: resource indicator must still be RFC-8707-safe.
    const mixedUrl = 'HTTPS://MCP.Example.COM/sse#fragment';
    const stores = newStores();
    const { registerBodies } = stubOauthFetch({});

    const result = await resolveMcpAuth(resolveParams(stores, mixedUrl));

    expect(isMcpAuthRequired(result)).toBe(true);
    if (!isMcpAuthRequired(result)) throw new Error('unreachable');

    expect(registerBodies).toHaveLength(1);
    const client = await stores.clientStore.getClient({ id: SERVER_ID });
    expect(client?.client.clientId).toBe('dyn-client-1');

    const url = result.authUrl;
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    // Fragment stripped; resource is absolute URL for this MCP server.
    expect(url.searchParams.get('resource')).toBe(resourceUrlFromServerUrl(mixedUrl).href);
    expect(url.searchParams.get('resource')).not.toContain('#');
  });
});
