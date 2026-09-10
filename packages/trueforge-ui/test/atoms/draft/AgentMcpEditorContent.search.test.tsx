// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgentMcpEditorContent } from '@/atoms/draft/AgentMcpEditorContent.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';

describe('AgentMcpEditorContent tool search', () => {
  it('filters the complete MCP connector list by name and description', () => {
    const props = {
      spec: { model: { name: 'openai/gpt' } },
      connectors: [
        { id: 'github', name: 'GitHub', description: 'Source control', authenticated: true },
        { id: 'linear', name: 'Linear', description: 'Issue tracking', authenticated: true },
      ],
      activeConnectorId: 'github',
      tools: [],
      connectorLoading: false,
      connectorError: null,
      toolsLoading: false,
      toolsError: null,
      onQueryChange: vi.fn(),
      onSelectConnector: vi.fn(),
      onRetryTools: vi.fn(),
      onChange: vi.fn(),
    };
    const view = render(
      <SlotsProvider>
        <AgentMcpEditorContent {...props} query="" />
      </SlotsProvider>,
    );

    expect(screen.getByRole('button', { name: 'GitHub' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Linear' })).toBeInTheDocument();

    view.rerender(
      <SlotsProvider>
        <AgentMcpEditorContent {...props} query="issue" />
      </SlotsProvider>,
    );

    expect(screen.queryByRole('button', { name: 'GitHub' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Linear' })).toBeInTheDocument();
  });

  it('lists MCP connectors with selected tools before unselected ones', () => {
    render(
      <SlotsProvider>
        <AgentMcpEditorContent
          spec={{
            model: { name: 'openai/gpt' },
            mcpServers: [{ id: 'linear', name: 'Linear', enableTools: ['@all'] }],
          }}
          connectors={[
            { id: 'github', name: 'GitHub', description: 'Source control', authenticated: true },
            { id: 'slack', name: 'Slack', description: 'Chat', authenticated: true },
            { id: 'linear', name: 'Linear', description: 'Issue tracking', authenticated: true },
          ]}
          query=""
          activeConnectorId="linear"
          tools={[]}
          connectorLoading={false}
          connectorError={null}
          toolsLoading={false}
          toolsError={null}
          onQueryChange={vi.fn()}
          onSelectConnector={vi.fn()}
          onRetryTools={vi.fn()}
          onChange={vi.fn()}
        />
      </SlotsProvider>,
    );

    const names = screen
      .getAllByRole('button')
      .map(button => button.getAttribute('aria-label'))
      .filter((name): name is string => name === 'GitHub' || name === 'Slack' || name === 'Linear');
    expect(names).toEqual(['Linear', 'GitHub', 'Slack']);
  });

  it('does not reshuffle the MCP list when tools are selected while the modal is open', () => {
    const connectors = [
      { id: 'github', name: 'GitHub', description: 'Source control', authenticated: true },
      { id: 'slack', name: 'Slack', description: 'Chat', authenticated: true },
      { id: 'linear', name: 'Linear', description: 'Issue tracking', authenticated: true },
    ];
    const baseProps = {
      connectors,
      query: '',
      activeConnectorId: 'github',
      tools: [{ id: 'search', name: 'search' }],
      connectorLoading: false,
      connectorError: null,
      toolsLoading: false,
      toolsError: null,
      onQueryChange: vi.fn(),
      onSelectConnector: vi.fn(),
      onRetryTools: vi.fn(),
      onChange: vi.fn(),
    };
    const view = render(
      <SlotsProvider>
        <AgentMcpEditorContent {...baseProps} spec={{ model: { name: 'openai/gpt' } }} />
      </SlotsProvider>,
    );

    const names = () =>
      screen
        .getAllByRole('button')
        .map(button => button.getAttribute('aria-label'))
        .filter((name): name is string => name === 'GitHub' || name === 'Slack' || name === 'Linear');
    expect(names()).toEqual(['GitHub', 'Slack', 'Linear']);

    view.rerender(
      <SlotsProvider>
        <AgentMcpEditorContent
          {...baseProps}
          spec={{
            model: { name: 'openai/gpt' },
            mcpServers: [{ id: 'linear', name: 'Linear', enableTools: ['@all'] }],
          }}
        />
      </SlotsProvider>,
    );

    expect(names()).toEqual(['GitHub', 'Slack', 'Linear']);
  });

  it('filters the tool list as the user types in Search Tools', () => {
    render(
      <SlotsProvider>
        <AgentMcpEditorContent
          spec={{
            model: { name: 'openai/gpt' },
            mcpServers: [{ id: 'parallel', name: 'parallel-web', enableTools: ['@all'] }],
          }}
          connectors={[{ id: 'parallel', name: 'parallel-web', authenticated: true }]}
          query=""
          activeConnectorId="parallel"
          tools={[
            { id: 'web_search', name: 'web_search', description: 'Perform web searches' },
            { id: 'web_fetch', name: 'web_fetch', description: 'Fetch web URLs' },
          ]}
          connectorLoading={false}
          connectorError={null}
          toolsLoading={false}
          toolsError={null}
          onQueryChange={vi.fn()}
          onSelectConnector={vi.fn()}
          onRetryTools={vi.fn()}
          onRefreshConnector={vi.fn()}
          onChange={vi.fn()}
        />
      </SlotsProvider>,
    );

    expect(screen.getByRole('menuitemcheckbox', { name: 'web_search' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemcheckbox', { name: 'web_fetch' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Preload tools' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search Tools'), { target: { value: 'fetch' } });

    expect(screen.queryByRole('menuitemcheckbox', { name: 'web_search' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitemcheckbox', { name: 'web_fetch' })).toBeInTheDocument();
  });

  it('does not match tools only via description text', () => {
    render(
      <SlotsProvider>
        <AgentMcpEditorContent
          spec={{ model: { name: 'openai/gpt' } }}
          connectors={[{ id: 'parallel', name: 'parallel-web', authenticated: true }]}
          query=""
          activeConnectorId="parallel"
          tools={[
            {
              id: 'web_search',
              name: 'web_search',
              description: 'Perform web searches without a follow-up fetch.',
            },
            { id: 'web_fetch', name: 'web_fetch', description: 'Fetch web URLs' },
          ]}
          connectorLoading={false}
          connectorError={null}
          toolsLoading={false}
          toolsError={null}
          onQueryChange={vi.fn()}
          onSelectConnector={vi.fn()}
          onRetryTools={vi.fn()}
          onRefreshConnector={vi.fn()}
          onChange={vi.fn()}
        />
      </SlotsProvider>,
    );

    fireEvent.change(screen.getByPlaceholderText('Search Tools'), { target: { value: 'fetch' } });

    expect(screen.queryByRole('menuitemcheckbox', { name: 'web_search' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitemcheckbox', { name: 'web_fetch' })).toBeInTheDocument();
  });
});
