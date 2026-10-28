// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAgentLibraryUsageStats } from '@/atoms/lib/useAgentLibraryUsageStats.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { createMockAgentMetricsServer, createMockAgentUIServer } from '../../server/mockServer.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('useAgentLibraryUsageStats', () => {
  it('moves the usage window up to now when the library refreshes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-10-27T10:00:00.000Z'));
    const getMeters = vi.fn(async () => []);
    const server = createMockAgentUIServer({
      metrics: createMockAgentMetricsServer({
        getMeters,
        getChartData: vi.fn(async () => ({ step: '3600', graphs: [] })),
      }),
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ServerProvider server={server}>{children}</ServerProvider>
    );
    const { rerender } = renderHook(
      ({ refreshKey }: { refreshKey: number }) => useAgentLibraryUsageStats({ agentIds: ['agent-1'], refreshKey }),
      { wrapper, initialProps: { refreshKey: 0 } },
    );
    await waitFor(() =>
      expect(getMeters).toHaveBeenCalledWith(expect.objectContaining({ endTimestamp: '2026-10-27T10:00:00.000Z' })),
    );

    vi.setSystemTime(new Date('2026-10-27T11:00:00.000Z'));
    rerender({ refreshKey: 1 });

    await waitFor(() =>
      expect(getMeters).toHaveBeenCalledWith(expect.objectContaining({ endTimestamp: '2026-10-27T11:00:00.000Z' })),
    );
  });
});
