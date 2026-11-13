import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { createTrueForgeClient } from '@/plugins/trueforge-agent-server-adapter/client.js';

describe('createTrueForgeClient', () => {
  it('preserves the host authorization header', async () => {
    let receivedHeaders: Headers | undefined;
    const client = createTrueForgeClient({
      baseUrl: 'https://trueforge.test',
      token: 'host-token',
      fetch: async (_input, init) => {
        receivedHeaders = new Headers(init?.headers);
        return Response.json({ data: [] });
      },
    });

    await client.models.list();

    assert.equal(receivedHeaders?.get('authorization'), 'Bearer host-token');
  });
});
