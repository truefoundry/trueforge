// @vitest-environment jsdom
import type { AppendMessage } from '@assistant-ui/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ComposerContainer } from '@/containers/ComposerContainer.js';
import { ComposerBusyProvider } from '@/hooks/useComposerBusyState.js';
import {
  CustomActionRenderersProvider,
  type CustomActionRendererProps,
} from '@/server/CustomActionRenderersContext.js';
import { ShellModeProvider } from '@/server/ShellModeContext.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { RuntimeHarness } from './RuntimeHarness.js';

const agentSpecState: { agentSpec: { model: { name: string } } | undefined } = {
  agentSpec: { model: { name: 'test/model' } },
};

const toolResponsesState = vi.hoisted(() => ({
  pending: [] as Array<{ toolCallId: string; toolName?: string; args?: Record<string, unknown> }>,
  respond: vi.fn(),
}));

const approvalsState = vi.hoisted(() => ({
  pending: [] as Array<{
    approvalId: string;
    threadId: string;
    toolName: string;
    args: Record<string, unknown>;
    argsText: string;
  }>,
}));

vi.mock('@truefoundry/assistant-ui-runtime', () => ({
  useTrueFoundryCancel: () => vi.fn(),
  useTrueFoundryToolResponses: () => toolResponsesState,
  useTrueFoundryApprovals: () => approvalsState,
  useTrueFoundryAgentSpec: () => ({ agentSpec: agentSpecState.agentSpec }),
}));

vi.mock('@assistant-ui/core/react', async importOriginal => {
  const actual = await importOriginal<typeof import('@assistant-ui/core/react')>();
  return {
    ...actual,
    useThreadIsRunning: () => false,
  };
});

function SecretSelectProbe({ onSubmit }: CustomActionRendererProps) {
  return (
    <button type="button" onClick={() => onSubmit('chosen-secret')}>
      Secret selector
    </button>
  );
}

function renderComposer(onNew?: (message: AppendMessage) => Promise<void>) {
  return render(
    <RuntimeHarness messages={[]} onNew={onNew}>
      <ComposerBusyProvider>
        <ComposerContainer />
      </ComposerBusyProvider>
    </RuntimeHarness>,
  );
}

describe('ComposerContainer', () => {
  beforeEach(() => {
    agentSpecState.agentSpec = { model: { name: 'test/model' } };
    toolResponsesState.pending = [];
    toolResponsesState.respond = vi.fn();
    approvalsState.pending = [];
  });
  it('wraps the composer in an attachment dropzone by default', () => {
    renderComposer();
    const dropzone = document.querySelector('[data-slot="aui_composer-attachment-dropzone"]');
    expect(dropzone).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message input' })).toBeInTheDocument();
  });

  it('marks the dropzone as dragging on drag enter', () => {
    renderComposer();
    const dropzone = document.querySelector('[data-slot="aui_composer-attachment-dropzone"]');
    expect(dropzone).not.toBeNull();
    if (dropzone === null) {
      throw new Error('Expected attachment dropzone');
    }
    fireEvent.dragEnter(dropzone);
    expect(dropzone).toHaveAttribute('data-dragging', 'true');
  });

  it('keeps the caret in place when text is inserted mid-string', () => {
    renderComposer();
    const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message input' });

    fireEvent.change(input, { target: { value: 'hello world' } });
    fireEvent.change(input, {
      target: { value: 'hello Xworld', selectionStart: 7, selectionEnd: 7 },
    });

    expect(input.value).toBe('hello Xworld');
    expect(input.selectionStart).toBe(7);
  });

  it('submits once on Enter and inserts a newline on Shift+Enter', async () => {
    const onNew = vi.fn(async () => {});
    renderComposer(onNew);
    const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message input' });

    fireEvent.change(input, { target: { value: 'hi' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onNew).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(input.value).toBe(''));
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it('disables send when no model is selected in mutable draft', async () => {
    agentSpecState.agentSpec = { model: { name: '' } };
    const onNew = vi.fn(async () => {});
    // No ShellModeProvider → treated as requiring a client-side model (draft path).
    renderComposer(onNew);
    const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message input' });

    fireEvent.change(input, { target: { value: 'hi' } });
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();

    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(input.value).toBe('hi'));
    expect(onNew).not.toHaveBeenCalled();
  });

  it('allows send on named agents without a client-side model', async () => {
    agentSpecState.agentSpec = undefined;
    const onNew = vi.fn(async () => {});
    render(
      <ShellModeProvider agentConfig={{ mode: 'SingleAgent', name: 'support' }}>
        <RuntimeHarness messages={[]} onNew={onNew}>
          <ComposerBusyProvider>
            <ComposerContainer />
          </ComposerBusyProvider>
        </RuntimeHarness>
      </ShellModeProvider>,
    );
    const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message input' });

    fireEvent.change(input, { target: { value: 'hi' } });
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();

    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(input.value).toBe(''));
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it('preserves consumer section overrides in draft mode', () => {
    render(
      <SlotsProvider
        overrides={{
          ComposerLeftSection: () => <div>Custom left</div>,
          ComposerRightSection: () => <div>Custom right</div>,
        }}
      >
        <ShellModeProvider
          agentConfig={{
            mode: 'AgentComposer',
            defaultAgentSpec: { model: { name: 'test/model' } },
          }}
        >
          <RuntimeHarness messages={[]}>
            <ComposerBusyProvider>
              <ComposerContainer />
            </ComposerBusyProvider>
          </RuntimeHarness>
        </ShellModeProvider>
      </SlotsProvider>,
    );

    expect(screen.getByText('Custom left')).toBeInTheDocument();
    expect(screen.getByText('Custom right')).toBeInTheDocument();
  });

  it('mounts a registered custom action renderer instead of the composer', () => {
    toolResponsesState.pending = [{ toolCallId: 'tc-1', toolName: 'secret_select', args: { secrets: ['a'] } }];

    render(
      <CustomActionRenderersProvider renderers={{ secret_select: SecretSelectProbe }}>
        <RuntimeHarness messages={[]}>
          <ComposerBusyProvider>
            <ComposerContainer />
          </ComposerBusyProvider>
        </RuntimeHarness>
      </CustomActionRenderersProvider>,
    );

    expect(screen.getByRole('button', { name: 'Secret selector' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message input' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Secret selector' }));
    expect(toolResponsesState.respond).toHaveBeenCalledWith({
      toolCallId: 'tc-1',
      content: 'chosen-secret',
    });
  });

  it('shows the approval banner above a disabled composer while approvals are pending', () => {
    approvalsState.pending = [
      {
        approvalId: 'appr-1',
        threadId: 'root',
        toolName: 'call_tool',
        args: {},
        argsText: '{}',
      },
      {
        approvalId: 'appr-2',
        threadId: 'root',
        toolName: 'call_tool',
        args: {},
        argsText: '{}',
      },
    ];

    renderComposer();

    expect(screen.getByText('2 tools need your input')).toBeInTheDocument();
    expect(screen.getByText('(1/2)')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message input' })).toBeDisabled();
    expect(document.querySelector('[data-slot="aui_composer-approval-pause"]')).toBeInTheDocument();
  });
});
