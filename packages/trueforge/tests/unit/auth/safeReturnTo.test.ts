import { safeReturnTo } from '../../../src/auth/safeReturnTo';

describe('safeReturnTo', () => {
  it('returns same-origin relative paths unchanged', () => {
    expect(safeReturnTo('/')).toBe('/');
    expect(safeReturnTo('/settings')).toBe('/settings');
    expect(safeReturnTo('/settings?tab=mcp&pUid=abc')).toBe('/settings?tab=mcp&pUid=abc');
    expect(safeReturnTo('/chat')).toBe('/chat');
  });

  it('falls back to the public UI home for missing or unsafe values', () => {
    expect(safeReturnTo('https://evil.example.com/')).toBe('/');
    expect(safeReturnTo('//evil.example.com/')).toBe('/');
    // Browsers treat `\` as `/` on https Location redirects (open redirect).
    expect(safeReturnTo('/\\evil.example.net')).toBe('/');
    // URL parsers strip tabs/newlines, turning `/<TAB>/host` into `//host`.
    expect(safeReturnTo('/\t/evil.example.net')).toBe('/');
    expect(safeReturnTo('/\r/evil.example.net')).toBe('/');
    expect(safeReturnTo('/\n/evil.example.net')).toBe('/');
    expect(safeReturnTo('/api')).toBe('/');
    expect(safeReturnTo('/api/v1/auth/login')).toBe('/');
    expect(safeReturnTo('relative')).toBe('/');
    expect(safeReturnTo(undefined)).toBe('/');
  });
});
