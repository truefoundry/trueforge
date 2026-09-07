import { describe, expect, it, vi } from 'vitest';

import { createHarnessPermissionsServer } from '@/plugins/trueforge-agent-server-adapter/permissionsServer.js';

describe('createHarnessPermissionsServer', () => {
  it('delegates list requests to the generated internal SDK client', async () => {
    const fetchMock: typeof fetch = vi.fn(async (input, init) => {
      expect(String(input)).toBe('https://trueforge.test/api/internal/list-permissions');
      expect(init?.method).toBe('POST');
      expect(init?.body).toBe(JSON.stringify({ resource_type: 'schedule', resource_ids: ['schedule-1'] }));
      return Response.json({ data: { 'schedule-1': ['MANAGE', 'DELETE'] } });
    });
    const server = createHarnessPermissionsServer({
      baseUrl: 'https://trueforge.test',
      token: 'test-token',
      fetch: fetchMock,
    });

    await expect(server.listPermissions({ resourceType: 'schedule', resourceIds: ['schedule-1'] })).resolves.toEqual({
      data: { 'schedule-1': ['MANAGE', 'DELETE'] },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
