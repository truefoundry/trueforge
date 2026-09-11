// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentSearchPicker } from '@/atoms/AgentSearchPicker.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { AgentUIServer } from '@/server/types.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { createMockAgentUIServer } from '../server/mockServer.js';

function wrap(server: AgentUIServer) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SlotsProvider>
        <ServerProvider server={server}>{children}</ServerProvider>
      </SlotsProvider>
    );
  };
}

describe('AgentSearchPicker', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('searches on type and selects an agent', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const searchAgents = vi.fn(async ({ query }: { query?: string } = {}) => {
      const agents = [
        { name: 'alpha-bot', agentId: 'alpha-bot' },
        { name: 'beta-bot', agentId: 'beta-bot' },
      ];
      if (query == null || query === '') return agents;
      return agents.filter(agent => agent.name.includes(query));
    });
    const onValueChange = vi.fn();
    const onAgentPicked = vi.fn();

    render(
      <AgentSearchPicker value="" selectedLabel="" onValueChange={onValueChange} onAgentPicked={onAgentPicked} />,
      { wrapper: wrap(createMockAgentUIServer({ searchAgents })) },
    );

    const input = screen.getByRole('combobox', { name: 'Agent' });
    fireEvent.focus(input);
    await waitFor(() => expect(screen.getByRole('option', { name: 'alpha-bot' })).toBeInTheDocument());

    fireEvent.change(input, { target: { value: 'beta' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    await waitFor(() => {
      expect(searchAgents).toHaveBeenCalledWith(expect.objectContaining({ query: 'beta' }));
      expect(screen.getByRole('option', { name: 'beta-bot' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('option', { name: 'beta-bot' }));
    expect(onValueChange).toHaveBeenCalledWith('beta-bot');
    expect(onAgentPicked).toHaveBeenCalledWith(expect.objectContaining({ name: 'beta-bot', agentId: 'beta-bot' }));
  });
});
