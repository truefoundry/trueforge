import { HTTPException } from 'hono/http-exception';
import { createLogger } from 'winston';
import { McpServerWithAuthStore } from '../../../src/db/McpServerWithAuthStore';
import type { McpServerRecord } from '../../../src/db/mcpServerStore';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteMcpServerStore } from '../../../src/db/sqlite/mcp-server-store/SqliteMcpServerStore';
import { SqliteOAuthTokenStore } from '../../../src/db/sqlite/token-store/SqliteOAuthTokenStore';
import { parsePerServerMcpHeaders, type PerServerMcpHeaders } from '../../../src/mcp/perServerMcpHeaders';
import {
  TrueFoundryMcpServerStore,
  type TrueFoundryMcpApiClient,
} from '../../../src/truefoundry/TrueFoundryMcpServerStore';
import { createTrueFoundryRequestContext } from '../../../src/truefoundry/accessToken';

function unusedClient(): TrueFoundryMcpApiClient {
  const unused = (): Promise<never> => Promise.reject(new Error('unused'));
  return {
    getMcpServerByName: async ({ name }) => ({
      id: name,
      name,
      proxyUrl: `https://gateway.example/mcp-server/${name}`,
      createdAt: '2026-01-15T12:00:00.000Z',
      updatedAt: '2026-01-16T12:00:00.000Z',
      manifest: { description: name },
    }),
    listMcpServers: unused,
    listGatewayInstallations: async () => [{ isDefault: true, manifest: { url: 'https://gateway.example' } }],
    getMcpAuthorize: async () => ({ status: 'authenticated' }),
    getMcpAuthStatus: unused,
    deleteMcpAuth: unused,
    vendToken: () => Promise.resolve({ subjectToken: 'caller-token', actorToken: 'caller-token' }),
    getTenantControlPlaneUrl: async () => 'https://tenant.example.com',
  };
}

const record = (name: string): McpServerRecord => ({
  id: name,
  tenant_id: 'default',
  name,
  manifest: {
    type: 'truefoundry',
    name,
    url: `https://gateway.example/mcp-server/${name}`,
    description: name,
  },
  created_at: '2026-01-15T12:00:00.000Z',
  updated_at: '2026-01-16T12:00:00.000Z',
});

const storeWith = (perServerHeaders: PerServerMcpHeaders): TrueFoundryMcpServerStore =>
  new TrueFoundryMcpServerStore({
    client: unusedClient(),
    requestContext: createTrueFoundryRequestContext({
      tenant_id: 'default',
      subject: { id: 'user-1', type: 'user', display_name: 'user-1' },
      roles: [],
      user_credential: 'caller-token',
    }),
    agent: undefined,
    logger: createLogger({ silent: true }),
    perServerHeaders,
  });

async function invokeHeaders(store: TrueFoundryMcpServerStore, name: string): Promise<Record<string, string>> {
  const resolve = store.resolveInvokeHeaders({ record: record(name), userRef: 'user-1' });
  if (typeof resolve !== 'function') {
    throw new Error('expected a headers resolver so the token is read at connect time');
  }
  const resolved = await resolve();
  if (!('headers' in resolved)) {
    throw new Error('expected headers rather than an auth-required signal');
  }
  return resolved.headers;
}

describe('parsePerServerMcpHeaders', () => {
  it('parses a header map per server name', () => {
    const raw = JSON.stringify({ 'tfy-platform-mcp': { 'x-tfy-mcp-headers': '{"Authorization":"Bearer user"}' } });

    expect(parsePerServerMcpHeaders(raw)).toEqual({
      'tfy-platform-mcp': { 'x-tfy-mcp-headers': '{"Authorization":"Bearer user"}' },
    });
  });

  it.each([
    ['not json', 'not-json'],
    ['an array', '[]'],
    ['a scalar', '"nope"'],
    ['a server mapped to a string', JSON.stringify({ 'tfy-platform-mcp': 'Bearer user' })],
    ['a header mapped to a number', JSON.stringify({ 'tfy-platform-mcp': { 'x-h': 1 } })],
    ['mixed nesting', JSON.stringify({ 'virtual-mcp': { serv1: { Authorization: 'Bearer a' }, 'x-h': '1' } })],
  ])('rejects %s rather than silently dropping the identity it carries', (_case, raw) => {
    expect(() => parsePerServerMcpHeaders(raw)).toThrow(HTTPException);
  });

  it('keeps the parse failure as the cause, so a bad header can be debugged', () => {
    expect(() => parsePerServerMcpHeaders('not-json')).toThrow(
      expect.objectContaining({ cause: expect.any(SyntaxError) }),
    );
  });
});

