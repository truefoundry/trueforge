import { createLogger } from 'winston';
import { getPublicBaseUrl } from '../../../src/config';
import { McpServerNotFoundError, type McpServerRecord } from '../../../src/db/mcpServerStore';
import { createTrueFoundryRequestContext } from '../../../src/truefoundry/accessToken';
import { MCP_PROXY_BASE_URL_TEMPLATE } from '../../../src/truefoundry/mapSfyMcpServers';
import type { TrueFoundryMcpApiClient } from '../../../src/truefoundry/TrueFoundryMcpServerStore';
import {
  resolveAuthorizeRedirectURL,
  TrueFoundryMcpServerStore,
} from '../../../src/truefoundry/TrueFoundryMcpServerStore';

const TENANT = 'default';
const ACCESS_TOKEN = 'caller-access-token';

const SFY_ROW = {
  id: 'mcp-id-1',
  name: 'github',
  proxyUrl: `${MCP_PROXY_BASE_URL_TEMPLATE}/mcp-server/github`,
  createdAt: '2026-01-15T12:00:00.000Z',
  updatedAt: '2026-01-16T12:00:00.000Z',
  manifest: { description: 'GitHub MCP', auth_data: { type: 'oauth2' } },
};

const GATEWAY_INSTALLATIONS = [{ isDefault: true, manifest: { url: 'https://gateway.example' } }];

type MockClient = {
  [K in keyof TrueFoundryMcpApiClient]: jest.MockedFunction<TrueFoundryMcpApiClient[K]>;
};

function createMockClient(): MockClient {
  return {
    getMcpServerByName: jest.fn(),
    listMcpServers: jest.fn(),
    listGatewayInstallations: jest.fn(),
    getMcpAuthorize: jest.fn(),
    getMcpAuthStatus: jest.fn(),
    deleteMcpAuth: jest.fn(),
    vendToken: jest.fn(),
  };
}

