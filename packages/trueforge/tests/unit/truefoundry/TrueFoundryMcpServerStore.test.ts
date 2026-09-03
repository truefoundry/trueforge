import { HTTPException } from 'hono/http-exception';
import { getPublicBaseUrl } from '../../../src/config';
import { McpServerNotFoundError } from '../../../src/db/mcpServerStore';
import { MCP_PROXY_BASE_URL_TEMPLATE } from '../../../src/truefoundry/mapSfyMcpServers';
import {
  resolveAuthorizeRedirectURL,
  TrueFoundryMcpServerStore,
  type TrueFoundryMcpApiClient,
} from '../../../src/truefoundry/TrueFoundryMcpServerStore';

const TENANT = 'default';
const ACCESS_TOKEN = unsignedJwt({ sub: 'user-1', subjectType: 'user' });

const SFY_ROW = {
  id: 'mcp-id-1',
  name: 'github',
  proxyUrl: `${MCP_PROXY_BASE_URL_TEMPLATE}/mcp-server/github`,
  createdAt: '2026-01-15T12:00:00.000Z',
  updatedAt: '2026-01-16T12:00:00.000Z',
  manifest: { description: 'GitHub MCP', auth_data: { type: 'oauth2' } },
};

const GATEWAY_INSTALLATIONS = [{ isDefault: true, manifest: { url: 'https://gateway.example' } }];