describe('TrueFoundryMcpServerStore.resolveInvokeHeaders', () => {
  it('passes a virtual MCP entry through as x-tfy-mcp-headers', async () => {
    const entry = { serv1: { Authorization: 'Bearer a' }, serv2: { Authorization: 'Bearer b' } };
    const raw = JSON.stringify({ 'virtual-mcp': entry });

    const headers = await invokeHeaders(storeWith(parsePerServerMcpHeaders(raw)), 'virtual-mcp');

    expect(headers).toEqual({ Authorization: 'Bearer caller-token', 'x-tfy-mcp-headers': JSON.stringify(entry) });
  });

  it('sends only the gateway Bearer when a server has no override', async () => {
    await expect(invokeHeaders(storeWith({}), 'tfy-docs-mcp')).resolves.toEqual({
      Authorization: 'Bearer caller-token',
    });
  });

  it("merges that server's override on top of the Bearer", async () => {
    const headers = await invokeHeaders(
      storeWith({
        'tfy-platform-mcp': { 'x-tfy-mcp-headers': '{"Authorization":"Bearer user"}' },
      }),
      'tfy-platform-mcp',
    );

    expect(headers).toEqual({
      Authorization: 'Bearer caller-token',
      'x-tfy-mcp-headers': '{"Authorization":"Bearer user"}',
    });
  });

  it('gives one server nothing of another, so an identity cannot reach the wrong upstream', async () => {
    const headers = await invokeHeaders(
      storeWith({
        'tfy-platform-mcp': { 'x-tfy-mcp-headers': '{"Authorization":"Bearer user"}' },
      }),
      'tfy-pylon-mcp',
    );

    expect(headers).toEqual({ Authorization: 'Bearer caller-token' });
  });

  it.each(['Authorization', 'authorization', 'AUTHORIZATION', 'AuThOrIzAtIoN'])(
    'sends an override under %s to the upstream via x-tfy-mcp-headers, never as the gateway Bearer',
    async name => {
      const headers = await invokeHeaders(
        storeWith({ 'tfy-platform-mcp': { [name]: 'Bearer user' } }),
        'tfy-platform-mcp',
      );

      expect(headers).toEqual({
        Authorization: 'Bearer caller-token',
        'x-tfy-mcp-headers': JSON.stringify({ [name]: 'Bearer user' }),
      });
    },
  );

  it('never calls authorize; a rejected caller Authorization falls back to the gateway auth', async () => {
    const getMcpAuthorize = jest.fn(async () => ({ status: 'authenticated' as const }));
    const store = new TrueFoundryMcpServerStore({
      client: { ...unusedClient(), getMcpAuthorize },
      requestContext: createTrueFoundryRequestContext({
        tenant_id: 'default',
        subject: { id: 'user-1', type: 'user', display_name: 'user-1' },
        roles: [],
        user_credential: 'caller-token',
      }),
      agent: undefined,
      logger: createLogger({ silent: true }),
      perServerHeaders: { 'tfy-platform-mcp': { Authorization: 'Bearer user', 'X-End-User': 'alice' } },
    });
    const resolve = store.resolveInvokeHeaders({ record: record('tfy-platform-mcp'), userRef: 'user-1' });
    if (typeof resolve !== 'function') {
      throw new Error('expected a headers resolver');
    }

    const resolved = await resolve();
    if (!('onUnauthorized' in resolved) || resolved.onUnauthorized === undefined) {
      throw new Error('expected a fallback to the gateway auth');
    }
    await expect(resolved.onUnauthorized()).resolves.toEqual({
      headers: { Authorization: 'Bearer caller-token', 'X-End-User': 'alice' },
    });
    expect(getMcpAuthorize).not.toHaveBeenCalled();
  });
});

describe('McpServerWithAuthStore.resolveInvokeHeaders', () => {
  const ossRecord: McpServerRecord = {
    id: 'oauth-mcp',
    tenant_id: 'default',
    name: 'oauth-mcp',
    manifest: {
      type: 'remote',
      name: 'oauth-mcp',
      url: 'https://mcp.example/mcp',
      description: '',
      auth: { type: 'dcr' },
    },
    created_at: '2026-01-15T12:00:00.000Z',
    updated_at: '2026-01-16T12:00:00.000Z',
  };

  it('forwards a caller Authorization directly instead of starting the DCR consent flow', async () => {
    const db = createSqliteDb(':memory:');
    const store = new McpServerWithAuthStore({
      store: new SqliteMcpServerStore(db),
      tokenStore: new SqliteOAuthTokenStore(db),
      clientName: 'test-client',
      perServerHeaders: { 'oauth-mcp': { Authorization: 'Bearer user', 'x-extra': '1' } },
    });

    const resolve = store.resolveInvokeHeaders({ record: ossRecord, userRef: 'user-1' });
    if (typeof resolve !== 'function') {
      throw new Error('expected a headers resolver');
    }
    await expect(resolve()).resolves.toMatchObject({ headers: { Authorization: 'Bearer user', 'x-extra': '1' } });
    await db.destroy();
  });

  it('sends a virtual MCP entry as x-tfy-mcp-headers on top of the registered auth', async () => {
    const entry = { serv1: { Authorization: 'Bearer a' } };
    const db = createSqliteDb(':memory:');
    const store = new McpServerWithAuthStore({
      store: new SqliteMcpServerStore(db),
      tokenStore: new SqliteOAuthTokenStore(db),
      clientName: 'test-client',
      perServerHeaders: { 'virtual-mcp': entry },
    });
    const record: McpServerRecord = {
      ...ossRecord,
      name: 'virtual-mcp',
      manifest: {
        ...ossRecord.manifest,
        name: 'virtual-mcp',
        auth: { type: 'header', headers: { Authorization: 'Bearer gateway' } },
      },
    };

    const resolve = store.resolveInvokeHeaders({ record, userRef: 'user-1' });
    if (typeof resolve !== 'function') {
      throw new Error('expected a headers resolver');
    }
    await expect(resolve()).resolves.toEqual({
      headers: { Authorization: 'Bearer gateway', 'x-tfy-mcp-headers': JSON.stringify(entry) },
    });
    await db.destroy();
  });
});
