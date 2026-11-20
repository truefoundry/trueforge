// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentSessionsFilters } from '@/atoms/agent-details/AgentSessionsFilters.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { createMockAgentUIServer } from '../server/mockServer.js';

describe('AgentSessionsFilters', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('searches agents and applies the selected agent filter', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const searchAgents = vi.fn(async ({ query }: { query?: string } = {}) => {
      const agents = [
        { agentId: 'alpha-agent', name: 'Alpha agent' },
        { agentId: 'beta-agent', name: 'Beta agent' },
      ];
      return {
        data: query == null ? agents : agents.filter(agent => agent.name.toLowerCase().includes(query.toLowerCase())),
      };
    });
    const onAgentChange = vi.fn();

    render(
      <ServerProvider server={createMockAgentUIServer({ searchAgents })}>
        <AgentSessionsFilters
          agentId={null}
          timeRange={{ startTs: 1, endTs: 2 }}
          onAgentChange={onAgentChange}
          onTimeRangeChange={() => undefined}
        />
      </ServerProvider>,
    );

    expect(searchAgents).not.toHaveBeenCalled();
    const filter = screen.getByRole('combobox', { name: 'Filter sessions by agent' });
    fireEvent.focus(filter);
    expect(await screen.findByRole('option', { name: 'Alpha agent' })).toBeInTheDocument();

    fireEvent.change(filter, { target: { value: 'beta' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    await waitFor(() => {
      expect(searchAgents).toHaveBeenCalledWith(expect.objectContaining({ query: 'beta' }));
      expect(screen.getByRole('option', { name: 'Beta agent' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('option', { name: 'Beta agent' }));
    expect(onAgentChange).toHaveBeenCalledWith('beta-agent');
  });

  it('resolves the selected agent name after a refresh', async () => {
    const searchAgents = vi.fn(async () => ({ data: [{ agentId: 'agent-id', name: 'Agent name' }] }));

    render(
      <ServerProvider server={createMockAgentUIServer({ searchAgents })}>
        <AgentSessionsFilters
          agentId="agent-id"
          timeRange={{ startTs: 1, endTs: 2 }}
          onAgentChange={() => undefined}
          onTimeRangeChange={() => undefined}
        />
      </ServerProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Filter sessions by agent' })).toHaveValue('Agent name');
    });
  });

  it('can hide the custom time range option', () => {
    const endTs = Date.parse('2026-08-01T00:00:00');
    render(
      <AgentSessionsFilters
        agentId={null}
        timeRange={{ startTs: endTs - 24 * 60 * 60 * 1000, endTs, timeWindowMs: 24 * 60 * 60 * 1000 }}
        onAgentChange={() => undefined}
        onTimeRangeChange={() => undefined}
        showAgentFilter={false}
        showCustomTimeRange={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Last 24 hours' }));
    expect(screen.queryByRole('button', { name: 'Custom Time Range' })).not.toBeInTheDocument();
  });

  it('renders and triggers the reload button when onReload is passed', () => {
    const onReload = vi.fn();
    render(
      <AgentSessionsFilters
        agentId={null}
        timeRange={{ startTs: 1, endTs: 2 }}
        onAgentChange={() => undefined}
        onTimeRangeChange={() => undefined}
        onReload={onReload}
      />,
    );

    const reloadButton = screen.getByRole('button', { name: 'Reload sessions' });
    expect(reloadButton).toBeInTheDocument();
    expect(reloadButton).not.toBeDisabled();
    fireEvent.click(reloadButton);
    expect(onReload).toHaveBeenCalledOnce();
  });

  it('disables the reload button and spins icon when isReloading is true', () => {
    render(
      <AgentSessionsFilters
        agentId={null}
        timeRange={{ startTs: 1, endTs: 2 }}
        onAgentChange={() => undefined}
        onTimeRangeChange={() => undefined}
        onReload={() => undefined}
        isReloading={true}
      />,
    );

    const reloadButton = screen.getByRole('button', { name: 'Reload sessions' });
    expect(reloadButton).toBeDisabled();
    expect(reloadButton.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('does not render reload button when onReload is omitted', () => {
    render(
      <AgentSessionsFilters
        agentId={null}
        timeRange={{ startTs: 1, endTs: 2 }}
        onAgentChange={() => undefined}
        onTimeRangeChange={() => undefined}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Reload sessions' })).not.toBeInTheDocument();
  });

  it('filters to sessions created by the current user', () => {
    const onCreatedByMeChange = vi.fn();
    render(
      <AgentSessionsFilters
        agentId={null}
        timeRange={{ startTs: 1, endTs: 2 }}
        onAgentChange={() => undefined}
        onTimeRangeChange={() => undefined}
        onCreatedByMeChange={onCreatedByMeChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show sessions' }));
    fireEvent.click(screen.getByRole('option', { name: 'My sessions' }));
    expect(onCreatedByMeChange).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Show sessions' }));
    fireEvent.click(screen.getByRole('option', { name: 'All sessions' }));
    expect(onCreatedByMeChange).toHaveBeenLastCalledWith(false);
  });

  it('marks the active scope as pressed', () => {
    render(
      <AgentSessionsFilters
        agentId={null}
        timeRange={{ startTs: 1, endTs: 2 }}
        onAgentChange={() => undefined}
        onTimeRangeChange={() => undefined}
        createdByMe
        onCreatedByMeChange={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show sessions' }));
    expect(screen.getByRole('option', { name: 'My sessions' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: 'All sessions' })).toHaveAttribute('aria-selected', 'false');
  });

  it('hides the creator filter when the page does not handle it', () => {
    render(
      <AgentSessionsFilters
        agentId={null}
        timeRange={{ startTs: 1, endTs: 2 }}
        onAgentChange={() => undefined}
        onTimeRangeChange={() => undefined}
        showAgentFilter={false}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Show sessions' })).not.toBeInTheDocument();
  });
});
