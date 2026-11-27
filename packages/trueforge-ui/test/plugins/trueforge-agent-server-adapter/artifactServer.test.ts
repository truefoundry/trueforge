import { describe, expect, it, vi } from 'vitest';

import { createArtifactServer } from '@/plugins/trueforge-agent-server-adapter/artifactServer.js';
import type { TrueForge } from '@truefoundry/trueforge-sdk';

const createdBySubject = {
  subjectId: 'user-1',
  subjectType: 'user' as const,
  subjectDisplayName: 'alice@example.com',
};

const sdkArtifact = {
  id: 'a1',
  name: 'Q4 brief',
  createdBySubject,
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-02T00:00:00.000Z'),
};

function mockClient({
  list = vi.fn(),
  update = vi.fn(),
}: {
  list?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
}) {
  return { artifacts: { list, update } } as unknown as TrueForge;
}

describe('createArtifactServer', () => {
  it('lists artifacts with paging tokens and forwards the name search', async () => {
    const list = vi.fn(async () => ({
      data: [sdkArtifact],
      response: { pagination: { limit: 10, nextPageToken: 'next-1' } },
    }));
    const server = createArtifactServer(mockClient({ list }));

    const page = await server.listArtifacts({ limit: 10, pageToken: 'p1', name: 'brief', scope: 'created_by_me' });

    expect(list).toHaveBeenCalledWith({ limit: 10, pageToken: 'p1', name: 'brief' });
    expect(page.nextPageToken).toBe('next-1');
    expect(page.data).toEqual([
      {
        id: 'a1',
        name: 'Q4 brief',
        createdBySubject,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      },
    ]);
  });

  it('omits an empty name from the list request', async () => {
    const list = vi.fn(async () => ({ data: [], response: { pagination: { limit: 25 } } }));
    await createArtifactServer(mockClient({ list })).listArtifacts({ name: '' });
    expect(list).toHaveBeenCalledWith({});
  });

  it('renames through the update route and maps the response', async () => {
    const update = vi.fn(async () => ({ data: { ...sdkArtifact, name: 'Renamed' } }));
    const renamed = await createArtifactServer(mockClient({ update })).updateArtifact({ id: 'a1', name: 'Renamed' });

    expect(update).toHaveBeenCalledWith('a1', { name: 'Renamed' });
    expect(renamed.name).toBe('Renamed');
    expect(renamed.updatedAt).toBe('2024-01-02T00:00:00.000Z');
  });

  it('rejects the routes the API does not have yet', async () => {
    const server = createArtifactServer(mockClient({}));
    await expect(server.getArtifact({ id: 'a1' })).rejects.toThrow('not available yet');
    await expect(server.deleteArtifact({ id: 'a1' })).rejects.toThrow('not available yet');
    await expect(server.readArtifactFile({ id: 'a1' })).rejects.toThrow('not available yet');
  });
});
