import { HTTPException } from 'hono/http-exception';
import type { McpServerRecord } from '../../../src/db/mcpServerStore';
import { parsePerServerMcpHeaders } from '../../../src/truefoundry/perServerMcpHeaders';
import { TrueFoundryMcpServerStore } from '../../../src/truefoundry/TrueFoundryMcpServerStore';

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
    client: {} as never,
    accessToken: 'caller-token',
    subject: { id: 'user-1', type: 'user', display_name: 'user-1' },
    perServerHeaders,
  });

function invokeHeaders(store: TrueFoundryMcpServerStore, name: string) {
  return store.resolveInvokeHeaders({ record: record(name), userRef: 'user-1' });
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
  it('sends only the gateway Bearer when a server has no override', () => {
    expect(invokeHeaders(storeWith({}), 'tfy-docs-mcp')).toEqual({
      Authorization: 'Bearer caller-token',
    });
  });

  it("merges that server's override on top of the Bearer", () => {
    const headers = invokeHeaders(
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

  it('gives one server nothing of another, so an identity cannot reach the wrong upstream', () => {
    const headers = invokeHeaders(
      storeWith({
        'tfy-platform-mcp': { 'x-tfy-mcp-headers': '{"Authorization":"Bearer user"}' },
      }),
      'tfy-pylon-mcp',
    );

    expect(headers).toEqual({ Authorization: 'Bearer caller-token' });
  });

  it.each(['Authorization', 'authorization', 'AUTHORIZATION', 'AuThOrIzAtIoN'])(
    'drops an override under %s, which object keys would otherwise keep beside the Bearer',
    name => {
      const headers = invokeHeaders(
        storeWith({
          'tfy-platform-mcp': { [name]: 'Bearer smuggled' },
        }),
        'tfy-platform-mcp',
      );

      expect(Object.values(headers)).toEqual(['Bearer caller-token']);
    },
  );

  it('keeps the rest of an override that also carried an authorization key', () => {
    const headers = invokeHeaders(
      storeWith({
        'tfy-platform-mcp': { authorization: 'Bearer smuggled', 'x-tfy-mcp-headers': '{"a":"b"}' },
      }),
      'tfy-platform-mcp',
    );

    expect(headers).toEqual({ Authorization: 'Bearer caller-token', 'x-tfy-mcp-headers': '{"a":"b"}' });
  });
});