function createStore(input?: {
  accessToken?: string;
  client?: MockClient;
  subject?: { id: string; type: string; display_name: string };
}) {
  const client = input?.client ?? createMockClient();
  client.getMcpServerByName.mockResolvedValue(SFY_ROW);
  client.listGatewayInstallations.mockResolvedValue(GATEWAY_INSTALLATIONS);
  client.listMcpServers.mockResolvedValue([SFY_ROW]);
  client.getMcpAuthorize.mockResolvedValue({ status: 'authenticated' });
  client.getMcpAuthStatus.mockResolvedValue({ status: 'authenticated' });
  client.deleteMcpAuth.mockResolvedValue(undefined);
  const store = new TrueFoundryMcpServerStore({
    client,
    requestContext: createTrueFoundryRequestContext({
      tenant_id: TENANT,
      subject: input?.subject ?? { id: 'user-1', type: 'user', display_name: 'user-1' },
      roles: [],
      user_credential: input?.accessToken ?? ACCESS_TOKEN,
    }),
    agent: undefined,
    logger: createLogger({ silent: true }),
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

function truefoundryRecordWithoutAuth(overrides: { name?: string; id?: string } = {}) {
  const name = overrides.name ?? 'private-api';
  return {
    id: overrides.id ?? 'mcp-id-header',
    tenant_id: TENANT,
    name,
    manifest: {
      type: 'truefoundry' as const,
      name,
      url: `https://gateway.example/mcp-server/${name}`,
      description: 'Per-user token MCP',
    },
    created_at: '2026-01-15T12:00:00.000Z',
    updated_at: '2026-01-16T12:00:00.000Z',
  };
}

describe('resolveAuthorizeRedirectURL', () => {
  it('builds an absolute FE landing from return_to', () => {
    const returnTo = '/?screenType=mcp-auth&pUid=popup-1';
    expect(resolveAuthorizeRedirectURL({ returnTo })).toBe(new URL(returnTo, `${getPublicBaseUrl()}/`).href);
  });
});

describe('TrueFoundryMcpServerStore', () => {
  describe('listServers', () => {
    it('filters names with one SFY list call (name IN)', async () => {
      const { store, client } = createStore();
      client.listMcpServers.mockResolvedValue([SFY_ROW]);

      const records = await store.listServers({
        tenant_id: TENANT,
        names: ['github', 'missing'],
      });

      expect(client.listMcpServers).toHaveBeenCalledWith({
        accessToken: ACCESS_TOKEN,
        names: ['github', 'missing'],
      });
      expect(client.getMcpServerByName).not.toHaveBeenCalled();
      expect(records.map(server => server.name)).toEqual(['github']);
    });
  });

  describe('authorize', () => {
    it('derives upstream redirectURL from return_to', async () => {
      const { store, client } = createStore();
      const returnTo = '/?screenType=mcp-auth&pUid=popup-1';
      await store.authorize({ tenant_id: TENANT, name: 'github', userRef: 'user-1', returnTo });
      expect(client.getMcpAuthorize).toHaveBeenCalledWith({
        accessToken: ACCESS_TOKEN,
        mcpServerId: 'mcp-id-1',
        redirectURL: resolveAuthorizeRedirectURL({ returnTo }),
      });
    });

    it('throws McpServerNotFoundError when the server is missing', async () => {
      const { store, client } = createStore();
      client.getMcpServerByName.mockResolvedValue(undefined);
      await expect(store.authorize({ tenant_id: TENANT, name: 'missing', userRef: 'user-1' })).rejects.toBeInstanceOf(
        McpServerNotFoundError,
      );
    });
  });

  describe('deleteAuthorization', () => {
    it('forwards constructor subject to SFY delete', async () => {
      const { store, client } = createStore({
        subject: {
          id: 'va-1:ext:alice@example.com',
          type: 'virtualaccount',
          display_name: 'va-1:ext:alice@example.com',
        },
      });
      await store.deleteAuthorization({ tenant_id: TENANT, name: 'github', userRef: 'ignored' });
      expect(client.deleteMcpAuth).toHaveBeenCalledWith({
        accessToken: ACCESS_TOKEN,
        mcpServerId: 'mcp-id-1',
        subjectId: 'va-1:ext:alice@example.com',
        subjectType: 'virtualaccount',
        authSource: 'oauth',
      });
    });
  });

  describe('resolveAuthStatuses', () => {
    it('skips live status for multi-record lists', async () => {
      const { store, client } = createStore();
      const statuses = await store.resolveAuthStatuses({
        records: [dcrRecord(), dcrRecord({ name: 'slack' })],
        userRef: 'user-1',
      });
      expect(client.getMcpAuthStatus).not.toHaveBeenCalled();
      expect(statuses.get('github')).toEqual({ status: 'authenticated' });
      expect(statuses.get('slack')).toEqual({ status: 'authenticated' });
    });

    it('calls live status for a single dcr record', async () => {
      const { store, client } = createStore();
      client.getMcpAuthStatus.mockResolvedValue({
        status: 'auth_required',
        authorization_url: 'https://consent.example/authorize',
      });
      const statuses = await store.resolveAuthStatuses({
        records: [dcrRecord()],
        userRef: 'user-1',
      });
      expect(client.getMcpAuthStatus).toHaveBeenCalledWith({
        accessToken: ACCESS_TOKEN,
        mcpServerId: 'mcp-id-1',
        subjectId: 'user-1',
        subjectType: 'user',
      });
      expect(statuses.get('github')).toEqual({
        status: 'auth_required',
        authorization_url: 'https://consent.example/authorize',
      });
    });

    it('calls live status for a single truefoundry record without wire auth', async () => {
      const { store, client } = createStore();
      client.getMcpAuthStatus.mockResolvedValue({ status: 'auth_required' });
      const record = truefoundryRecordWithoutAuth();
      const statuses = await store.resolveAuthStatuses({
        records: [record],
        userRef: 'user-1',
      });
      expect(client.getMcpAuthStatus).toHaveBeenCalledWith({
        accessToken: ACCESS_TOKEN,
        mcpServerId: record.id,
        subjectId: 'user-1',
        subjectType: 'user',
      });
      expect(statuses.get(record.name)).toEqual({ status: 'auth_required' });
    });
  });

  describe('resolveInvokeHeaders mid-turn', () => {
    async function invoke(store: TrueFoundryMcpServerStore, record: McpServerRecord = dcrRecord()) {
      const headers = store.resolveInvokeHeaders({ record, userRef: 'user-1' });
      if (typeof headers !== 'function') {
        throw new Error('expected async headers resolver for truefoundry MCP');
      }
      return headers();
    }

    it('returns authRequired when authorize reports auth_required', async () => {
      const { store, client } = createStore();
      client.getMcpAuthorize.mockResolvedValue({
        status: 'auth_required',
        authorization_url: 'https://consent.example/authorize',
      });
      await expect(invoke(store)).resolves.toEqual({
        authRequired: {
          servers: [{ id: 'github', name: 'github', auth_url: 'https://consent.example/authorize' }],
        },
      });
    });

    it('gates non-dcr truefoundry servers through authorize as well', async () => {
      const { store, client } = createStore();
      const record = truefoundryRecordWithoutAuth();
      client.getMcpServerByName.mockResolvedValue({
        id: record.id,
        name: record.name,
        proxyUrl: `${MCP_PROXY_BASE_URL_TEMPLATE}/mcp-server/${record.name}`,
        createdAt: record.created_at,
        updatedAt: record.updated_at,
        manifest: { description: record.manifest.description, auth_data: { type: 'header' } },
      });
      client.getMcpAuthorize.mockResolvedValue({
        status: 'auth_required',
        authorization_url: 'https://consent.example/auth-override',
      });
      await expect(invoke(store, record)).resolves.toEqual({
        authRequired: {
          servers: [{ id: record.name, name: record.name, auth_url: 'https://consent.example/auth-override' }],
        },
      });
      expect(client.getMcpAuthorize).toHaveBeenCalled();
    });

    it('returns gateway Bearer when authorize reports authenticated', async () => {
      const { store } = createStore();
      await expect(invoke(store)).resolves.toEqual({
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
      });
    });

    it('throws 422 when auth_required lacks authorization_url', async () => {
      const { store, client } = createStore();
      client.getMcpAuthorize.mockResolvedValue({ status: 'auth_required' });
      await expect(invoke(store)).rejects.toMatchObject({ status: 422 });
    });
  });
});
