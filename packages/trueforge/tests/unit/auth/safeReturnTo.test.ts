import { safeReturnTo } from '../../../src/auth/safeReturnTo';

describe('safeReturnTo', () => {
  it('returns same-origin relative paths unchanged', () => {
    expect(safeReturnTo('/')).toBe('/');
    expect(safeReturnTo('/settings')).toBe('/settings');
    expect(safeReturnTo('/settings?tab=mcp&pUid=abc')).toBe('/settings?tab=mcp&pUid=abc');
    expect(safeReturnTo('/chat')).toBe('/chat');
  });

  it('falls back to "/" for missing or unsafe values', () => {
    expect(safeReturnTo('https://evil.example.com/')).toBe('/');
    expect(safeReturnTo('//evil.example.com/')).toBe('/');
    expect(safeReturnTo('/api')).toBe('/');
    expect(safeReturnTo('/api/v1/auth/login')).toBe('/');
    expect(safeReturnTo('relative')).toBe('/');
    expect(safeReturnTo(undefined)).toBe('/');
  });
});
