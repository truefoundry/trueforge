import { describe, expect, it, vi } from 'vitest';

import { createTrueForgeAgentUIServer } from '@/plugins/trueforge-agent-server-adapter/index.js';
import { createHarnessSessionAccessServer } from '@/plugins/trueforge-agent-server-adapter/sessionAccessServer.js';

const GRANT = {
  subject: { subject_type: 'user', subject_id: 'user-1' },
  granted_by_subject: { subject_id: 'owner', subject_type: 'user', subject_display_name: 'Owner' },
  created_at: '2026-10-28T00:00:00.000Z',
};

const USER = { id: 'user-1', display_name: 'Ada', email: 'ada@example.com' };

function jsonResponse(body: unknown): Response {
  return Response.json(body);
}

describe('createHarnessSessionAccessServer', () => {
  it('lists grants and fills names from the user directory', async () => {
    const fetchMock: typeof fetch = vi.fn(async input => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/grants')) return jsonResponse({ data: [GRANT] });
      expect(url.pathname).toBe('/api/v1/users');
      expect(url.searchParams.get('ids')).toBe('user-1');
      return jsonResponse({ data: [USER], pagination: { limit: 25 } });
    });
    const server = createHarnessSessionAccessServer({
      baseUrl: 'https://trueforge.test',
      token: 'test-token',
      fetch: fetchMock,
    });

    await expect(server.listAccess({ sessionId: 'sess-1' })).resolves.toEqual([
      {
        subjectType: 'user',
        subjectId: 'user-1',
        displayName: 'Ada',
        email: 'ada@example.com',
        createdAt: '2026-10-28T00:00:00.000Z',
      },
    ]);
  });

  it('omits tenant grants from the collaborator list', async () => {
    const fetchMock: typeof fetch = vi.fn(async input => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/grants')) {
        return jsonResponse({
          data: [
            GRANT,
            {
              subject: { subject_type: 'tenant', subject_id: 'tenant-1' },
              granted_by_subject: {
                subject_id: 'owner',
                subject_type: 'user',
                subject_display_name: 'Owner',
              },
              created_at: '2026-10-28T00:00:00.000Z',
            },
          ],
        });
      }
      expect(url.searchParams.get('ids')).toBe('user-1');
      return jsonResponse({ data: [USER], pagination: { limit: 25 } });
    });
    const server = createHarnessSessionAccessServer({
      baseUrl: 'https://trueforge.test',
      token: 'test-token',
      fetch: fetchMock,
    });

    await expect(server.listAccess({ sessionId: 'sess-1' })).resolves.toEqual([
      {
        subjectType: 'user',
        subjectId: 'user-1',
        displayName: 'Ada',
        email: 'ada@example.com',
        createdAt: '2026-10-28T00:00:00.000Z',
      },
    ]);
  });

  it('grants and revokes through one update call', async () => {
    const bodies: unknown[] = [];
    const fetchMock: typeof fetch = vi.fn(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/grants')) {
        bodies.push(JSON.parse(String(init?.body)));
        return jsonResponse({ data: [GRANT] });
      }
      return jsonResponse({ data: [USER], pagination: { limit: 25 } });
    });
    const server = createHarnessSessionAccessServer({
      baseUrl: 'https://trueforge.test',
      token: 'test-token',
      fetch: fetchMock,
    });

    await server.grantAccess({ sessionId: 'sess-1', subjects: [{ subjectType: 'user', subjectId: 'user-1' }] });
    await server.revokeAccess({ sessionId: 'sess-1', subjectType: 'user', subjectId: 'user-1' });

    expect(bodies).toEqual([
      { grant: [{ subject_id: 'user-1', subject_type: 'user' }] },
      { revoke: [{ subject_id: 'user-1', subject_type: 'user' }] },
    ]);
  });

  it('searches users', async () => {
    const fetchMock: typeof fetch = vi.fn(async input => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/api/v1/users');
      expect(url.searchParams.get('query')).toBe('ada');
      expect(url.searchParams.get('limit')).toBe('25');
      return jsonResponse({
        data: [USER],
        pagination: { limit: 25, next_page_token: 'p2' },
      });
    });
    const server = createHarnessSessionAccessServer({
      baseUrl: 'https://trueforge.test',
      token: 'test-token',
      fetch: fetchMock,
    });

    await expect(server.searchUsers({ query: 'ada', limit: 25 })).resolves.toEqual({
      data: [{ id: 'user-1', displayName: 'Ada', email: 'ada@example.com' }],
      nextPageToken: 'p2',
    });
  });
});

describe('createTrueForgeAgentUIServer session access', () => {
  it('attaches the session access port', () => {
    const server = createTrueForgeAgentUIServer({ fetch: vi.fn() });
    expect(server.sessionAccess?.listAccess).toEqual(expect.any(Function));
    expect(server.sessionAccess?.searchUsers).toEqual(expect.any(Function));
  });
});