/** Minimal unsigned JWT for unit tests (header.payload.); signature is ignored by decodeJwt. */
function unsignedJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.`;
}

type MockClient = {
  [K in keyof TrueFoundryMcpApiClient]: jest.MockedFunction<TrueFoundryMcpApiClient[K]>;
};

function createMockClient(): MockClient {
  return {
    getMcpServerByName: jest.fn(),
    listMcpServers: jest.fn(),
    listGatewayInstallations: jest.fn(),
    getMcpAuthorize: jest.fn(),
    deleteMcpAuth: jest.fn(),
  };
}

function createStore(input?: { accessToken?: string; client?: MockClient }) {
  const client = input?.client ?? createMockClient();
  client.getMcpServerByName.mockResolvedValue(SFY_ROW);
  client.listGatewayInstallations.mockResolvedValue(GATEWAY_INSTALLATIONS);
  client.listMcpServers.mockResolvedValue([SFY_ROW]);
  client.getMcpAuthorize.mockResolvedValue({ status: 'authenticated' });
  client.deleteMcpAuth.mockResolvedValue(undefined);
  const store = new TrueFoundryMcpServerStore({
    client,
    accessToken: input?.accessToken ?? ACCESS_TOKEN,
  });
  return { store, client };
}

function dcrRecord(overrides: { name?: string } = {}) {
  const name = overrides.name ?? 'github';
  return {
    id: 'mcp-id-1',
    tenant_id: TENANT,
    name,
    manifest: {
      type: 'truefoundry' as const,
      name,
      url: 'https://gateway.example/mcp-server/github',
      description: 'GitHub MCP',
      auth: { type: 'dcr' as const },
    },
    created_at: '2026-01-15T12:00:00.000Z',
    updated_at: '2026-01-16T12:00:00.000Z',
  };
}

describe('resolveAuthorizeRedirectURL', () => {
  it('prefers explicit redirectURL', () => {
    expect(
      resolveAuthorizeRedirectURL({
        redirectURL: 'https://app.example/custom-landing',
        returnTo: '/?screenType=mcp-auth',
      }),
    ).toBe('https://app.example/custom-landing');
  });

  it('builds an absolute FE landing from return_to', () => {
    const returnTo = '/?screenType=mcp-auth&pUid=popup-1';
    expect(resolveAuthorizeRedirectURL({ returnTo })).toBe(new URL(returnTo, `${getPublicBaseUrl()}/`).href);
  });
});

describe('TrueFoundryMcpServerStore', () => {
  describe('listServers', () => {
    it('forwards one SFY page with limit+1 and paginates', async () => {
      const { store, client } = createStore();
      const second = { ...SFY_ROW, id: 'mcp-id-2', name: 'linear' };
      client.listMcpServers.mockResolvedValue([SFY_ROW, second]);

      const page = await store.listServers({
        tenant_id: TENANT,
        names: undefined,
        limit: 1,
        page_token: undefined,
      });

      expect(client.listMcpServers).toHaveBeenCalledWith({
        accessToken: ACCESS_TOKEN,
        limit: 2,
        offset: 0,
      });
      expect(page.data.map(server => server.name)).toEqual(['github']);
      expect(page.pagination.next_page_token).toBeDefined();
      expect(client.listGatewayInstallations).toHaveBeenCalledTimes(1);
    });

    it('filters names with one SFY list call (name IN)', async () => {
      const { store, client } = createStore();
      client.listMcpServers.mockResolvedValue([SFY_ROW]);

      const page = await store.listServers({
        tenant_id: TENANT,
        names: ['github', 'missing'],
        limit: 10,
        page_token: undefined,
      });

      expect(client.listMcpServers).toHaveBeenCalledWith({
        accessToken: ACCESS_TOKEN,
        limit: 11,
        offset: 0,
        names: ['github', 'missing'],
      });
      expect(client.getMcpServerByName).not.toHaveBeenCalled();
      expect(page.data.map(server => server.name)).toEqual(['github']);
    });
  });

  describe('authorize', () => {
    it('passes explicit redirectURL to SFY', async () => {
      const { store, client } = createStore();
      await expect(
        store.authorize({
          tenant_id: TENANT,
          name: 'github',
          userRef: 'user-1',
          redirectURL: 'https://app.example/custom-landing',
        }),
      ).resolves.toEqual({ status: 'authenticated' });
      expect(client.getMcpAuthorize).toHaveBeenCalledWith({
        accessToken: ACCESS_TOKEN,
        mcpServerId: 'mcp-id-1',
        redirectURL: 'https://app.example/custom-landing',
      });
    });

    it('defaults redirectURL to the absolute FE return_to path', async () => {
      const { store, client } = createStore();
      const returnTo = '/?screenType=mcp-auth&pUid=popup-1';
      await store.authorize({
        tenant_id: TENANT,
        name: 'github',
        userRef: 'user-1',
        returnTo,
      });
      expect(client.getMcpAuthorize).toHaveBeenCalledWith({
        accessToken: ACCESS_TOKEN,
        mcpServerId: 'mcp-id-1',
        redirectURL: resolveAuthorizeRedirectURL({ returnTo }),
      });
    });

    it('throws McpServerNotFoundError when the server is missing', async () => {
      const client = createMockClient();
      client.getMcpServerByName.mockResolvedValue(undefined);
      const store = new TrueFoundryMcpServerStore({ client, accessToken: ACCESS_TOKEN });
      await expect(store.authorize({ tenant_id: TENANT, name: 'missing', userRef: 'user-1' })).rejects.toBeInstanceOf(
        McpServerNotFoundError,
      );
    });
  });

  describe('deleteAuthorization', () => {
    it('deletes oauth auth for the access-token subject', async () => {
      const { store, client } = createStore();
      await store.deleteAuthorization({ tenant_id: TENANT, name: 'github', userRef: 'user-1' });
      expect(client.deleteMcpAuth).toHaveBeenCalledWith({
        accessToken: ACCESS_TOKEN,
        mcpServerId: 'mcp-id-1',
        subjectId: 'user-1',
        subjectType: 'user',
        authSource: 'oauth',
      });
    });

    it('uses effective user id for virtualaccount + external identity', async () => {
      const accessToken = unsignedJwt({
        sub: 'va-1',
        subjectType: 'virtualaccount',
        subjectExternalIdentitySlug: 'ext:alice@example.com',
      });
      const { store, client } = createStore({ accessToken });
      await store.deleteAuthorization({ tenant_id: TENANT, name: 'github', userRef: 'va-1' });
      expect(client.deleteMcpAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          subjectId: 'va-1:ext:alice@example.com',
          subjectType: 'virtualaccount',
          authSource: 'oauth',
        }),
      );
    });
  });

  describe('resolveAuthStatuses', () => {
    it('stubs truefoundry servers as authenticated', async () => {
      const { store } = createStore();
      const record = dcrRecord();
      const statuses = await store.resolveAuthStatuses({ records: [record], userRef: 'user-1' });
      expect(statuses.get('github')).toEqual({ status: 'authenticated' });
    });
  });

  describe('resolveInvokeHeaders', () => {
    it('returns static Bearer when wire auth is not dcr', () => {
      const { store } = createStore();
      const record = dcrRecord();
      const headers = store.resolveInvokeHeaders({
        record: {
          ...record,
          manifest: {
            type: 'truefoundry',
            name: record.name,
            url: record.manifest.url,
            description: record.manifest.description,
          },
        },
        userRef: 'user-1',
      });
      expect(headers).toEqual({ Authorization: `Bearer ${ACCESS_TOKEN}` });
    });

    it('returns authRequired when authorize reports auth_required', async () => {
      const { store, client } = createStore();
      client.getMcpAuthorize.mockResolvedValue({
        status: 'auth_required',
        authorization_url: 'https://consent.example/authorize?client_id=1',
      });
      const headers = store.resolveInvokeHeaders({ record: dcrRecord(), userRef: 'user-1' });
      expect(typeof headers).toBe('function');
      if (typeof headers !== 'function') {
        throw new Error('expected async resolver');
      }
      await expect(headers()).resolves.toEqual({
        authRequired: {
          servers: [
            {
              id: 'github',
              name: 'github',
              auth_url: 'https://consent.example/authorize?client_id=1',
            },
          ],
        },
      });
    });

    it('returns Bearer headers when authorize reports authenticated', async () => {
      const { store } = createStore();
      const headers = store.resolveInvokeHeaders({ record: dcrRecord(), userRef: 'user-1' });
      expect(typeof headers).toBe('function');
      if (typeof headers !== 'function') {
        throw new Error('expected async resolver');
      }
      await expect(headers()).resolves.toEqual({
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
      });
    });

    it('throws 422 when auth_required lacks authorization_url', async () => {
      const { store, client } = createStore();
      client.getMcpAuthorize.mockResolvedValue({ status: 'auth_required' });
      const headers = store.resolveInvokeHeaders({ record: dcrRecord(), userRef: 'user-1' });
      if (typeof headers !== 'function') {
        throw new Error('expected async resolver');
      }
      await expect(headers()).rejects.toBeInstanceOf(HTTPException);
    });
  });
});
