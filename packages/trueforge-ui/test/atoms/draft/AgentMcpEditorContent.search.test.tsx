// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgentMcpEditorContent } from '@/atoms/draft/AgentMcpEditorContent.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';

describe('AgentMcpEditorContent tool search', () => {
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
          toolsLoading={false}
          toolsError={null}
          onQueryChange={vi.fn()}
          onSelectConnector={vi.fn()}
          onRetryTools={vi.fn()}
          onChange={vi.fn()}
        />
      </SlotsProvider>,
    );

    expect(screen.getByRole('menuitemcheckbox', { name: 'web_search' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemcheckbox', { name: 'web_fetch' })).toBeInTheDocument();

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
          toolsLoading={false}
          toolsError={null}
          onQueryChange={vi.fn()}
          onSelectConnector={vi.fn()}
          onRetryTools={vi.fn()}
          onChange={vi.fn()}
        />
      </SlotsProvider>,
    );

    fireEvent.change(screen.getByPlaceholderText('Search Tools'), { target: { value: 'fetch' } });

    expect(screen.queryByRole('menuitemcheckbox', { name: 'web_search' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitemcheckbox', { name: 'web_fetch' })).toBeInTheDocument();
  });
});
