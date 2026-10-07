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

  it('resolves protocol-relative URLs against the page', () => {
    expect(getHostname('//CDN.Example.com/a.png')).toBe('cdn.example.com');
  });

  it('returns null for non-http(s) schemes', () => {
    expect(getHostname('javascript:alert(1)')).toBeNull();
    expect(getHostname('data:image/png;base64,abc')).toBeNull();
  });

  it('returns the page host for same-document relative paths', () => {
    expect(getHostname('/relative/path')).toBe(window.location.hostname.toLowerCase());
  });
});

describe('isExternalHttpUrl', () => {
  it('is true for absolute http(s) on another host', () => {
    expect(isExternalHttpUrl('https://example.com/x')).toBe(true);
  });

  it('is true for protocol-relative URLs on another host', () => {
    expect(isExternalHttpUrl('//attacker.example/track')).toBe(true);
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
