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

  it('shows a load error instead of an empty catalog', async () => {
    const searchAgents = vi.fn(async () => {
      throw new Error('catalog unavailable');
    });

    render(<AgentSearchPicker value="" selectedLabel="" onValueChange={() => undefined} />, {
      wrapper: wrap(createMockAgentUIServer({ searchAgents })),
    });

    fireEvent.focus(screen.getByRole('combobox', { name: 'Agent' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('catalog unavailable');
    expect(screen.queryByText('No Agents created yet')).not.toBeInTheDocument();
  });

  it('offers an All option for filter use and clears it while searching', async () => {
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

    render(
      <AgentSearchPicker
        value="all"
        selectedLabel="All agents"
        onValueChange={onValueChange}
        allOption={{ value: 'all', label: 'All agents' }}
        aria-label="Filter by agent"
      />,
      { wrapper: wrap(createMockAgentUIServer({ searchAgents })) },
    );

    const input = screen.getByRole('combobox', { name: 'Filter by agent' });
    fireEvent.focus(input);
    expect(await screen.findByRole('option', { name: 'All agents' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('option', { name: 'alpha-bot' }));
    expect(onValueChange).toHaveBeenCalledWith('alpha-bot');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'beta' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: 'All agents' })).not.toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'beta-bot' })).toBeInTheDocument();
    });
  });
});
