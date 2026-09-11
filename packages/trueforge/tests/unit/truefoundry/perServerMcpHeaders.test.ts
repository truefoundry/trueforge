import { HTTPException } from 'hono/http-exception';
import { createLogger } from 'winston';
import type { McpServerRecord } from '../../../src/db/mcpServerStore';
import { createTrueFoundryRequestContext } from '../../../src/truefoundry/accessToken';
import { parsePerServerMcpHeaders } from '../../../src/truefoundry/perServerMcpHeaders';
import {
  TrueFoundryMcpServerStore,
  type TrueFoundryMcpApiClient,
} from '../../../src/truefoundry/TrueFoundryMcpServerStore';

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
    vendToken: () => Promise.resolve('caller-token'),
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

const storeWith = (perServerHeaders: Record<string, Record<string, string>>): TrueFoundryMcpServerStore =>
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
    'drops an override under %s, which object keys would otherwise keep beside the Bearer',
    async name => {
      const headers = await invokeHeaders(
        storeWith({
          'tfy-platform-mcp': { [name]: 'Bearer smuggled' },
        }),
        'tfy-platform-mcp',
      );

      expect(Object.values(headers)).toEqual(['Bearer caller-token']);
    },
  );

  it('keeps the rest of an override that also carried an authorization key', async () => {
    const headers = await invokeHeaders(
      storeWith({
        'tfy-platform-mcp': { authorization: 'Bearer smuggled', 'x-tfy-mcp-headers': '{"a":"b"}' },
      }),
      'tfy-platform-mcp',
    );

    expect(headers).toEqual({ Authorization: 'Bearer caller-token', 'x-tfy-mcp-headers': '{"a":"b"}' });
  });
});
