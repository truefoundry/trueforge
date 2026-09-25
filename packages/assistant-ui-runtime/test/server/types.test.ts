import { describe, expect, it } from 'vitest';

import type { PermissionsServer } from '../../src/server/types.js';

describe('PermissionsServer', () => {
  it('supports USE grants for agents', async () => {
    const server: PermissionsServer = {
      listPermissions: async () => ({
        data: { type: 'agent', permissions: { agent: ['USE'] } },
      }),
    };

    await expect(server.listPermissions({ resourceType: 'agent', resourceIds: ['agent'] })).resolves.toEqual({
      data: { type: 'agent', permissions: { agent: ['USE'] } },
    });
  });

  it('supports tenant CREATE grants keyed by entity kind', async () => {
    const server: PermissionsServer = {
      listPermissions: async () => ({
        data: { type: 'tenant', permissions: { agent: ['CREATE'] } },
      }),
    };

    await expect(server.listPermissions({ resourceType: 'tenant', resourceIds: [] })).resolves.toEqual({
      data: { type: 'tenant', permissions: { agent: ['CREATE'] } },
    });
  });
});
