// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import {
  EXTERNAL_URL_TRUST_STORAGE_KEY,
  getHostname,
  isExternalHttpUrl,
  isTrustedHost,
  trustHost,
} from '@/atoms/externalUrlTrust.js';

afterEach(() => {
  window.localStorage.removeItem(EXTERNAL_URL_TRUST_STORAGE_KEY);
});

describe('getHostname', () => {
  it('returns lowercase host for http(s) URLs', () => {
    expect(getHostname('https://Example.COM/path')).toBe('example.com');
    expect(getHostname('http://evil.test/?q=1')).toBe('evil.test');
  });

  it('returns null for non-http(s) and invalid URLs', () => {
    expect(getHostname('javascript:alert(1)')).toBeNull();
    expect(getHostname('data:image/png;base64,abc')).toBeNull();
    expect(getHostname('/relative/path')).toBeNull();
    expect(getHostname('not a url')).toBeNull();
  });
});

describe('isExternalHttpUrl', () => {
  it('is true for absolute http(s) on another host', () => {
    expect(isExternalHttpUrl('https://example.com/x')).toBe(true);
  });

  it('is false for same-origin, relative, data, and blob URLs', () => {
    const sameOrigin = `${window.location.origin}/local.png`;
    expect(isExternalHttpUrl(sameOrigin)).toBe(false);
    expect(isExternalHttpUrl('/relative.png')).toBe(false);
    expect(isExternalHttpUrl('data:image/png;base64,abc')).toBe(false);
    expect(isExternalHttpUrl('blob:https://example.com/uuid')).toBe(false);
  });
});

describe('trustHost / isTrustedHost', () => {
  it('persists links and images allowlists separately', () => {
    trustHost({ kind: 'links', host: 'React.DEV' });
    expect(isTrustedHost({ kind: 'links', host: 'react.dev' })).toBe(true);
    expect(isTrustedHost({ kind: 'images', host: 'react.dev' })).toBe(false);

    trustHost({ kind: 'images', host: 'cdn.example.com' });
    expect(isTrustedHost({ kind: 'images', host: 'cdn.example.com' })).toBe(true);
    expect(isTrustedHost({ kind: 'links', host: 'cdn.example.com' })).toBe(false);

    const storedRaw = window.localStorage.getItem(EXTERNAL_URL_TRUST_STORAGE_KEY);
    expect(storedRaw).toContain('"version":1');
    expect(storedRaw).toContain('"react.dev"');
    expect(storedRaw).toContain('"cdn.example.com"');
  });
});
