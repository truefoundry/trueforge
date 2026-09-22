import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentChatServer } from '../src/server/index.js';

import { createEmptySessionSnapshot } from '../src/sessionSnapshot.js';

vi.mock('../src/sessions.js', () => ({
  getSession: vi.fn(),
}));

vi.mock('../src/convertTurnMessages.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/convertTurnMessages.js')>();
  return {
    ...actual,
    buildSnapshotFromSessionEvents: vi.fn(),
  };
});

import { buildSnapshotFromSessionEvents } from '../src/convertTurnMessages.js';
import { loadSessionSnapshot } from '../src/loadSessionSnapshot.js';
import { getSession } from '../src/sessions.js';

const mockServer = {} as AgentChatServer;

describe('loadSessionSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deduplicates concurrent loads for the same session', async () => {
    vi.mocked(getSession).mockResolvedValue({} as never);
    vi.mocked(buildSnapshotFromSessionEvents).mockResolvedValue(createEmptySessionSnapshot());

    const [first, second] = await Promise.all([
      loadSessionSnapshot(mockServer, 'session-1'),
      loadSessionSnapshot(mockServer, 'session-1'),
    ]);

    expect(first).toBe(second);
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(buildSnapshotFromSessionEvents).toHaveBeenCalledTimes(1);
  });

  it('allows a new load after the previous one settles', async () => {
    vi.mocked(getSession).mockResolvedValue({} as never);
    vi.mocked(buildSnapshotFromSessionEvents).mockResolvedValue(createEmptySessionSnapshot());

    await loadSessionSnapshot(mockServer, 'session-1');
    await loadSessionSnapshot(mockServer, 'session-1');

    expect(getSession).toHaveBeenCalledTimes(2);
    expect(buildSnapshotFromSessionEvents).toHaveBeenCalledTimes(2);
  });

  it('forwards onProgress to buildSnapshotFromSessionEvents', async () => {
    vi.mocked(getSession).mockResolvedValue({} as never);
    vi.mocked(buildSnapshotFromSessionEvents).mockResolvedValue(createEmptySessionSnapshot());

    const onProgress = vi.fn();
    await loadSessionSnapshot(mockServer, 'session-1', onProgress);

    expect(buildSnapshotFromSessionEvents).toHaveBeenCalledWith(mockServer, 'session-1', onProgress);
  });
});
