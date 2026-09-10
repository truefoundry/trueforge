// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { AgentConfigEditors } from '@/atoms/draft/AgentConfigEditors.js';
import { AgentModelSettingsContent } from '@/atoms/draft/AgentModelSettingsContent.js';
import { withInitialUserMessages } from '@/atoms/draft/agentConfigMessages.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { AgentSkill, AgentSpec, ConnectorState } from '@/server/types.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { createMockAgentUIServer, createMockCatalog } from '../../server/mockServer.js';

vi.mock('@/atoms/MonacoEditorCore.js', () => ({
  MonacoEditorCore: ({ value, onChange }: { value: string; onChange?: (value: string) => void }) => (
    <textarea aria-label="JSON parameters editor" value={value} onChange={event => onChange?.(event.target.value)} />
  ),
}));

const oauthMock = vi.hoisted(() => ({
  handleAuthorize: vi.fn(),
  isOAuthLoading: false,
}));

vi.mock('@/hooks/useMcpAuth.js', () => ({
  useMCPAuth: () => oauthMock,
}));

function deferred<T>() {
  let settle: ((value: T) => void) | undefined;
  return {
    promise: new Promise<T>(resolve => {
      settle = resolve;
    }),
    resolve(value: T) {
      settle?.(value);
    },
  };
}

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
  it('edits instructions and initial user messages in a drawer', () => {
    const baseSpec: AgentSpec = { model: { name: 'openai/gpt' } };
    const spec = withInitialUserMessages({
      spec: baseSpec,
      messages: [{ type: 'user.message', content: 'Existing message' }],
    });
    const onInstructionsSave = vi.fn();
    const onChange = vi.fn();

    render(
      <SlotsProvider>
        <AgentConfigEditors
          editor="instructions"
          spec={spec}
          models={[]}
          connectors={[]}
          skills={[]}
          loading={false}
          error={null}
          instructions="Existing instructions"
          onInstructionsSave={onInstructionsSave}
          onChange={onChange}
          onClose={vi.fn()}
        />
      </SlotsProvider>,
    );

    expect(screen.getByRole('dialog', { name: 'Instructions' })).toBeInTheDocument();
    expect(screen.getByLabelText('Agent instructions')).toHaveClass('min-h-64');

    fireEvent.change(screen.getByLabelText('Agent instructions'), {
      target: { value: 'Updated instructions' },
    });
    expect(onInstructionsSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Add User Message' }));
    fireEvent.change(screen.getByLabelText('User Message 2'), {
      target: { value: 'New message' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove User Message 1' }));

    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onInstructionsSave).toHaveBeenCalledWith({
      instructions: 'Updated instructions',
      messages: [{ type: 'user.message', content: 'New message' }],
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not persist blank initial user messages', () => {
    const spec: AgentSpec = { model: { name: 'openai/gpt' } };
    const onChange = vi.fn();

    render(
      <SlotsProvider>
        <AgentConfigEditors
          editor="instructions"
          spec={spec}
          models={[]}
          connectors={[]}
          skills={[]}
          loading={false}
          error={null}
          onChange={onChange}
          onClose={vi.fn()}
        />
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add User Message' }));
    fireEvent.change(screen.getByLabelText('User Message 1'), { target: { value: '   ' } });

    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onChange).toHaveBeenCalledWith(withInitialUserMessages({ spec, messages: [] }));
  });

  it('discards instruction changes when the drawer closes without saving', () => {
    const spec: AgentSpec = { model: { name: 'openai/gpt' }, instructions: 'Original' };
    const onInstructionsSave = vi.fn();
    const onChange = vi.fn();
    const onClose = vi.fn();

    render(
      <SlotsProvider>
        <AgentConfigEditors
          editor="instructions"
          spec={spec}
          models={[]}
          connectors={[]}
          skills={[]}
          loading={false}
          error={null}
          onInstructionsSave={onInstructionsSave}
          onChange={onChange}
          onClose={onClose}
        />
      </SlotsProvider>,
    );

    fireEvent.change(screen.getByLabelText('Agent instructions'), { target: { value: 'Discarded' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onInstructionsSave).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

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

  it('uses On and Off controls with sliders for model settings', () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Turn Maximum Tokens on' }));
    expect(onChange).toHaveBeenCalledWith({
      ...spec,
      model: { ...spec.model, params: { maxTokens: 8192 } },
    });
    expect(screen.getByRole('button', { name: 'JSON' })).toBeInTheDocument();
    expect(screen.queryByText('Temperature')).not.toBeInTheDocument();
    expect(screen.queryByText('Parallel tool calls')).not.toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: 'Turn Maximum Tokens off' }));
    expect(onChange).toHaveBeenCalledWith({
      ...spec,
      model: {
        ...spec.model,
        params: { maxTokens: undefined, temperature: 0.4 },
      },
    });
  });

  it('edits the complete parameter object in JSON view and rejects invalid JSON', () => {
    const spec: AgentSpec = {
      model: {
        name: 'openai/gpt',
        params: { maxTokens: 4096 },
      },
    };
    const expectedParams = { maxTokens: 2048, vendor_option: { mode: 'fast' } };
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

    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    const editor = screen.getByRole('textbox', { name: 'JSON parameters editor' });
    expect(editor.closest('.aui-code-editor')).toHaveClass('h-80');
    fireEvent.change(editor, {
      target: { value: '{"maxTokens":2048,"vendor_option":{"mode":"fast"}}' },
    });

    expect(onChange).toHaveBeenLastCalledWith({
      ...spec,
      model: {
        ...spec.model,
        params: expectedParams,
      },
    });

    onChange.mockClear();
    fireEvent.change(editor, { target: { value: '{"maxTokens":' } });
    expect(screen.getByText('Invalid JSON.')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('adds typed custom parameters without replacing dedicated controls', () => {
    const spec: AgentSpec = {
      model: {
        name: 'openai/gpt',
        params: { maxTokens: 4096 },
      },
    };
    const expectedParams = { maxTokens: 4096, vendor_option: 42 };
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

    fireEvent.click(screen.getByRole('button', { name: 'Turn Custom Parameters on' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Custom parameter name' }), {
      target: { value: 'vendor_option' },
    });

    const typeSelect = screen.getByRole('button', { name: 'Type for vendor_option' });
    fireEvent.click(typeSelect);
    expect(screen.getByRole('menuitem', { name: 'String' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Number' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'JSON' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Number' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Value for vendor_option' }), {
      target: { value: '42' },
    });

    expect(onChange).toHaveBeenLastCalledWith({
      ...spec,
      model: {
        ...spec.model,
        params: expectedParams,
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Type for vendor_option' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'JSON' }));
    expect(screen.getByRole('textbox', { name: 'JSON parameters editor' }).closest('.aui-code-editor')).toHaveClass(
      'h-32',
    );
    expect(screen.getByRole('button', { name: 'Add parameter' })).toBeInTheDocument();
  });

  it('preserves prototype-named custom parameters as own properties', () => {
    const onChange = vi.fn();
    const params = Object.fromEntries([['__proto__', 'initial']]);
    render(
      <SlotsProvider>
        <AgentModelSettingsContent spec={{ model: { name: 'openai/gpt', params } }} onChange={onChange} />
      </SlotsProvider>,
    );

    expect(screen.getByRole('textbox', { name: 'Custom parameter name' })).toHaveValue('__proto__');
    fireEvent.change(screen.getByRole('textbox', { name: 'Value for __proto__' }), {
      target: { value: 'updated' },
    });

    const changedParams = onChange.mock.lastCall?.[0].model.params;
    expect(Object.hasOwn(changedParams ?? {}, '__proto__')).toBe(true);
    expect(changedParams?.['__proto__']).toBe('updated');
  });

  it('opens runtime configuration in a right-side drawer', () => {
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

    expect(screen.getByRole('dialog', { name: 'Runtime Config' })).toHaveClass('md:ml-auto', 'md:mr-0', 'md:h-dvh');
    expect(screen.getByRole('switch', { name: 'Context compaction' })).toBeInTheDocument();
  });

  it('changes runtime switches only when the switch is clicked', () => {
    const onChange = vi.fn();
    render(
      <SlotsProvider>
        <AgentConfigEditors
          editor="runtime"
          spec={{ model: { name: 'openai/gpt' } }}
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

    fireEvent.click(screen.getByText('Context compaction'));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('switch', { name: 'Context compaction' }));
    expect(onChange).toHaveBeenCalledOnce();
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

  it('shows the API error message when loading MCP tools fails', async () => {
    const error = Object.assign(new Error('BadGatewayError Status code: 502 Body: <html>…</html>'), {
      statusCode: 502,
      body: { error: { message: 'Failed to connect to remote MCP server' } },
    });

    render(
      <SlotsProvider>
        <AgentConfigEditors
          editor="mcp"
          spec={{ model: { name: 'openai/gpt' } }}
          models={[]}
          connectors={[{ id: 'broken', name: 'Broken MCP', authenticated: true }]}
          skills={[]}
          loading={false}
          error={null}
          loadMcpTools={async () => Promise.reject(error)}
          onChange={vi.fn()}
          onClose={vi.fn()}
        />
      </SlotsProvider>,
    );

    expect(await screen.findByText('Failed to connect to remote MCP server')).toBeInTheDocument();
    expect(screen.queryByText(/BadGatewayError/)).not.toBeInTheDocument();
  });

  it('keeps an off-page selected MCP active via catalog stubs', async () => {
    const loadMcpTools = vi.fn(async (connectorId: string) => [
      { id: `${connectorId}.tool`, name: `${connectorId}.tool` },
    ]);

    render(
      <SlotsProvider>
        <AgentConfigEditors
          editor="mcp"
          spec={{
            model: { name: 'openai/gpt' },
            mcpServers: [{ id: 'off-page', name: 'Off Page', enableTools: ['@all'] }],
          }}
          models={[]}
          connectors={[{ id: 'github', name: 'GitHub', authenticated: true }]}
          skills={[]}
          loading={false}
          error={null}
          loadMcpTools={loadMcpTools}
          onChange={vi.fn()}
          onClose={vi.fn()}
        />
      </SlotsProvider>,
    );

    await waitFor(() => expect(loadMcpTools).toHaveBeenCalledWith('off-page'));
    expect(screen.getByRole('button', { name: 'Off Page' })).toHaveAttribute('aria-current', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Off Page' }));
    await waitFor(() => expect(loadMcpTools).toHaveBeenCalledTimes(1));
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

  it('loads tools after the connector list marks the selection authenticated', async () => {
    const loadMcpTools = vi.fn(async () => [{ id: 'secret.read', name: 'secret.read' }]);
    const props = {
      editor: 'mcp' as const,
      spec: { model: { name: 'openai/gpt' } } satisfies AgentSpec,
      models: [],
      skills: [],
      loading: false,
      error: null,
      loadMcpTools,
      onChange: vi.fn(),
      onClose: vi.fn(),
    };

    const { rerender } = render(
      <SlotsProvider>
        <AgentConfigEditors {...props} connectors={[{ id: 'private', name: 'Private', authenticated: false }]} />
      </SlotsProvider>,
    );

    expect(await screen.findByText("You're not connected to this MCP Server")).toBeInTheDocument();
    expect(loadMcpTools).not.toHaveBeenCalled();

    rerender(
      <SlotsProvider>
        <AgentConfigEditors {...props} connectors={[{ id: 'private', name: 'Private', authenticated: true }]} />
      </SlotsProvider>,
    );

    expect(await screen.findByRole('menuitemcheckbox', { name: 'secret.read' })).toBeInTheDocument();
    expect(loadMcpTools).toHaveBeenCalledWith('private');
  });

  it('loads tools after Connect Now when only connector list refresh is available', async () => {
    oauthMock.handleAuthorize.mockImplementation(async (_id: string, callback: (isSuccess: boolean) => void) => {
      callback(true);
    });
    const loadMcpTools = vi.fn(async () => [{ id: 'secret.read', name: 'secret.read' }]);

    function Harness() {
      const [connectors, setConnectors] = useState<ConnectorState[]>([
        { id: 'private', name: 'Private', authenticated: false },
      ]);
      return (
        <SlotsProvider>
          <AgentConfigEditors
            editor="mcp"
            spec={{ model: { name: 'openai/gpt' } }}
            models={[]}
            connectors={connectors}
            skills={[]}
            loading={false}
            error={null}
            loadMcpTools={loadMcpTools}
            onRefreshConnectors={async () => {
              setConnectors([{ id: 'private', name: 'Private', authenticated: true }]);
            }}
            onChange={vi.fn()}
            onClose={vi.fn()}
          />
        </SlotsProvider>
      );
    }

    render(<Harness />);

    expect(await screen.findByText("You're not connected to this MCP Server")).toBeInTheDocument();
    expect(loadMcpTools).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Connect Now' }));

    expect(await screen.findByRole('menuitemcheckbox', { name: 'secret.read' })).toBeInTheDocument();
    expect(loadMcpTools).toHaveBeenCalledWith('private');
  });

  it('checks live auth before loading tools and overrides stale listing auth', async () => {
    const calls: string[] = [];
    const loadMcpConnector = vi.fn(async () => {
      calls.push('detail');
      return { id: 'private', name: 'Private', authenticated: true };
    });
    const loadMcpTools = vi.fn(async () => {
      calls.push('tools');
      return [{ id: 'secret.read', name: 'secret.read' }];
    });

    render(
      <SlotsProvider>
        <AgentConfigEditors
          editor="mcp"
          spec={{ model: { name: 'openai/gpt' } }}
          models={[]}
          connectors={[{ id: 'private', name: 'Private', authenticated: false }]}
          skills={[]}
          loading={false}
          error={null}
          loadMcpConnector={loadMcpConnector}
          loadMcpTools={loadMcpTools}
          onChange={vi.fn()}
          onClose={vi.fn()}
        />
      </SlotsProvider>,
    );

    expect(await screen.findByRole('menuitemcheckbox', { name: 'secret.read' })).toBeInTheDocument();
    expect(calls).toEqual(['detail', 'tools']);
  });

  it('does not load tools when the live detail requires auth', async () => {
    const loadMcpTools = vi.fn(async () => [{ id: 'secret.read', name: 'secret.read' }]);

    render(
      <ServerProvider server={createMockAgentUIServer({ catalog: createMockCatalog() })}>
        <SlotsProvider>
          <AgentConfigEditors
            editor="mcp"
            spec={{ model: { name: 'openai/gpt' } }}
            models={[]}
            connectors={[{ id: 'private', name: 'Private', authenticated: true }]}
            skills={[]}
            loading={false}
            error={null}
            loadMcpConnector={async () => ({ id: 'private', name: 'Private', authenticated: false })}
            loadMcpTools={loadMcpTools}
            onChange={vi.fn()}
            onClose={vi.fn()}
          />
        </SlotsProvider>
      </ServerProvider>,
    );

    expect(await screen.findByText("You're not connected to this MCP Server")).toBeInTheDocument();
    expect(loadMcpTools).not.toHaveBeenCalled();
  });

  it('retries the selected MCP detail after an error', async () => {
    const loadMcpConnector = vi
      .fn<(connectorId: string) => Promise<{ id: string; name: string; authenticated: boolean }>>()
      .mockRejectedValueOnce(new Error('Detail unavailable'))
      .mockResolvedValue({ id: 'private', name: 'Private', authenticated: false });

    render(
      <ServerProvider server={createMockAgentUIServer({ catalog: createMockCatalog() })}>
        <SlotsProvider>
          <AgentConfigEditors
            editor="mcp"
            spec={{ model: { name: 'openai/gpt' } }}
            models={[]}
            connectors={[{ id: 'private', name: 'Private', authenticated: true }]}
            skills={[]}
            loading={false}
            error={null}
            loadMcpConnector={loadMcpConnector}
            loadMcpTools={vi.fn()}
            onChange={vi.fn()}
            onClose={vi.fn()}
          />
        </SlotsProvider>
      </ServerProvider>,
    );

    expect(await screen.findByText('Detail unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText("You're not connected to this MCP Server")).toBeInTheDocument();
    expect(loadMcpConnector).toHaveBeenCalledTimes(2);
  });

  it('ignores stale MCP detail results after selecting another connector', async () => {
    const first = deferred<{ id: string; name: string; authenticated: boolean }>();
    const second = deferred<{ id: string; name: string; authenticated: boolean }>();
    const loadMcpConnector = vi.fn((connectorId: string) => (connectorId === 'first' ? first.promise : second.promise));
    const loadMcpTools = vi.fn(async (connectorId: string) => [
      { id: `${connectorId}.tool`, name: `${connectorId}.tool` },
    ]);

    render(
      <SlotsProvider>
        <AgentConfigEditors
          editor="mcp"
          spec={{ model: { name: 'openai/gpt' } }}
          models={[]}
          connectors={[
            { id: 'first', name: 'First', authenticated: true },
            { id: 'second', name: 'Second', authenticated: true },
          ]}
          skills={[]}
          loading={false}
          error={null}
          loadMcpConnector={loadMcpConnector}
          loadMcpTools={loadMcpTools}
          onChange={vi.fn()}
          onClose={vi.fn()}
        />
      </SlotsProvider>,
    );

    await waitFor(() => expect(loadMcpConnector).toHaveBeenCalledWith('first'));
    fireEvent.click(screen.getByRole('button', { name: 'Second' }));
    await act(async () => {
      second.resolve({ id: 'second', name: 'Second', authenticated: true });
    });
    expect(await screen.findByRole('menuitemcheckbox', { name: 'second.tool' })).toBeInTheDocument();
    await act(async () => {
      first.resolve({ id: 'first', name: 'First', authenticated: false });
    });
    expect(screen.getByRole('menuitemcheckbox', { name: 'second.tool' })).toBeInTheDocument();
    expect(loadMcpTools).toHaveBeenCalledTimes(1);
    expect(loadMcpTools).toHaveBeenCalledWith('second');
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

  it('reorders selected skills only when the skills editor reopens', () => {
    const availableSkills = [
      { id: 'alpha', name: 'Alpha' },
      { id: 'beta', name: 'Beta' },
    ];
    const initialSpec: AgentSpec = { model: { name: 'openai/gpt' } };
    const selectedSpec: AgentSpec = {
      ...initialSpec,
      skills: [{ id: 'beta', name: 'Beta' }],
    };
    const renderEditors = (spec: AgentSpec) => (
      <SlotsProvider>
        <AgentConfigEditors
          editor="skills"
          spec={spec}
          models={[]}
          connectors={[]}
          skills={availableSkills}
          loading={false}
          error={null}
          onChange={vi.fn()}
          onClose={vi.fn()}
        />
      </SlotsProvider>
    );
    const rendered = render(renderEditors(initialSpec));

    expect(screen.getAllByRole('menuitemcheckbox')[0]).toHaveTextContent('Alpha');
    rendered.rerender(renderEditors(selectedSpec));
    expect(screen.getAllByRole('menuitemcheckbox')[0]).toHaveTextContent('Alpha');

    rendered.unmount();
    render(renderEditors(selectedSpec));
    expect(screen.getAllByRole('menuitemcheckbox')[0]).toHaveTextContent('Beta');
  });

  it('loads registry versions lazily and attaches the chosen FQN', async () => {
    const spec: AgentSpec = { model: { name: 'openai/gpt' } };
    const onChange = vi.fn();
    const loadVersions = vi.fn(async () => [
      {
        name: 'agent-skill:acme/team-a/echo:1',
        displayName: 'echo',
        description: 'v1',
        version: 1,
      },
      {
        name: 'agent-skill:acme/team-a/echo:3',
        displayName: 'echo',
        description: 'v3',
        version: 3,
      },
    ]);
    const skill: AgentSkill = Object.assign(
      {
        id: 'agent-skill:acme/team-a/echo:3',
        name: 'echo',
        description: 'Echo skill',
      },
      { skillRepoName: 'team-a', version: 3, loadVersions },
    );

    render(
      <SlotsProvider>
        <AgentConfigEditors
          editor="skills"
          spec={spec}
          models={[]}
          connectors={[]}
          skills={[skill]}
          loading={false}
          error={null}
          onChange={onChange}
          onClose={vi.fn()}
        />
      </SlotsProvider>,
    );

    expect(screen.getByText('team-a')).toBeInTheDocument();
    expect(loadVersions).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Select version for echo' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'v1' }));
    expect(loadVersions).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select echo' }));
    expect(onChange).toHaveBeenCalledWith({
      ...spec,
      skills: [{ id: 'agent-skill:acme/team-a/echo:1', name: 'echo' }],
      config: { sandbox: { enabled: true } },
    });
  });

  it('shows a concise version error and copies its details', async () => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const errorMessage =
      'HTTP Error: Not Found <Error><Message>BucketName contains sensitive details</Message></Error>';
    const skill: AgentSkill = Object.assign(
      { id: 'agent-skill:acme/team-a/echo:3', name: 'echo' },
      { version: 3, loadVersions: vi.fn().mockRejectedValue(new Error(errorMessage)) },
    );

    render(
      <SlotsProvider>
        <AgentConfigEditors
          editor="skills"
          spec={{ model: { name: 'openai/gpt' } }}
          models={[]}
          connectors={[]}
          skills={[skill]}
          loading={false}
          error={null}
          onChange={vi.fn()}
          onClose={vi.fn()}
        />
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select version for echo' }));
    expect(await screen.findByText('Failed to load versions.')).toBeInTheDocument();
    expect(screen.queryByText(errorMessage, { exact: false })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy error' }));
    expect(writeText).toHaveBeenCalledWith(errorMessage);

    if (clipboardDescriptor === undefined) Reflect.deleteProperty(navigator, 'clipboard');
    else Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
  });
});
