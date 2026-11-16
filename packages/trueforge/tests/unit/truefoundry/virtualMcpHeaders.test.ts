import { HTTPException } from 'hono/http-exception';
import { isVirtualMcpHeaders, parseTrueFoundryPerServerMcpHeaders } from '../../../src/truefoundry/virtualMcpHeaders';

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
    expect(
      Object.fromEntries(Object.entries(parsed).map(([name, entry]) => [name, isVirtualMcpHeaders(entry)])),
    ).toEqual({ 'github-mcp': false, 'virtual-mcp': true });
  });

  it.each([
    ['mixed nesting', JSON.stringify({ 'virtual-mcp': { serv1: { Authorization: 'Bearer a' }, 'x-h': '1' } })],
    ['a managed session header', JSON.stringify({ 'github-mcp': { 'Mcp-Session-Id': 'other' } })],
  ])('rejects %s', (_case, raw) => {
    expect(() => parseTrueFoundryPerServerMcpHeaders(raw)).toThrow(HTTPException);
  });
});
