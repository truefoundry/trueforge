import { isSafeReturnTo, safeReturnTo } from '../../../src/utils/safeReturnTo';

describe('safeReturnTo', () => {
  it('accepts same-origin relative paths', () => {
    expect(isSafeReturnTo('/')).toBe(true);
    expect(isSafeReturnTo('/settings')).toBe(true);
    expect(isSafeReturnTo('/settings?tab=mcp&pUid=abc')).toBe(true);
    expect(safeReturnTo('/chat')).toBe('/chat');
  });

  it('rejects open redirects and API paths', () => {
    expect(isSafeReturnTo('https://evil.example.com/')).toBe(false);
    expect(isSafeReturnTo('//evil.example.com/')).toBe(false);
    expect(isSafeReturnTo('/api')).toBe(false);
    expect(isSafeReturnTo('/api/v1/auth/login')).toBe(false);
    expect(isSafeReturnTo('relative')).toBe(false);
    expect(safeReturnTo('https://evil.example.com/')).toBe('/');
    expect(safeReturnTo(undefined)).toBe('/');
  });
});
