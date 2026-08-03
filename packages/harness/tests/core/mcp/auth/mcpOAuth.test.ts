/**
 * MCP OAuth / DCR helper tests (node:test style via jest).
 * Global fetch is stubbed; production code uses real fetch only.
 */
import { resourceUrlFromServerUrl } from '@modelcontextprotocol/sdk/shared/auth-utils.js';
import {
  InMemoryMcpTokenStore,
  McpAuthStatus,
  McpConnectionError,
  buildMcpAuthorizationUrl,
  createMcpOAuthClient,
  ensureMcpClientRegistered,
  mcpOAuthCallbackUrl,
  resolveMcpAuth,
  type McpOAuthClientRecord,
} from '../../../../src/core';

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
        redirect_uris: [mcpOAuthCallbackUrl(PUBLIC_BASE_URL)],
        grant_types: ['authorization_code'],
        response_types: ['code'],
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

describe('resourceUrlFromServerUrl (SDK)', () => {
  it('strips fragment (RFC 8707 resource indicator)', () => {
    const resource = resourceUrlFromServerUrl('https://mcp.example.com/sse#frag');
    expect(resource.hash).toBe('');
    expect(resource.pathname).toBe('/sse');
  });
});

describe('createMcpOAuthClient / ensureMcpClientRegistered', () => {
  it('returns the cached client without discovery or registration', async () => {
    const store = new InMemoryMcpTokenStore();
    await store.saveOAuthClient({ serverId: SERVER_ID, record: sampleClient });
    const { registerCallCount } = stubOauthFetch({});

    const result = await ensureMcpClientRegistered({
      tokenStore: store,
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
    const store = new InMemoryMcpTokenStore();
    const { registerBodies } = stubOauthFetch({});

    const result = await ensureMcpClientRegistered({
      tokenStore: store,
      serverId: SERVER_ID,
      mcpServerUrl: SERVER_URL,
      mcpServerName: SERVER_NAME,
      publicBaseUrl: PUBLIC_BASE_URL,
      clientName: CLIENT_NAME,
    });

    expect(result.clientId).toBe('dyn-client-1');
    expect(result.clientSecret).toBe('dyn-secret-1');
    expect(result.authorizationEndpoint).toBe(`${AS_ORIGIN}/authorize`);
    expect(result.tokenEndpoint).toBe(`${AS_ORIGIN}/token`);
    expect(result.codeChallengeMethodsSupported).toEqual(['S256']);
    expect(registerBodies).toHaveLength(1);
    const body = registerBodies[0] as Record<string, unknown>;
    expect(body['token_endpoint_auth_method']).toBe('client_secret_post');
    expect(body['grant_types']).toEqual(['authorization_code']);
    expect(body['client_name']).toBe(CLIENT_NAME);
    expect(body['redirect_uris']).toEqual([mcpOAuthCallbackUrl(PUBLIC_BASE_URL)]);
  });

  it('retries registration without token_endpoint_auth_method when the first attempt fails', async () => {
    const store = new InMemoryMcpTokenStore();
    const { registerBodies, registerCallCount } = stubOauthFetch({
      registrationFailFirst: true,
      registeredClient: { client_id: 'public-client' },
    });

    const result = await ensureMcpClientRegistered({
      tokenStore: store,
      serverId: SERVER_ID,
      mcpServerUrl: SERVER_URL,
      mcpServerName: SERVER_NAME,
      publicBaseUrl: PUBLIC_BASE_URL,
      clientName: CLIENT_NAME,
    });

    expect(result.clientId).toBe('public-client');
    expect(result.clientSecret).toBeUndefined();
    expect(registerCallCount()).toBe(2);
    expect((registerBodies[0] as Record<string, unknown>)['token_endpoint_auth_method']).toBe('client_secret_post');
    expect(Object.prototype.hasOwnProperty.call(registerBodies[1] as object, 'token_endpoint_auth_method')).toBe(false);
  });

  it('throws when the AS has no registration_endpoint', async () => {
    const store = new InMemoryMcpTokenStore();
    stubOauthFetch({ skipRegistrationEndpoint: true });

    await expect(
      ensureMcpClientRegistered({
        tokenStore: store,
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
    const store = new InMemoryMcpTokenStore();
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
    expect(await store.getOAuthClient({ serverId: SERVER_ID })).toBeUndefined();
  });

  it('throws when publicBaseUrl is empty (no trimming)', async () => {
    await expect(
      ensureMcpClientRegistered({
        tokenStore: new InMemoryMcpTokenStore(),
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
    const store = new InMemoryMcpTokenStore();
    await store.saveOAuthClient({ serverId: SERVER_ID, record: sampleClient });
    stubOauthFetch({});

    const authUrl = await buildMcpAuthorizationUrl({
      tokenStore: store,
      serverId: SERVER_ID,
      mcpServerUrl: SERVER_URL,
      mcpServerName: SERVER_NAME,
      publicBaseUrl: PUBLIC_BASE_URL,
      clientName: CLIENT_NAME,
      redirectUrl: 'https://app.example.com/after',
    });

    expect(authUrl).toBeInstanceOf(URL);
    expect(authUrl.origin + authUrl.pathname).toBe(`${AS_ORIGIN}/authorize`);
    expect(authUrl.searchParams.get('client_id')).toBe(sampleClient.clientId);
    expect(authUrl.searchParams.get('redirect_uri')).toBe(mcpOAuthCallbackUrl(PUBLIC_BASE_URL));
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authUrl.searchParams.get('code_challenge')).toBeTruthy();
    expect(authUrl.searchParams.get('resource')).toBe(resourceUrlFromServerUrl(SERVER_URL).href);

    const state = authUrl.searchParams.get('state');
    expect(state).toBeTruthy();
    const pending = await store.getPendingAuthorization({ state: state! });
    expect(pending).toMatchObject({
      state,
      serverId: SERVER_ID,
      redirectUrl: 'https://app.example.com/after',
    });
    expect(pending?.codeVerifier).toBeTruthy();
  });
});

const resolveParams = (store: InMemoryMcpTokenStore, mcpServerUrl = SERVER_URL) => ({
  tokenStore: store,
  serverId: SERVER_ID,
  mcpServerUrl,
  mcpServerName: SERVER_NAME,
  publicBaseUrl: PUBLIC_BASE_URL,
  clientName: CLIENT_NAME,
});

describe('resolveMcpAuth (no refresh)', () => {
  it('returns bearer headers when the token is still valid', async () => {
    const store = new InMemoryMcpTokenStore();
    await store.saveToken({
      serverId: SERVER_ID,
      token: {
        accessToken: 'live-token',
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      },
    });

    const result = await resolveMcpAuth(resolveParams(store));

    expect(result).toEqual({
      status: McpAuthStatus.Authenticated,
      headers: { Authorization: 'Bearer live-token' },
    });
  });

  it('returns auth_required and clears expired token (no refresh)', async () => {
    const store = new InMemoryMcpTokenStore();
    await store.saveOAuthClient({ serverId: SERVER_ID, record: sampleClient });
    await store.saveToken({
      serverId: SERVER_ID,
      token: {
        accessToken: 'old-access',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      },
    });
    stubOauthFetch({});

    const result = await resolveMcpAuth(resolveParams(store));

    expect(result.status).toBe(McpAuthStatus.AuthRequired);
    if (result.status !== McpAuthStatus.AuthRequired) throw new Error('unreachable');
    expect(result.authUrl).toBeInstanceOf(URL);
    expect(result.authUrl.href).toContain('/authorize');
    expect(await store.getToken({ serverId: SERVER_ID })).toBeUndefined();
    expect(await store.getOAuthClient({ serverId: SERVER_ID })).toEqual(sampleClient);
  });

  it('returns auth_required when no token exists', async () => {
    const store = new InMemoryMcpTokenStore();
    await store.saveOAuthClient({ serverId: SERVER_ID, record: sampleClient });
    stubOauthFetch({});

    const result = await resolveMcpAuth(resolveParams(store));

    expect(result.status).toBe(McpAuthStatus.AuthRequired);
    if (result.status !== McpAuthStatus.AuthRequired) throw new Error('unreachable');
    expect(result.authUrl.searchParams.get('state')).toBeTruthy();
  });
});

describe('end-to-end DCR + authorize with normalised MCP URL', () => {
  it('registers, builds auth URL with resource, and resolves auth_required without a token', async () => {
    // Mixed-case scheme/host + fragment: resource indicator must still be RFC-8707-safe.
    const mixedUrl = 'HTTPS://MCP.Example.COM/sse#fragment';
    const store = new InMemoryMcpTokenStore();
    const { registerBodies } = stubOauthFetch({});

    const result = await resolveMcpAuth(resolveParams(store, mixedUrl));

    expect(result.status).toBe(McpAuthStatus.AuthRequired);
    if (result.status !== McpAuthStatus.AuthRequired) throw new Error('unreachable');

    expect(registerBodies).toHaveLength(1);
    const client = await store.getOAuthClient({ serverId: SERVER_ID });
    expect(client?.clientId).toBe('dyn-client-1');

    const url = result.authUrl;
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    // Fragment stripped; resource is absolute URL for this MCP server.
    expect(url.searchParams.get('resource')).toBe(resourceUrlFromServerUrl(mixedUrl).href);
    expect(url.searchParams.get('resource')).not.toContain('#');
  });
});
