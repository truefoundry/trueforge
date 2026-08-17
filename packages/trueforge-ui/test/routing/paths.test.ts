import { describe, expect, it } from 'vitest';

import { buildPath, matchPath, placesEqual, resolveRoutesConfig } from '@/routing/paths.js';

describe('resolveRoutesConfig', () => {
  it('applies defaults', () => {
    expect(resolveRoutesConfig()).toEqual({
      basename: '',
      root: '/',
      settings: '/settings',
      agent: '/agents/:agentName',
      session: '/sessions/:sessionId',
    });
  });

  it('honors overrides and disabled places', () => {
    const resolved = resolveRoutesConfig({
      basename: '/app',
      paths: { root: '/home', settings: false, agent: '/a/:agentName' },
    });
    expect(resolved.basename).toBe('/app');
    expect(resolved.root).toBe('/home');
    expect(resolved.settings).toBeNull();
    expect(resolved.agent).toBe('/a/:agentName');
    expect(resolved.session).toBe('/sessions/:sessionId');
  });

  it('normalizes trailing slashes but keeps root', () => {
    const resolved = resolveRoutesConfig({ paths: { root: '/', session: '/s/:sessionId/' } });
    expect(resolved.root).toBe('/');
    expect(resolved.session).toBe('/s/:sessionId');
  });
});

describe('buildPath', () => {
  const routes = resolveRoutesConfig();

  it('builds each place', () => {
    expect(buildPath({ type: 'root' }, routes)).toBe('/');
    expect(buildPath({ type: 'settings' }, routes)).toBe('/settings');
    expect(buildPath({ type: 'agent', agentName: 'code-helper' }, routes)).toBe('/agents/code-helper');
    expect(buildPath({ type: 'session', sessionId: 'abc123' }, routes)).toBe('/sessions/abc123');
  });

  it('encodes param values', () => {
    expect(buildPath({ type: 'agent', agentName: 'a/b c' }, routes)).toBe('/agents/a%2Fb%20c');
  });

  it('returns null for disabled places', () => {
    const disabled = resolveRoutesConfig({ paths: { settings: false, agent: false } });
    expect(buildPath({ type: 'settings' }, disabled)).toBeNull();
    expect(buildPath({ type: 'agent', agentName: 'x' }, disabled)).toBeNull();
  });
});

describe('matchPath', () => {
  const routes = resolveRoutesConfig();

  it('matches each place and decodes params', () => {
    expect(matchPath('/', routes)).toEqual({ type: 'root' });
    expect(matchPath('/settings', routes)).toEqual({ type: 'settings' });
    expect(matchPath('/agents/a%2Fb', routes)).toEqual({ type: 'agent', agentName: 'a/b' });
    expect(matchPath('/sessions/xyz', routes)).toEqual({ type: 'session', sessionId: 'xyz' });
  });

  it('returns null for unknown paths', () => {
    expect(matchPath('/nope/here', routes)).toBeNull();
    expect(matchPath('/agents', routes)).toBeNull();
  });

  // A pasted URL is untrusted input; a bad escape must not throw out of the router.
  it('treats malformed percent-escapes as no match', () => {
    expect(matchPath('/sessions/%', routes)).toBeNull();
    expect(matchPath('/sessions/%E0%A4%A', routes)).toBeNull();
    expect(matchPath('/agents/100%', routes)).toBeNull();
  });

  it('does not match disabled places', () => {
    const disabled = resolveRoutesConfig({ paths: { session: false } });
    expect(matchPath('/sessions/xyz', disabled)).toBeNull();
  });

  it('round-trips build and match', () => {
    for (const place of [
      { type: 'root' as const },
      { type: 'settings' as const },
      { type: 'agent' as const, agentName: 'weird name/1' },
      { type: 'session' as const, sessionId: 'sess 9' },
    ]) {
      const path = buildPath(place, routes);
      if (path == null) throw new Error(`Expected a path for ${place.type}`);
      expect(matchPath(path, routes)).toEqual(place);
    }
  });
});

describe('placesEqual', () => {
  it('compares type and params', () => {
    expect(placesEqual({ type: 'root' }, { type: 'root' })).toBe(true);
    expect(placesEqual({ type: 'agent', agentName: 'a' }, { type: 'agent', agentName: 'a' })).toBe(true);
    expect(placesEqual({ type: 'agent', agentName: 'a' }, { type: 'agent', agentName: 'b' })).toBe(false);
    expect(placesEqual({ type: 'session', sessionId: '1' }, { type: 'root' })).toBe(false);
  });
});
