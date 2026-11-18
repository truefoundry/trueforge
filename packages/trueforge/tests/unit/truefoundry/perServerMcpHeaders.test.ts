import { HTTPException } from 'hono/http-exception';
import { parseTrueFoundryPerServerMcpHeaders } from '../../../src/truefoundry/perServerMcpHeaders';

describe('parseTrueFoundryPerServerMcpHeaders', () => {
  it('accepts a flat header map and a virtual MCP nested map', () => {
    const raw = JSON.stringify({
      'github-mcp': { Authorization: 'Bearer user' },
      'virtual-mcp': { serv1: { Authorization: 'Bearer a' } },
    });

    const parsed = parseTrueFoundryPerServerMcpHeaders(raw);

    expect(parsed).toEqual({
      'github-mcp': { Authorization: 'Bearer user' },
      'virtual-mcp': { serv1: { Authorization: 'Bearer a' } },
    });
  });

  it.each([
    ['mixed nesting', JSON.stringify({ 'virtual-mcp': { serv1: { Authorization: 'Bearer a' }, 'x-h': '1' } })],
    ['a managed session header', JSON.stringify({ 'github-mcp': { 'Mcp-Session-Id': 'other' } })],
  ])('rejects %s', (_case, raw) => {
    expect(() => parseTrueFoundryPerServerMcpHeaders(raw)).toThrow(HTTPException);
  });
});
