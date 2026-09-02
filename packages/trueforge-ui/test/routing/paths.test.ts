import { describe, expect, it } from 'vitest';

import {
  buildPath,
  matchLocation,
  matchPath,
  placesEqual,
  resolveRoutesConfig,
  sanitizeSearchForPlace,
} from '@/routing/paths.js';

describe('resolveRoutesConfig', () => {
  it('applies defaults', () => {
    expect(resolveRoutesConfig()).toEqual({
      basename: '',
      root: '/',
      settings: '/settings',
      library: '/library',
      libraryAgent: '/library/:agentId',
      schedules: '/schedules',
      agent: '/agents/:agentName',
      session: '/sessions/:sessionId',
      sessionsBrowser: '/sessions',
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
    expect(buildPath({ type: 'library' }, routes)).toBe('/library');
    expect(buildPath({ type: 'libraryAgent', agentId: 'agent/id' }, routes)).toBe('/library/agent%2Fid');
    expect(buildPath({ type: 'schedules' }, routes)).toBe('/schedules');
    expect(buildPath({ type: 'agent', agentName: 'code-helper' }, routes)).toBe('/agents/code-helper');
    expect(buildPath({ type: 'session', sessionId: 'abc123' }, routes)).toBe('/sessions/abc123');
    expect(buildPath({ type: 'sessionsBrowser' }, routes)).toBe('/sessions');
  });

  it('encodes param values', () => {
    expect(buildPath({ type: 'agent', agentName: 'a/b c' }, routes)).toBe('/agents/a%2Fb%20c');
  });

  it('returns null for disabled places', () => {
    const disabled = resolveRoutesConfig({
      paths: { settings: false, library: false, libraryAgent: false, agent: false },
    });
    expect(buildPath({ type: 'settings' }, disabled)).toBeNull();
    expect(buildPath({ type: 'library' }, disabled)).toBeNull();
    expect(buildPath({ type: 'libraryAgent', agentId: 'x' }, disabled)).toBeNull();
    expect(buildPath({ type: 'agent', agentName: 'x' }, disabled)).toBeNull();
  });
});

describe('sanitizeSearchForPlace', () => {
  const sessionSearch = '?theme=dark&sessionId=sess-1&agentId=agent-1&tab=sessions&view=sessions&s_sts=1&s_ets=2';

  it('clears session-owned query keys on unrelated places without dropping host keys', () => {
    expect(sanitizeSearchForPlace({ type: 'library' }, sessionSearch)).toBe('?theme=dark');
    expect(sanitizeSearchForPlace({ type: 'root' }, sessionSearch)).toBe('?theme=dark');
    expect(sanitizeSearchForPlace({ type: 'session', sessionId: 'sess-2' }, sessionSearch)).toBe('?theme=dark');
  });

  it('keeps only the query state owned by the destination place', () => {
    expect(sanitizeSearchForPlace({ type: 'sessionsBrowser' }, sessionSearch)).toBe(
      '?theme=dark&sessionId=sess-1&agentId=agent-1&view=sessions&s_sts=1&s_ets=2',
    );
    expect(sanitizeSearchForPlace({ type: 'libraryAgent', agentId: 'agent-1' }, sessionSearch)).toBe(
      '?theme=dark&sessionId=sess-1&agentId=agent-1&tab=sessions',
    );
    expect(sanitizeSearchForPlace({ type: 'libraryAgent', agentId: 'agent-2' }, sessionSearch)).toBe(
      '?theme=dark&tab=sessions',
    );
    expect(sanitizeSearchForPlace({ type: 'settings' }, sessionSearch)).toBe(sessionSearch);
  });

  it('keeps schedules filters on the schedules place and clears them elsewhere', () => {
    const scheduleSearch = '?theme=dark&agent=alpha&status=paused&q=digest&sessionId=sess-1&agentId=agent-1';
    expect(sanitizeSearchForPlace({ type: 'schedules' }, scheduleSearch)).toBe(
      '?theme=dark&agent=alpha&status=paused&q=digest',
    );
    expect(sanitizeSearchForPlace({ type: 'library' }, scheduleSearch)).toBe('?theme=dark');
  });
});

describe('matchPath', () => {
  const routes = resolveRoutesConfig();

  it('matches each place and decodes params', () => {
    expect(matchPath('/', routes)).toEqual({ type: 'root' });
    expect(matchPath('/settings', routes)).toEqual({ type: 'settings' });
    expect(matchPath('/library', routes)).toEqual({ type: 'library' });
    expect(matchPath('/library/agent%2Fid', routes)).toEqual({ type: 'libraryAgent', agentId: 'agent/id' });
    expect(matchPath('/schedules', routes)).toEqual({ type: 'schedules' });
    expect(matchPath('/agents/a%2Fb', routes)).toEqual({ type: 'agent', agentName: 'a/b' });
    expect(matchPath('/sessions', routes)).toEqual({ type: 'sessionsBrowser' });
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
      { type: 'library' as const },
      { type: 'libraryAgent' as const, agentId: 'agent id/1' },
      { type: 'schedules' as const },
      { type: 'agent' as const, agentName: 'weird name/1' },
      { type: 'session' as const, sessionId: 'sess 9' },
      { type: 'sessionsBrowser' as const },
    ]) {
      const path = buildPath(place, routes);
      if (path == null) throw new Error(`Expected a path for ${place.type}`);
      expect(matchPath(path, routes)).toEqual(place);
    }
  });
});

describe('matchLocation', () => {
  const routes = resolveRoutesConfig();

  it('opens a library agent from ?agentId= when the path is root', () => {
    expect(matchLocation({ pathname: '/', search: '?agentId=agent-1&sessionId=sess-1', routes })).toEqual({
      type: 'libraryAgent',
      agentId: 'agent-1',
    });
  });

  it('keeps a concrete pathname over the share query', () => {
    expect(matchLocation({ pathname: '/sessions/sess-1', search: '?agentId=agent-1', routes })).toEqual({
      type: 'session',
      sessionId: 'sess-1',
    });
    expect(matchLocation({ pathname: '/sessions', search: '?agentId=agent-1&view=sessions', routes })).toEqual({
      type: 'sessionsBrowser',
    });
  });
});

describe('placesEqual', () => {
  it('compares type and params', () => {
    expect(placesEqual({ type: 'root' }, { type: 'root' })).toBe(true);
    expect(placesEqual({ type: 'agent', agentName: 'a' }, { type: 'agent', agentName: 'a' })).toBe(true);
    expect(placesEqual({ type: 'agent', agentName: 'a' }, { type: 'agent', agentName: 'b' })).toBe(false);
    expect(placesEqual({ type: 'libraryAgent', agentId: 'a' }, { type: 'libraryAgent', agentId: 'a' })).toBe(true);
    expect(placesEqual({ type: 'session', sessionId: '1' }, { type: 'root' })).toBe(false);
  });
});
