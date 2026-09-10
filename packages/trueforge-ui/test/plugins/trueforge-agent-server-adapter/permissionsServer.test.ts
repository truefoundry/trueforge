import { describe, expect, it, vi } from 'vitest';

import { createTrueForgeAgentUIServer } from '@/plugins/trueforge-agent-server-adapter/index.js';
import { createHarnessPermissionsServer } from '@/plugins/trueforge-agent-server-adapter/permissionsServer.js';
import type { PermissionsServer } from '@/server/types.js';

describe('createHarnessPermissionsServer', () => {
  it('delegates list requests to the generated internal SDK client', async () => {
    const fetchMock: typeof fetch = vi.fn(async (input, init) => {
      expect(String(input)).toBe('https://trueforge.test/api/internal/list-permissions');
      expect(init?.method).toBe('POST');
      expect(init?.body).toBe(JSON.stringify({ resource_type: 'agent', resource_ids: ['agent-1'] }));
      return Response.json({ data: { 'agent-1': ['USE'] } });
    });
    const server = createHarnessPermissionsServer({
      baseUrl: 'https://trueforge.test',
      token: 'test-token',
      fetch: fetchMock,
    });

    await expect(server.listPermissions({ resourceType: 'agent', resourceIds: ['agent-1'] })).resolves.toEqual({
      data: { 'agent-1': ['USE'] },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe('createTrueForgeAgentUIServer permissions', () => {
  it('omits permissions by default', () => {
    const server = createTrueForgeAgentUIServer({ fetch: vi.fn() });
    expect(server.permissions).toBeUndefined();
  });

  it('preserves an explicit permissions port', () => {
    const permissions: PermissionsServer = {
      listPermissions: vi.fn(async () => ({ data: {} })),
    };
    const server = createTrueForgeAgentUIServer({ fetch: vi.fn(), permissions });
    expect(server.permissions).toBe(permissions);
  });
});
