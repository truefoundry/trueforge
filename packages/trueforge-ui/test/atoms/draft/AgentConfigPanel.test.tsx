// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgentConfigPanel } from '@/atoms/draft/AgentConfigPanel.js';
import { withInitialUserMessages } from '@/atoms/draft/agentConfigMessages.js';
import type { AgentSpec, ModelSelection } from '@/server/types.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';

const model: ModelSelection = {
  id: 'claude',
  name: 'anthropic/claude',
  provider: { name: 'Anthropic' },
  properties: {
    contextLength: 200_000,
    maxOutputTokens: 8_192,
  },
};

const spec: AgentSpec = {
  model: {
    name: model.name,
    params: {
      maxTokens: 25000,
      reasoningEffort: 'high',
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
      parallelToolCalls: true,
    },
  },
  instructions: 'Be useful.',
  mcpServers: [{ id: 'github', name: 'GitHub', enableTools: ['issues.list'] }],
  skills: [{ id: 'research', name: 'Research' }],
  config: { sandbox: { enabled: true } },
};

describe('AgentConfigPanel', () => {
  it('shows supported configuration and omits deferred sections', () => {
    render(
      <SlotsProvider>
        <AgentConfigPanel
          spec={spec}
          model={model}
          skillsAvailable
          instructions={spec.instructions ?? ''}
          onOpenEditor={vi.fn()}
        />
      </SlotsProvider>,
    );

    expect(screen.getByText(/200K/)).toBeInTheDocument();
    expect(screen.getByText('25000')).toBeInTheDocument();
    expect(screen.queryByText('temperature:')).not.toBeInTheDocument();
    expect(screen.queryByText('top-k:')).not.toBeInTheDocument();
    expect(screen.queryByText('parallel tool calls:')).not.toBeInTheDocument();
    expect(screen.queryByText('file downloads:')).not.toBeInTheDocument();
    expect(screen.queryByText('compaction threshold:')).not.toBeInTheDocument();
    expect(screen.getByText('large tool response:')).toBeInTheDocument();
    expect(screen.getByText('dynamic sub-agents:')).toBeInTheDocument();
    expect(screen.getByText('generative UI:')).toBeInTheDocument();
    expect(screen.getByText('ask user questions:')).toBeInTheDocument();
    expect(screen.getByText('1 tools')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Runtime Config' })).toBeInTheDocument();
    expect(screen.queryByText('Structured Output')).not.toBeInTheDocument();
    expect(screen.queryByText('Metadata')).not.toBeInTheDocument();
    expect(screen.queryByText('Endpoint')).not.toBeInTheDocument();
    expect(screen.queryByText('Variables')).not.toBeInTheDocument();
    expect(screen.queryByText('Initial messages')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close agent config' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Agent Config' }).parentElement).toHaveClass(
      'h-11',
      'border-b',
      'bg-topbar-bg',
      'px-2',
      'py-1.5',
    );
  });

  it('routes editor actions from the configuration summary', () => {
    const onOpenEditor = vi.fn();
    render(
      <SlotsProvider>
        <AgentConfigPanel
          spec={spec}
          model={model}
          skillsAvailable
          instructions={spec.instructions ?? ''}
          onOpenEditor={onOpenEditor}
        />
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Model settings' }));
    expect(onOpenEditor).toHaveBeenCalledWith('model-settings');

    fireEvent.click(screen.getByRole('button', { name: 'Edit Runtime Config' }));
    expect(onOpenEditor).toHaveBeenCalledWith('runtime');

    fireEvent.click(screen.getByRole('button', { name: 'Edit Instructions' }));
    expect(onOpenEditor).toHaveBeenCalledWith('instructions');
  });

  it('previews instructions and summarizes initial user messages', () => {
    const specWithMessages = withInitialUserMessages({
      spec,
      messages: [
        { type: 'user.message', content: 'First prompt' },
        { type: 'user.message', content: 'Second prompt' },
      ],
    });

    render(
      <SlotsProvider>
        <AgentConfigPanel
          spec={specWithMessages}
          model={model}
          skillsAvailable
          instructions="Use the configured tools carefully."
          onOpenEditor={vi.fn()}
        />
      </SlotsProvider>,
    );

    expect(screen.getByText('Use the configured tools carefully.')).toBeInTheDocument();
    expect(screen.getByText('2 user messages')).toBeInTheDocument();
  });

  it('removes an MCP server directly from its config chip', () => {
    const onChange = vi.fn();
    render(
      <SlotsProvider>
        <AgentConfigPanel
          spec={spec}
          model={model}
          skillsAvailable
          instructions={spec.instructions ?? ''}
          onOpenEditor={vi.fn()}
          onChange={onChange}
        />
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove GitHub' }));
    expect(onChange).toHaveBeenCalledWith({ ...spec, mcpServers: [] });
  });

  it('toggles MCP preload from the config chip', () => {
    const onChange = vi.fn();
    render(
      <SlotsProvider>
        <AgentConfigPanel
          spec={spec}
          model={model}
          skillsAvailable
          instructions={spec.instructions ?? ''}
          onOpenEditor={vi.fn()}
          onChange={onChange}
        />
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Preload tools for GitHub' }));
    expect(onChange).toHaveBeenCalledWith({
      ...spec,
      mcpServers: [{ id: 'github', name: 'GitHub', enableTools: ['issues.list'], preload: true }],
    });
  });

  it('opens the MCP editor from the section add action', () => {
    const onOpenEditor = vi.fn();
    render(
      <SlotsProvider>
        <AgentConfigPanel
          spec={spec}
          model={model}
          skillsAvailable
          instructions={spec.instructions ?? ''}
          onOpenEditor={onOpenEditor}
          onChange={vi.fn()}
        />
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add MCP server' }));
    expect(onOpenEditor).toHaveBeenCalledWith('mcp');
  });

  it('shows the MCP empty state without a selected-servers message', () => {
    render(
      <SlotsProvider>
        <AgentConfigPanel
          spec={{ ...spec, mcpServers: [] }}
          model={model}
          skillsAvailable
          instructions={spec.instructions ?? ''}
          onOpenEditor={vi.fn()}
        />
      </SlotsProvider>,
    );

    expect(screen.getByText('MCP Servers')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add MCP server' })).toBeInTheDocument();
    expect(screen.queryByText('No MCP servers selected.')).not.toBeInTheDocument();
  });

  it('renders an optional close action for overlay layouts', () => {
    const onClose = vi.fn();
    render(
      <SlotsProvider>
        <AgentConfigPanel
          spec={spec}
          model={model}
          skillsAvailable
          instructions={spec.instructions ?? ''}
          onOpenEditor={vi.fn()}
          onClose={onClose}
        />
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close agent config' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
