// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgentMcpEditorContent } from '@/atoms/draft/AgentMcpEditorContent.js';
import type { AgentSpec, McpToolSelection } from '@/server/types.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';

function tool(name: string, annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }): McpToolSelection {
  const row: McpToolSelection = { id: name, name, description: name };
  if (annotations !== undefined) Reflect.set(row, 'annotations', annotations);
  return row;
}

const tools = [
  tool('list_items', { readOnlyHint: true, destructiveHint: false }),
  tool('rename_item', { readOnlyHint: false, destructiveHint: false }),
  tool('delete_item', { readOnlyHint: false, destructiveHint: true }),
];

function renderEditor({
  spec,
  onChange,
  serverTools = tools,
}: {
  spec: AgentSpec;
  onChange: (next: AgentSpec) => void;
  serverTools?: McpToolSelection[];
}) {
  return render(
    <SlotsProvider>
      <AgentMcpEditorContent
        spec={spec}
        connectors={[{ id: 'linear', name: 'Linear', authenticated: true }]}
        query=""
        activeConnectorId="linear"
        tools={serverTools}
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
}

const mountedSpec: AgentSpec = {
  model: { name: 'openai/gpt' },
  mcpServers: [{ id: 'linear', name: 'Linear', enableTools: ['@all'] }],
};

describe('AgentMcpEditorContent tool approvals', () => {
  it('marks write and destructive tools as approval-gated by default', () => {
    renderEditor({ spec: mountedSpec, onChange: vi.fn() });

    expect(screen.getByRole('button', { name: 'Require approval for rename_item' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Require approval for delete_item' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Require approval for list_items' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('gates a read-only tool the harness would otherwise auto-run', () => {
    const onChange = vi.fn();
    renderEditor({
      spec: {
        model: { name: 'openai/gpt' },
        mcpServers: [{ id: 'linear', name: 'Linear', enableTools: ['@all'], requireApprovalForTools: [] }],
      },
      onChange,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Require approval for list_items' }));

    expect(onChange).toHaveBeenCalledWith({
      model: { name: 'openai/gpt' },
      mcpServers: [{ id: 'linear', name: 'Linear', enableTools: ['@all'], requireApprovalForTools: ['list_items'] }],
    });
  });

  it('collapses to @all once every tool is gated', () => {
    const onChange = vi.fn();
    renderEditor({ spec: mountedSpec, onChange });

    fireEvent.click(screen.getByRole('button', { name: 'Require approval for list_items' }));

    expect(onChange).toHaveBeenCalledWith({
      model: { name: 'openai/gpt' },
      mcpServers: [{ id: 'linear', name: 'Linear', enableTools: ['@all'], requireApprovalForTools: ['@all'] }],
    });
  });

  it('expands the class tag into names when a gated tool is set to auto-run', () => {
    const onChange = vi.fn();
    renderEditor({ spec: mountedSpec, onChange });

    fireEvent.click(screen.getByRole('button', { name: 'Require approval for delete_item' }));

    expect(onChange).toHaveBeenCalledWith({
      model: { name: 'openai/gpt' },
      mcpServers: [{ id: 'linear', name: 'Linear', enableTools: ['@all'], requireApprovalForTools: ['@write'] }],
    });
  });

  it('drops the field when the selection returns to the harness default', () => {
    const onChange = vi.fn();
    renderEditor({
      spec: {
        model: { name: 'openai/gpt' },
        mcpServers: [{ id: 'linear', name: 'Linear', enableTools: ['@all'], requireApprovalForTools: ['@write'] }],
      },
      onChange,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Require approval for delete_item' }));

    expect(onChange).toHaveBeenCalledWith({
      model: { name: 'openai/gpt' },
      mcpServers: [{ id: 'linear', name: 'Linear', enableTools: ['@all'] }],
    });
  });

  it('gates every destructive tool from the section toggle', () => {
    const onChange = vi.fn();
    renderEditor({
      spec: {
        model: { name: 'openai/gpt' },
        mcpServers: [{ id: 'linear', name: 'Linear', enableTools: ['@all'], requireApprovalForTools: [] }],
      },
      onChange,
    });

    fireEvent.click(screen.getByRole('switch', { name: 'Require approval for all destructive tools' }));

    expect(onChange).toHaveBeenCalledWith({
      model: { name: 'openai/gpt' },
      mcpServers: [{ id: 'linear', name: 'Linear', enableTools: ['@all'], requireApprovalForTools: ['@destructive'] }],
    });
  });

  it('starts the destructive section toggle on and clears approval when switched off', () => {
    const onChange = vi.fn();
    renderEditor({ spec: mountedSpec, onChange });
    const toggle = screen.getByRole('switch', { name: 'Require approval for all destructive tools' });

    expect(toggle).toBeChecked();
    fireEvent.click(toggle);

    expect(onChange).toHaveBeenCalledWith({
      model: { name: 'openai/gpt' },
      mcpServers: [{ id: 'linear', name: 'Linear', enableTools: ['@all'], requireApprovalForTools: ['@write'] }],
    });
  });

  it('offers the section toggle only for destructive tools', () => {
    renderEditor({ spec: mountedSpec, onChange: vi.fn() });

    expect(screen.getByRole('switch', { name: 'Require approval for all destructive tools' })).toBeInTheDocument();
    expect(screen.getAllByText('Approval required')).toHaveLength(1);
  });

  it('hides approval controls for tools that are not enabled', () => {
    renderEditor({
      spec: {
        model: { name: 'openai/gpt' },
        mcpServers: [{ id: 'linear', name: 'Linear', enableTools: ['delete_item'] }],
      },
      onChange: vi.fn(),
    });

    expect(screen.getByRole('button', { name: 'Require approval for delete_item' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Require approval for rename_item' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Require approval for list_items' })).not.toBeInTheDocument();
  });

  it('hides the destructive toggle when no destructive tool is enabled', () => {
    renderEditor({
      spec: {
        model: { name: 'openai/gpt' },
        mcpServers: [{ id: 'linear', name: 'Linear', enableTools: ['rename_item'] }],
      },
      onChange: vi.fn(),
    });

    expect(
      screen.queryByRole('switch', { name: 'Require approval for all destructive tools' }),
    ).not.toBeInTheDocument();
  });

  it('shows no approval controls until the server is added', () => {
    renderEditor({ spec: { model: { name: 'openai/gpt' } }, onChange: vi.fn() });

    expect(screen.queryByRole('button', { name: /^Require approval for/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /^Require approval for/ })).not.toBeInTheDocument();
  });

  it('gates only the enabled destructive tools', () => {
    const onChange = vi.fn();
    renderEditor({
      spec: {
        model: { name: 'openai/gpt' },
        mcpServers: [{ id: 'linear', name: 'Linear', enableTools: ['delete_item'], requireApprovalForTools: [] }],
      },
      onChange,
      serverTools: [...tools, tool('purge_items', { readOnlyHint: false, destructiveHint: true })],
    });

    fireEvent.click(screen.getByRole('switch', { name: 'Require approval for all destructive tools' }));

    expect(onChange).toHaveBeenCalledWith({
      model: { name: 'openai/gpt' },
      mcpServers: [
        { id: 'linear', name: 'Linear', enableTools: ['delete_item'], requireApprovalForTools: ['delete_item'] },
      ],
    });
  });

  it('summarizes how many selected tools need approval', () => {
    renderEditor({
      spec: {
        model: { name: 'openai/gpt' },
        mcpServers: [{ id: 'linear', name: 'Linear', enableTools: ['list_items', 'rename_item', 'delete_item'] }],
      },
      onChange: vi.fn(),
    });

    expect(screen.getByText('Selected Tools (3)')).toBeInTheDocument();
    expect(screen.getByText('3 selected · 2 need approval')).toBeInTheDocument();
    expect(screen.getAllByText('approval')).toHaveLength(2);
  });

  it('enables every tool in a section from its Enable all switch', () => {
    const onChange = vi.fn();
    renderEditor({ spec: { model: { name: 'openai/gpt' } }, onChange });

    fireEvent.click(screen.getByRole('switch', { name: 'Enable all destructive tools' }));

    expect(onChange).toHaveBeenCalledWith({
      model: { name: 'openai/gpt' },
      mcpServers: [{ id: 'linear', name: 'Linear', enableTools: ['delete_item'] }],
    });
  });
});
