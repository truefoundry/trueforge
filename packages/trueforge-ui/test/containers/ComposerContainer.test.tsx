// @vitest-environment jsdom
import type { AppendMessage } from '@assistant-ui/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AnalyticsProvider } from '@/analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '@/analytics/events.js';
import { canSubmitComposer, ComposerContainer } from '@/containers/ComposerContainer.js';
import { ComposerBusyProvider } from '@/hooks/useComposerBusyState.js';
import {
  CustomActionRenderersProvider,
  type CustomActionRendererProps,
} from '@/server/CustomActionRenderersContext.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider } from '@/server/ShellModeContext.js';
import type { AgentSpec, SandboxEnvironment } from '@/server/types.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { createMockAgentUIServer, createMockSandboxEnvironmentServer } from '../server/mockServer.js';
import { RuntimeHarness } from './RuntimeHarness.js';

const agentSpecState: { agentSpec: AgentSpec | undefined } = {
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

const cancelMock = vi.hoisted(() => vi.fn());
const updateAgentSpecMock = vi.hoisted(() => vi.fn());

vi.mock('@truefoundry/trueforge-assistant-ui-runtime', () => ({
  useTrueForgeCancel: () => cancelMock,
  useTrueForgeToolResponses: () => toolResponsesState,
  useTrueForgeApprovals: () => approvalsState,
  useTrueForgeAgentSpec: () => ({ agentSpec: agentSpecState.agentSpec }),
  useTrueForgeUpdateAgentSpec: () => updateAgentSpecMock,
}));

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

const defaultSandboxEnv: SandboxEnvironment = {
  id: 'e1',
  name: 'team-base',
  description: 'Team base',
  status: 'ready',
  enabled: true,
  isDefault: true,
  statusReason: null,
  manifest: { name: 'team-base', description: 'Team base' },
  createdBySubject: { subjectId: 'user-1', subjectType: 'user', subjectDisplayName: 'alice' },
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-02T00:00:00.000Z',
};

function renderMutableComposer({
  onNew,
  listEnvironments,
}: {
  onNew?: (message: AppendMessage) => Promise<void>;
  listEnvironments?: () => Promise<{ data: SandboxEnvironment[] }>;
} = {}) {
  const server = createMockAgentUIServer({
    sandboxEnvironments: createMockSandboxEnvironmentServer({
      listEnvironments: listEnvironments ?? (async () => ({ data: [defaultSandboxEnv] })),
    }),
  });

  function Tree({ children }: { children: ReactNode }) {
    return (
      <ServerProvider server={server}>
        <ShellModeProvider
          agentConfig={{
            mode: 'AgentComposer',
            defaultAgentSpec: { model: { name: 'test/model' } },
          }}
        >
          <SlotsProvider
            overrides={{
              // Gate logic lives in MutableDraftComposer; skip DraftModelSelector fixtures.
              ComposerRightSection: () => <></>,
              DraftComposerRightSection: () => <></>,
            }}
          >
            <RuntimeHarness messages={[]} onNew={onNew}>
              <ComposerBusyProvider>{children}</ComposerBusyProvider>
            </RuntimeHarness>
          </SlotsProvider>
        </ShellModeProvider>
      </ServerProvider>
    );
  }

  return render(
    <Tree>
      <ComposerContainer />
    </Tree>,
  );
}

describe('canSubmitComposer', () => {
  it.each([
    { name: 'New Chat', requiresModel: true, hasModel: true },
    { name: 'Try Agent', requiresModel: false, hasModel: false },
    { name: 'Build Agent', requiresModel: true, hasModel: true },
  ])('allows attachment-only submission in $name', ({ requiresModel, hasModel }) => {
    expect(
      canSubmitComposer({
        disabled: false,
        hasText: false,
        hasAttachments: true,
        requiresModel,
        hasModel,
      }),
    ).toBe(true);
  });

  it('blocks empty messages and mutable drafts without a model', () => {
    expect(
      canSubmitComposer({
        disabled: false,
        hasText: false,
        hasAttachments: false,
        requiresModel: false,
        hasModel: false,
      }),
    ).toBe(false);
    expect(
      canSubmitComposer({
        disabled: false,
        hasText: false,
        hasAttachments: true,
        requiresModel: true,
        hasModel: false,
      }),
    ).toBe(false);
  });

  it('blocks submission while models or sandbox are still loading', () => {
    expect(
      canSubmitComposer({
        disabled: false,
        hasText: true,
        hasAttachments: false,
        requiresModel: true,
        hasModel: true,
        isBlocked: true,
      }),
    ).toBe(false);
  });
});

describe('ComposerContainer', () => {
  beforeEach(() => {
    agentSpecState.agentSpec = { model: { name: 'test/model' } };
    toolResponsesState.pending = [];
    toolResponsesState.respond = vi.fn();
    approvalsState.pending = [];
    cancelMock.mockReset();
    cancelMock.mockResolvedValue(undefined);
    updateAgentSpecMock.mockReset();
    updateAgentSpecMock.mockImplementation((patch: Partial<AgentSpec>) => {
      agentSpecState.agentSpec = {
        ...agentSpecState.agentSpec,
        ...patch,
        model: patch.model ?? agentSpecState.agentSpec?.model ?? { name: '' },
        config: patch.config
          ? { ...agentSpecState.agentSpec?.config, ...patch.config }
          : agentSpecState.agentSpec?.config,
      };
    });
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

  it('tracks message_sent when the host supplies analytics.track', async () => {
    const track = vi.fn();
    const onNew = vi.fn(async () => {});
    render(
      <AnalyticsProvider track={track}>
        <ShellModeProvider agentConfig={{ mode: 'SingleAgent', name: 'support' }}>
          <RuntimeHarness messages={[]} onNew={onNew}>
            <ComposerBusyProvider>
              <ComposerContainer />
            </ComposerBusyProvider>
          </RuntimeHarness>
        </ShellModeProvider>
      </AnalyticsProvider>,
    );
    const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message input' });

    fireEvent.change(input, { target: { value: 'hi' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onNew).toHaveBeenCalledTimes(1));
    expect(track).toHaveBeenCalledWith(
      AnalyticsEvents.Message.SENT,
      expect.objectContaining({ has_text: true, agent_name: 'support' }),
    );
  });

  it('tracks attachment_picked on dropzone drop', () => {
    const track = vi.fn();
    render(
      <AnalyticsProvider track={track}>
        <ShellModeProvider agentConfig={{ mode: 'SingleAgent', name: 'support' }}>
          <RuntimeHarness messages={[]}>
            <ComposerBusyProvider>
              <ComposerContainer />
            </ComposerBusyProvider>
          </RuntimeHarness>
        </ShellModeProvider>
      </AnalyticsProvider>,
    );
    const dropzone = document.querySelector('[data-slot="aui_composer-attachment-dropzone"]');
    expect(dropzone).not.toBeNull();
    if (dropzone === null) {
      throw new Error('Expected attachment dropzone');
    }

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [new File(['hello'], 'note.txt', { type: 'text/plain' })],
        items: {
          length: 0,
          [Symbol.iterator]: function* () {},
        },
      },
    });

    expect(track).toHaveBeenCalledWith(
      AnalyticsEvents.Attachment.PICKED,
      expect.objectContaining({ file_count: 1, agent_name: 'support' }),
    );
  });

  it('does not track attachment_picked when only a folder is dropped', () => {
    const track = vi.fn();
    render(
      <AnalyticsProvider track={track}>
        <ShellModeProvider agentConfig={{ mode: 'SingleAgent', name: 'support' }}>
          <RuntimeHarness messages={[]}>
            <ComposerBusyProvider>
              <ComposerContainer />
            </ComposerBusyProvider>
          </RuntimeHarness>
        </ShellModeProvider>
      </AnalyticsProvider>,
    );
    const dropzone = document.querySelector('[data-slot="aui_composer-attachment-dropzone"]');
    expect(dropzone).not.toBeNull();
    if (dropzone === null) {
      throw new Error('Expected attachment dropzone');
    }

    const folderItem = {
      kind: 'file',
      getAsFile: () => new File([], 'docs'),
      webkitGetAsEntry: () => ({ isDirectory: true, isFile: false, name: 'docs' }),
    };
    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [new File([], 'docs')],
        items: {
          length: 1,
          0: folderItem,
          [Symbol.iterator]: function* () {
            yield folderItem;
          },
        },
      },
    });

    expect(track).not.toHaveBeenCalledWith(AnalyticsEvents.Attachment.PICKED, expect.anything());
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

  it('keeps the composer enabled under a custom action renderer', () => {
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
    expect(screen.getByRole('textbox', { name: 'Message input' })).toBeEnabled();
    expect(document.querySelector('[data-slot="aui_composer-pause"]')).toHaveAttribute('data-pause-kind', 'custom');

    fireEvent.click(screen.getByRole('button', { name: 'Secret selector' }));
    expect(toolResponsesState.respond).toHaveBeenCalledWith({
      toolCallId: 'tc-1',
      content: 'chosen-secret',
    });
  });

  it('keeps the composer enabled under the approval banner', () => {
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
    expect(screen.getByRole('textbox', { name: 'Message input' })).toBeEnabled();
    expect(document.querySelector('[data-slot="aui_composer-pause"]')).toHaveAttribute('data-pause-kind', 'approval');
  });

  it('shows cancel while running with an empty composer', () => {
    render(
      <RuntimeHarness messages={[]} isRunning>
        <ComposerBusyProvider>
          <ComposerContainer />
        </ComposerBusyProvider>
      </RuntimeHarness>,
    );

    expect(screen.getByRole('textbox', { name: 'Message input' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeInTheDocument();
  });

  it('disables Cancel and shows Cancelling while cancel is in flight', async () => {
    let resolveCancel: (() => void) | undefined;
    cancelMock.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          resolveCancel = resolve;
        }),
    );

    render(
      <RuntimeHarness messages={[]} isRunning>
        <ComposerBusyProvider>
          <ComposerContainer />
        </ComposerBusyProvider>
      </RuntimeHarness>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancelling' })).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Cancelling' }));
    expect(cancelMock).toHaveBeenCalledTimes(1);

    resolveCancel?.();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancelling' })).not.toBeInTheDocument());
  });

  it('sends while running without calling cancel', async () => {
    const onNew = vi.fn(async () => {});
    render(
      <RuntimeHarness messages={[]} isRunning onNew={onNew}>
        <ComposerBusyProvider>
          <ComposerContainer />
        </ComposerBusyProvider>
      </RuntimeHarness>,
    );

    const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message input' });
    fireEvent.change(input, { target: { value: 'follow up' } });
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onNew).toHaveBeenCalledTimes(1));
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it('does not cancel on empty Enter while running', () => {
    render(
      <RuntimeHarness messages={[]} isRunning>
        <ComposerBusyProvider>
          <ComposerContainer />
        </ComposerBusyProvider>
      </RuntimeHarness>,
    );

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message input' }), { key: 'Enter' });
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it('blocks send with Preparing sandbox while environments load', async () => {
    renderMutableComposer({
      listEnvironments: () => new Promise(() => {}),
    });
    const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message input' });
    fireEvent.change(input, { target: { value: 'hi' } });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Preparing sandbox…' })).toBeDisabled();
    });
  });

  it('allows send once the draft already names a sandbox environment', async () => {
    agentSpecState.agentSpec = {
      model: { name: 'test/model' },
      config: { sandbox: { environmentName: 'team-base' } },
    };
    const onNew = vi.fn(async () => {});
    renderMutableComposer({ onNew });
    const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message input' });
    fireEvent.change(input, { target: { value: 'hi' } });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
    });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onNew).toHaveBeenCalledTimes(1));
  });

  it('allows send when the environments list fails', async () => {
    const onNew = vi.fn(async () => {});
    renderMutableComposer({
      onNew,
      listEnvironments: async () => {
        throw new Error('list failed');
      },
    });
    const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message input' });
    fireEvent.change(input, { target: { value: 'hi' } });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
    });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onNew).toHaveBeenCalledTimes(1));
  });

  it('allows send when the tenant has no default sandbox', async () => {
    const onNew = vi.fn(async () => {});
    renderMutableComposer({
      onNew,
      listEnvironments: async () => ({
        data: [{ ...defaultSandboxEnv, isDefault: false, name: 'python-data', id: 'e2' }],
      }),
    });
    const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message input' });
    fireEvent.change(input, { target: { value: 'hi' } });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
    });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onNew).toHaveBeenCalledTimes(1));
  });

  it('blocks send with Loading models while the catalog loads', async () => {
    agentSpecState.agentSpec = { model: { name: '' } };
    // Right section stubbed so ensureLoaded never runs; catalog stays unloaded.
    renderMutableComposer({
      listEnvironments: async () => ({ data: [defaultSandboxEnv] }),
    });
    const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message input' });
    fireEvent.change(input, { target: { value: 'hi' } });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Loading models…' })).toBeDisabled();
    });
  });
});
