import { resolvePublicBaseUrl } from '../../../src/config';

describe('resolvePublicBaseUrl', () => {
  it('returns a non-empty override in either mode', () => {
    expect(
      resolvePublicBaseUrl({
        port: 8790,
        standalone: true,
        override: 'https://example.com',
      }),
    ).toBe('https://example.com');
    expect(
      resolvePublicBaseUrl({
        port: 8790,
        standalone: false,
        override: 'https://example.com',
      }),
    ).toBe('https://example.com');
  });

  it('does not trim a non-empty override', () => {
    expect(
      resolvePublicBaseUrl({
        port: 8790,
        standalone: false,
        override: 'https://example.com/',
      }),
    ).toBe('https://example.com/');
  });

  it('falls back to localhost in standalone when unset or blank', () => {
    expect(resolvePublicBaseUrl({ port: 8790, standalone: true, override: undefined })).toBe('http://localhost:8790');
    expect(resolvePublicBaseUrl({ port: 8790, standalone: true, override: '' })).toBe('http://localhost:8790');
    expect(resolvePublicBaseUrl({ port: 3000, standalone: true, override: '   ' })).toBe('http://localhost:3000');
  });

  it('keeps empty string in distributed when unset or blank', () => {
    expect(resolvePublicBaseUrl({ port: 8790, standalone: false, override: undefined })).toBe('');
    expect(resolvePublicBaseUrl({ port: 8790, standalone: false, override: '' })).toBe('');
    expect(resolvePublicBaseUrl({ port: 8790, standalone: false, override: '   ' })).toBe('');
  });
});
