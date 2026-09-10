// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgentMcpEditorContent } from '@/atoms/draft/AgentMcpEditorContent.js';
import type { McpToolSelection } from '@/server/types.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';

function tool(
  name: string,
  description: string,
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean },
): McpToolSelection {
  const row: McpToolSelection = { id: name, name, description };
  if (annotations !== undefined) Reflect.set(row, 'annotations', annotations);
  return row;
}

const sectionedTools = [
  tool('list_items', 'List items', { readOnlyHint: true, destructiveHint: false }),
  tool('get_item', 'Get one item', { readOnlyHint: true, destructiveHint: false }),
  tool('rename_item', 'Rename an item', { readOnlyHint: false, destructiveHint: false }),
  tool('delete_item', 'Delete an item', { readOnlyHint: false, destructiveHint: true }),
];

describe('AgentMcpEditorContent tool sections', () => {
  it('groups tools into Read-only, Other, and Destructive sections', () => {
    render(
      <SlotsProvider>
        <AgentMcpEditorContent
          spec={{ model: { name: 'openai/gpt' } }}
          connectors={[{ id: 'linear', name: 'Linear', authenticated: true }]}
          query=""
          activeConnectorId="linear"
          tools={sectionedTools}
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

    expect(screen.getByText('Read-only Actions')).toBeInTheDocument();
    expect(screen.getByText('Other Actions')).toBeInTheDocument();
    expect(screen.getByText('Destructive Actions')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Enable all read-only tools' })).toBeInTheDocument();
  });

  it('enables only read-only tools from the section toggle', () => {
    const onChange = vi.fn();
    render(
      <SlotsProvider>
        <AgentMcpEditorContent
          spec={{ model: { name: 'openai/gpt' } }}
          connectors={[{ id: 'linear', name: 'Linear', authenticated: true }]}
          query=""
          activeConnectorId="linear"
          tools={sectionedTools}
          connectorLoading={false}
          connectorError={null}
          toolsLoading={false}
          toolsError={null}
          onQueryChange={vi.fn()}
          onSelectConnector={vi.fn()}
          onRetryTools={vi.fn()}
          onChange={onChange}
        />
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('switch', { name: 'Enable all read-only tools' }));

    expect(onChange).toHaveBeenCalledWith({
      model: { name: 'openai/gpt' },
      mcpServers: [
        {
          id: 'linear',
          name: 'Linear',
          enableTools: ['list_items', 'get_item'],
        },
      ],
    });
  });

  it('clears only read-only tools when the section toggle is turned off', () => {
    const onChange = vi.fn();
    render(
      <SlotsProvider>
        <AgentMcpEditorContent
          spec={{
            model: { name: 'openai/gpt' },
            mcpServers: [
              {
                id: 'linear',
                name: 'Linear',
                enableTools: ['list_items', 'get_item', 'delete_item'],
              },
            ],
          }}
          connectors={[{ id: 'linear', name: 'Linear', authenticated: true }]}
          query=""
          activeConnectorId="linear"
          tools={sectionedTools}
          connectorLoading={false}
          connectorError={null}
          toolsLoading={false}
          toolsError={null}
          onQueryChange={vi.fn()}
          onSelectConnector={vi.fn()}
          onRetryTools={vi.fn()}
          onChange={onChange}
        />
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('switch', { name: 'Enable all read-only tools' }));

    expect(onChange).toHaveBeenCalledWith({
      model: { name: 'openai/gpt' },
      mcpServers: [
        {
          id: 'linear',
          name: 'Linear',
          enableTools: ['delete_item'],
        },
      ],
    });
  });

  it('hides empty sections while searching tools by name', () => {
    render(
      <SlotsProvider>
        <AgentMcpEditorContent
          spec={{ model: { name: 'openai/gpt' } }}
          connectors={[{ id: 'linear', name: 'Linear', authenticated: true }]}
          query=""
          activeConnectorId="linear"
          tools={sectionedTools}
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

    fireEvent.change(screen.getByPlaceholderText('Search Tools'), { target: { value: 'delete' } });

    expect(screen.queryByText('Read-only Actions')).not.toBeInTheDocument();
    expect(screen.queryByText('Other Actions')).not.toBeInTheDocument();
    expect(screen.getByText('Destructive Actions')).toBeInTheDocument();
    expect(screen.getByRole('menuitemcheckbox', { name: 'delete_item' })).toBeInTheDocument();
  });

  it('hides the Other Actions label when it is the only section', () => {
    render(
      <SlotsProvider>
        <AgentMcpEditorContent
          spec={{ model: { name: 'openai/gpt' } }}
          connectors={[{ id: 'linear', name: 'Linear', authenticated: true }]}
          query=""
          activeConnectorId="linear"
          tools={[
            tool('rename_item', 'Rename an item'),
            tool('tag_item', 'Tag an item', { readOnlyHint: false, destructiveHint: false }),
          ]}
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

    expect(screen.queryByText('Other Actions')).not.toBeInTheDocument();
    expect(screen.queryByText('Read-only Actions')).not.toBeInTheDocument();
    expect(screen.queryByText('Destructive Actions')).not.toBeInTheDocument();
    expect(screen.getByRole('menuitemcheckbox', { name: 'rename_item' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemcheckbox', { name: 'tag_item' })).toBeInTheDocument();
  });
});
