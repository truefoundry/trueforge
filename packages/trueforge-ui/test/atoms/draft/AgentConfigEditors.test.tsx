// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { AgentConfigEditors } from '@/atoms/draft/AgentConfigEditors.js';
import type { AgentSpec } from '@/server/types.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

describe('AgentConfigEditors', () => {
  it('renders model context metadata', () => {
    render(
      <SlotsProvider>
        <AgentConfigEditors
          editor="model"
          spec={{ model: { name: 'openai/gpt' } }}
          models={[
            {
              id: 'openai/gpt',
              name: 'openai/gpt',
              provider: { name: 'OpenAI' },
              properties: { contextLength: 128_000 },
            },
          ]}
          connectors={[]}
          skills={[]}
          loading={false}
          error={null}
          onChange={vi.fn()}
          onClose={vi.fn()}
        />
      </SlotsProvider>,
    );

    expect(screen.getByText('Context')).toBeInTheDocument();
  });

  it('uses toggles and sliders for model settings', () => {
    const spec: AgentSpec = { model: { name: 'openai/gpt' } };
    const onChange = vi.fn();
    render(
      <SlotsProvider>
        <AgentConfigEditors
          editor="model-settings"
          spec={spec}
          models={[
            {
              id: 'openai/gpt',
              name: 'openai/gpt',
              provider: { name: 'OpenAI' },
              properties: { maxOutputTokens: 8_192 },
            },
          ]}
          connectors={[]}
          skills={[]}
          loading={false}
          error={null}
          onChange={onChange}
          onClose={vi.fn()}
        />
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('switch', { name: 'Enable Maximum Tokens' }));
    expect(onChange).toHaveBeenCalledWith({
      ...spec,
      model: { ...spec.model, params: { maxTokens: 8192 } },
    });
    expect(screen.queryByRole('button', { name: 'JSON' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Enable Temperature' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Parallel tool calls' })).not.toBeInTheDocument();
  });

  it('explicitly clears a model parameter when its toggle is disabled', () => {
    const spec: AgentSpec = {
      model: {
        name: 'openai/gpt',
        params: { maxTokens: 4096, temperature: 0.4 },
      },
    };
    const onChange = vi.fn();
    render(
      <SlotsProvider>
        <AgentConfigEditors
          editor="model-settings"
          spec={spec}
          models={[
            {
              id: 'openai/gpt',
              name: 'openai/gpt',
              provider: { name: 'OpenAI' },
              properties: { maxOutputTokens: 8_192 },
            },
          ]}
          connectors={[]}
          skills={[]}
          loading={false}
          error={null}
          onChange={onChange}
          onClose={vi.fn()}
        />
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('switch', { name: 'Enable Maximum Tokens' }));
    expect(onChange).toHaveBeenCalledWith({
      ...spec,
      model: {
        ...spec.model,
        params: { maxTokens: undefined, temperature: 0.4 },
      },
    });
  });

  it('opens runtime configuration in a dedicated modal', () => {
    const spec: AgentSpec = { model: { name: 'openai/gpt' } };
    render(
      <SlotsProvider>
        <AgentConfigEditors
          editor="runtime"
          spec={spec}
          models={[]}
          connectors={[]}
          skills={[]}
          loading={false}
          error={null}
          sandboxAvailable
          onChange={vi.fn()}
          onClose={vi.fn()}
        />
      </SlotsProvider>,
    );

    expect(screen.getByRole('dialog', { name: 'Runtime Config' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Context compaction' })).toBeInTheDocument();
  });

  it('retains nested runtime values while their parent is disabled', () => {
    const spec: AgentSpec = {
      model: { name: 'openai/gpt' },
      config: {
        sandbox: { enabled: false, fileDownloads: false },
        contextManagement: {
          compaction: {
            enabled: false,
            trigger: { type: 'input_tokens', value: 42_000 },
          },
          largeToolResponse: { enabled: false },
        },
      },
    };
    const onChange = vi.fn();
    render(
      <SlotsProvider>
        <AgentConfigEditors
          editor="runtime"
          spec={spec}
          models={[]}
          connectors={[]}
          skills={[]}
          loading={false}
          error={null}
          sandboxAvailable
          onChange={onChange}
          onClose={vi.fn()}
        />
      </SlotsProvider>,
    );

    expect(screen.getByRole('switch', { name: 'File downloads' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'File downloads' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('spinbutton', { name: /Compaction threshold tokens/ })).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: /Compaction threshold tokens/ })).toHaveValue(42_000);

    fireEvent.click(screen.getByRole('switch', { name: 'Context compaction' }));
    expect(onChange).toHaveBeenCalledWith({
      ...spec,
      config: {
        ...spec.config,
        contextManagement: {
          compaction: {
            enabled: true,
            trigger: { type: 'input_tokens', value: 42_000 },
          },
          largeToolResponse: { enabled: false },
        },
      },
    });
  });

  it('selects the first mounted MCP on open, otherwise the first connector', async () => {
    const loadMcpTools = vi.fn(async (connectorId: string) => [
      { id: `${connectorId}.tool`, name: `${connectorId}.tool` },
    ]);

    const { rerender } = render(
      <SlotsProvider>
        <AgentConfigEditors
          editor="mcp"
          spec={{
            model: { name: 'openai/gpt' },
            mcpServers: [
              { id: 'slack', name: 'Slack', enableTools: ['@all'] },
              { id: 'github', name: 'GitHub', enableTools: ['@all'] },
            ],
          }}
          models={[]}
          connectors={[
            { id: 'github', name: 'GitHub', authenticated: true },
            { id: 'slack', name: 'Slack', authenticated: true },
            { id: 'linear', name: 'Linear', authenticated: true },
          ]}
          skills={[]}
          loading={false}
          error={null}
          loadMcpTools={loadMcpTools}
          onChange={vi.fn()}
          onClose={vi.fn()}
        />
      </SlotsProvider>,
    );

    await waitFor(() => expect(loadMcpTools).toHaveBeenCalledWith('slack'));
    expect(screen.getByRole('button', { name: 'Slack' })).toHaveAttribute('aria-current', 'true');

    rerender(
      <SlotsProvider>
        <AgentConfigEditors
          editor="mcp"
          spec={{ model: { name: 'openai/gpt' } }}
          models={[]}
          connectors={[
            { id: 'github', name: 'GitHub', authenticated: true },
            { id: 'slack', name: 'Slack', authenticated: true },
          ]}
          skills={[]}
          loading={false}
          error={null}
          loadMcpTools={loadMcpTools}
          onChange={vi.fn()}
          onClose={vi.fn()}
        />
      </SlotsProvider>,
    );

    await waitFor(() => expect(loadMcpTools).toHaveBeenLastCalledWith('github'));
    expect(screen.getByRole('button', { name: 'GitHub' })).toHaveAttribute('aria-current', 'true');
  });

  it('loads MCP tools lazily and preserves unrelated mount selectors', async () => {
    const spec: AgentSpec = {
      model: { name: 'openai/gpt' },
      mcpServers: [
        {
          id: 'github',
          name: 'GitHub',
          enableTools: ['@all'],
          requireApprovalForTools: ['@write'],
        },
      ],
    };
    const onChange = vi.fn();
    const loadMcpTools = vi.fn(async () => [
      { id: 'issues.list', name: 'issues.list', description: 'List issues' },
      { id: 'pulls.list', name: 'pulls.list', description: 'List pull requests' },
    ]);

    render(
      <SlotsProvider>
        <AgentConfigEditors
          editor="mcp"
          spec={spec}
          models={[]}
          connectors={[{ id: 'github', name: 'GitHub', authenticated: true }]}
          skills={[]}
          loading={false}
          error={null}
          loadMcpTools={loadMcpTools}
          onChange={onChange}
          onClose={vi.fn()}
        />
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'GitHub' }));
    await waitFor(() => expect(loadMcpTools).toHaveBeenCalledWith('github'));
    const issueRows = await screen.findAllByRole('menuitemcheckbox', { name: /issues.list/ });
    const availableIssueRow = issueRows[0];
    if (availableIssueRow === undefined) throw new Error('expected available issue tool row');
    fireEvent.click(availableIssueRow);

    expect(onChange).toHaveBeenLastCalledWith({
      ...spec,
      mcpServers: [
        {
          id: 'github',
          name: 'GitHub',
          enableTools: ['pulls.list'],
          requireApprovalForTools: ['@write'],
        },
      ],
    });
  });

  it('opens MCP rows without selecting them and selects through tools', async () => {
    const spec: AgentSpec = { model: { name: 'openai/gpt' } };
    const onChange = vi.fn();
    const loadMcpTools = vi.fn(async () => [
      { id: 'messages.list', name: 'messages.list', description: 'List messages' },
    ]);

    render(
      <SlotsProvider>
        <AgentConfigEditors
          editor="mcp"
          spec={spec}
          models={[]}
          connectors={[{ id: 'slack', name: 'Slack', authenticated: true }]}
          skills={[]}
          loading={false}
          error={null}
          loadMcpTools={loadMcpTools}
          onChange={onChange}
          onClose={vi.fn()}
        />
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Slack' }));
    await waitFor(() => expect(loadMcpTools).toHaveBeenCalledWith('slack'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Slack selected')).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: /messages.list/ }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...spec,
      mcpServers: [{ id: 'slack', name: 'Slack', enableTools: ['messages.list'] }],
    });
  });

  it('shows connect empty state for unauthenticated connectors', async () => {
    const spec: AgentSpec = { model: { name: 'openai/gpt' } };
    const onChange = vi.fn();

    render(
      <SlotsProvider>
        <AgentConfigEditors
          editor="mcp"
          spec={spec}
          models={[]}
          connectors={[{ id: 'private', name: 'Private', authenticated: false }]}
          skills={[]}
          loading={false}
          error={null}
          loadMcpTools={async () => [{ id: 'secret.read', name: 'secret.read' }]}
          onChange={onChange}
          onClose={vi.fn()}
        />
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Private' }));

    expect(await screen.findByText("You're not connected to this MCP Server")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect During Chat' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitemcheckbox', { name: /secret.read/ })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('mounts an unauthenticated connector with Connect During Chat', async () => {
    const spec: AgentSpec = { model: { name: 'openai/gpt' } };
    const onChange = vi.fn();

    render(
      <SlotsProvider>
        <AgentConfigEditors
          editor="mcp"
          spec={spec}
          models={[]}
          connectors={[{ id: 'slack', name: 'Slack', authenticated: false }]}
          skills={[]}
          loading={false}
          error={null}
          onChange={onChange}
          onClose={vi.fn()}
        />
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Slack' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Connect During Chat' }));

    expect(onChange).toHaveBeenCalledWith({
      ...spec,
      mcpServers: [{ id: 'slack', name: 'Slack', enableTools: ['@all'] }],
    });
  });

  it('groups selected tools across MCP servers and summarizes all-tools mounts', () => {
    const spec: AgentSpec = {
      model: { name: 'openai/gpt' },
      mcpServers: [
        { id: 'github', name: 'GitHub', enableTools: ['@all'] },
        { id: 'slack', name: 'Slack', enableTools: ['messages.list'] },
      ],
    };

    render(
      <SlotsProvider>
        <AgentConfigEditors
          editor="mcp"
          spec={spec}
          models={[]}
          connectors={[
            { id: 'github', name: 'GitHub', authenticated: true },
            { id: 'slack', name: 'Slack', authenticated: true },
          ]}
          skills={[]}
          loading={false}
          error={null}
          loadMcpTools={async () => []}
          onChange={vi.fn()}
          onClose={vi.fn()}
        />
      </SlotsProvider>,
    );

    expect(screen.getByRole('dialog', { name: 'Select MCP Tools' })).toBeInTheDocument();
    expect(screen.getByText('Selected Tools (1)')).toBeInTheDocument();
    expect(screen.getByText('ALL TOOLS ENABLED')).toBeInTheDocument();
    expect(screen.getByLabelText('GitHub selected')).toBeInTheDocument();
    expect(screen.getByLabelText('Slack selected')).toBeInTheDocument();
    expect(screen.getAllByText('messages.list').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Remove messages.list/ })).not.toBeInTheDocument();
  });

  it('removes all tools for an MCP from the selected-tools list', () => {
    const spec: AgentSpec = {
      model: { name: 'openai/gpt' },
      mcpServers: [
        { id: 'github', name: 'GitHub', enableTools: ['@all'] },
        { id: 'slack', name: 'Slack', enableTools: ['messages.list'] },
      ],
    };
    const onChange = vi.fn();

    render(
      <SlotsProvider>
        <AgentConfigEditors
          editor="mcp"
          spec={spec}
          models={[]}
          connectors={[
            { id: 'github', name: 'GitHub', authenticated: true },
            { id: 'slack', name: 'Slack', authenticated: true },
          ]}
          skills={[]}
          loading={false}
          error={null}
          onChange={onChange}
          onClose={vi.fn()}
        />
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove all tools for Slack' }));
    expect(onChange).toHaveBeenCalledWith({
      ...spec,
      mcpServers: [{ id: 'github', name: 'GitHub', enableTools: ['@all'] }],
    });
  });

  it('opens the MCP for a selected-tools row click', async () => {
    const loadMcpTools = vi.fn(async (connectorId: string) => [
      { id: `${connectorId}.tool`, name: `${connectorId}.tool` },
    ]);

    render(
      <SlotsProvider>
        <AgentConfigEditors
          editor="mcp"
          spec={{
            model: { name: 'openai/gpt' },
            mcpServers: [
              { id: 'github', name: 'GitHub', enableTools: ['@all'] },
              { id: 'slack', name: 'Slack', enableTools: ['messages.list'] },
            ],
          }}
          models={[]}
          connectors={[
            { id: 'github', name: 'GitHub', authenticated: true },
            { id: 'slack', name: 'Slack', authenticated: true },
          ]}
          skills={[]}
          loading={false}
          error={null}
          loadMcpTools={loadMcpTools}
          onChange={vi.fn()}
          onClose={vi.fn()}
        />
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open Slack for messages.list' }));
    await waitFor(() => expect(loadMcpTools).toHaveBeenCalledWith('slack'));
    expect(screen.getByRole('button', { name: 'Slack' })).toHaveAttribute('aria-current', 'true');
  });

  it('shows Selected Tools (All) when every mount enables all tools', () => {
    const spec: AgentSpec = {
      model: { name: 'openai/gpt' },
      mcpServers: [
        { id: 'github', name: 'GitHub', enableTools: ['@all'] },
        { id: 'slack', name: 'Slack', enableTools: ['@all'] },
      ],
    };

    render(
      <SlotsProvider>
        <AgentConfigEditors
          editor="mcp"
          spec={spec}
          models={[]}
          connectors={[
            { id: 'github', name: 'GitHub', authenticated: true },
            { id: 'slack', name: 'Slack', authenticated: true },
          ]}
          skills={[]}
          loading={false}
          error={null}
          onChange={vi.fn()}
          onClose={vi.fn()}
        />
      </SlotsProvider>,
    );

    expect(screen.getByText('Selected Tools (All)')).toBeInTheDocument();
  });

  it('closes via Save without writing the spec again', () => {
    const onChange = vi.fn();
    const onClose = vi.fn();

    render(
      <SlotsProvider>
        <AgentConfigEditors
          editor="mcp"
          spec={{ model: { name: 'openai/gpt' } }}
          models={[]}
          connectors={[{ id: 'github', name: 'GitHub', authenticated: true }]}
          skills={[]}
          loading={false}
          error={null}
          onChange={onChange}
          onClose={onClose}
        />
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClose).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('deselects an MCP server when all of its tools are disabled', () => {
    const spec: AgentSpec = {
      model: { name: 'openai/gpt' },
      mcpServers: [{ id: 'github', name: 'GitHub', enableTools: ['@all'] }],
    };
    const onChange = vi.fn();

    render(
      <SlotsProvider>
        <AgentConfigEditors
          editor="mcp"
          spec={spec}
          models={[]}
          connectors={[{ id: 'github', name: 'GitHub', authenticated: true }]}
          skills={[]}
          loading={false}
          error={null}
          onChange={onChange}
          onClose={vi.fn()}
        />
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('switch', { name: 'Enable all tools' }));
    expect(onChange).toHaveBeenCalledWith({ ...spec, mcpServers: [] });
  });

  it('keeps the opened MCP independent from connector selection', async () => {
    const githubSpec: AgentSpec = {
      model: { name: 'openai/gpt' },
      mcpServers: [{ id: 'github', name: 'GitHub' }],
    };
    const slackSpec: AgentSpec = {
      model: { name: 'openai/gpt' },
      mcpServers: [{ id: 'slack', name: 'Slack' }],
    };
    const loadMcpTools = vi.fn(async () => [{ id: 'issues.list', name: 'issues.list', description: 'List issues' }]);
    const renderEditors = (spec: AgentSpec) => (
      <SlotsProvider>
        <AgentConfigEditors
          editor="mcp"
          spec={spec}
          models={[]}
          connectors={[
            { id: 'github', name: 'GitHub', authenticated: true },
            { id: 'slack', name: 'Slack', authenticated: true },
          ]}
          skills={[]}
          loading={false}
          error={null}
          loadMcpTools={loadMcpTools}
          onChange={vi.fn()}
          onClose={vi.fn()}
        />
      </SlotsProvider>
    );
    const rendered = render(renderEditors(githubSpec));

    expect((await screen.findAllByRole('menuitemcheckbox', { name: /issues.list/ })).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'GitHub' }));
    await waitFor(() => expect(loadMcpTools).toHaveBeenLastCalledWith('github'));
    rendered.rerender(renderEditors(slackSpec));

    expect(loadMcpTools).toHaveBeenLastCalledWith('github');
    expect(screen.getAllByRole('menuitemcheckbox', { name: /issues.list/ }).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Slack selected')).toBeInTheDocument();
  });

  it('enables sandbox when a skill is added', () => {
    const spec: AgentSpec = { model: { name: 'openai/gpt' } };
    const onChange = vi.fn();

    render(
      <SlotsProvider>
        <AgentConfigEditors
          editor="skills"
          spec={spec}
          models={[]}
          connectors={[]}
          skills={[{ id: 'research', name: 'Research' }]}
          loading={false}
          error={null}
          onChange={onChange}
          onClose={vi.fn()}
        />
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Research/ }));
    expect(onChange).toHaveBeenCalledWith({
      ...spec,
      skills: [{ id: 'research', name: 'Research' }],
      config: { sandbox: { enabled: true } },
    });
  });
});
