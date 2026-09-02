// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgentSessionsFilters } from '@/atoms/agent-details/AgentSessionsFilters.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { AgentLibraryEntry } from '@/server/types.js';
import { createMockAgentUIServer } from '../server/mockServer.js';

describe('AgentSessionsFilters', () => {
  it('loads every page of agents', async () => {
    const agents: AgentLibraryEntry[] = Array.from({ length: 51 }, (_, index) => ({
      agentId: `agent-${String(index + 1)}`,
      name: `Agent ${String(index + 1)}`,
    }));
    const searchAgents = vi.fn(async ({ limit = 50, offset = 0 } = {}) => agents.slice(offset, offset + limit));

    render(
      <ServerProvider server={createMockAgentUIServer({ searchAgents })}>
        <AgentSessionsFilters
          agentId={null}
          timeRange={{ startTs: 1, endTs: 2 }}
          onAgentChange={() => undefined}
          onTimeRangeChange={() => undefined}
        />
      </ServerProvider>,
    );

    await waitFor(() => expect(screen.getByRole('option', { name: 'Agent 51' })).toBeInTheDocument());
    expect(searchAgents).toHaveBeenNthCalledWith(1, { limit: 50, offset: 0 });
    expect(searchAgents).toHaveBeenNthCalledWith(2, { limit: 50, offset: 50 });
  });
});
