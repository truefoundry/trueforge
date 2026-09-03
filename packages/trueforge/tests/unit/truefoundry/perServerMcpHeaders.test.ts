import { HTTPException } from 'hono/http-exception';
import type { McpServerRecord } from '../../../src/db/mcpServerStore';
import { parsePerServerMcpHeaders } from '../../../src/truefoundry/perServerMcpHeaders';
import { TrueFoundryMcpServerStore } from '../../../src/truefoundry/TrueFoundryMcpServerStore';

const record = (name: string): McpServerRecord => ({ name }) as McpServerRecord;

const storeWith = (perServerHeaders: Record<string, Record<string, string>>): TrueFoundryMcpServerStore =>
  new TrueFoundryMcpServerStore({
    client: {} as never,
    accessToken: 'caller-token',
    perServerHeaders,
  });

describe('parsePerServerMcpHeaders', () => {
  it('treats an absent header as no overrides, which is the common case', () => {
    expect(parsePerServerMcpHeaders(undefined)).toEqual({});
    expect(parsePerServerMcpHeaders('')).toEqual({});
  });

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
});

describe('TrueFoundryMcpServerStore.resolveInvokeHeaders', () => {
  it('sends only the gateway Bearer when a server has no override', () => {
    expect(storeWith({}).resolveInvokeHeaders(record('tfy-docs-mcp'))).toEqual({
      Authorization: 'Bearer caller-token',
    });
  });

  it("merges that server's override on top of the Bearer", () => {
    const headers = storeWith({
      'tfy-platform-mcp': { 'x-tfy-mcp-headers': '{"Authorization":"Bearer user"}' },
    }).resolveInvokeHeaders(record('tfy-platform-mcp'));

    expect(headers).toEqual({
      Authorization: 'Bearer caller-token',
      'x-tfy-mcp-headers': '{"Authorization":"Bearer user"}',
    });
  });

  it('gives one server nothing of another, so an identity cannot reach the wrong upstream', () => {
    const headers = storeWith({
      'tfy-platform-mcp': { 'x-tfy-mcp-headers': '{"Authorization":"Bearer user"}' },
    }).resolveInvokeHeaders(record('tfy-pylon-mcp'));

    expect(headers).toEqual({ Authorization: 'Bearer caller-token' });
  });

  it('keeps the gateway Bearer even when an override tries to replace it', () => {
    const headers = storeWith({
      'tfy-platform-mcp': { Authorization: 'Bearer smuggled' },
    }).resolveInvokeHeaders(record('tfy-platform-mcp'));

    expect(headers['Authorization']).toBe('Bearer caller-token');
  });
});
