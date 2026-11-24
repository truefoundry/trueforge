// @vitest-environment jsdom
import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessageLike } from '@assistant-ui/react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { trueForgeExtras } from '@truefoundry/trueforge-assistant-ui-runtime';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { AgentConfigInstructionsProvider } from '@/atoms/draft/AgentConfigInstructionsContext.js';
import { SidebarLayout } from '@/layouts/SidebarLayout.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider } from '@/server/ShellModeContext.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { createMockAgentUIServer } from '../server/mockServer.js';

const htmlMessage = {
  role: 'assistant',
  content: ['Done', '', '```sandbox_artifacts', '[Metrics redesign](/tmp/metrics.html)', '```'].join('\n'),
  metadata: { custom: { turnId: 'turn-42', sandboxId: 'sbx-1' } },
} satisfies ThreadMessageLike;

function SidebarPreviewHarness({ children }: { children: ReactNode }) {
  const runtime = useExternalStoreRuntime({
    messages: [htmlMessage],
    isRunning: false,
    convertMessage: (message: ThreadMessageLike) => message,
    onNew: async () => {},
    extras: trueForgeExtras.provide({
      pendingApprovals: [],
      pendingToolResponses: [],
      pendingMcpAuth: null,
      resumeUnavailable: false,
      sandboxId: 'sbx-1',
      respondToToolApproval: async () => {},
      respondToToolResponse: async () => {},
      continueMcpAuth: async () => {},
      downloadSandboxFile: async () => new Blob(['<!doctype html><h1>Metrics</h1>']),
      cancel: async () => {},
      resetFromTurn: async () => {},
      reload: () => {},
      hasOlderHistory: false,
      isLoadingOlderHistory: false,
      loadOlderHistory: async () => {},
      draft: null,
    }),
  });

  return (
    <SlotsProvider>
      <ServerProvider server={createMockAgentUIServer()}>
        <ShellModeProvider>
          <AgentConfigInstructionsProvider>
            <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
          </AgentConfigInstructionsProvider>
        </ShellModeProvider>
      </ServerProvider>
    </SlotsProvider>
  );
}

describe('SidebarLayout file preview', () => {
  it('keeps recent chats visible while the preview fills the chat pane', async () => {
    if (typeof Element.prototype.scrollTo !== 'function') {
      Element.prototype.scrollTo = () => undefined;
    }

    render(
      <SidebarPreviewHarness>
        <SidebarLayout />
      </SidebarPreviewHarness>,
    );

    expect(screen.getByRole('complementary', { name: 'Recent chats' })).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'Enlarge Metrics redesign' }));
    const panel = await screen.findByRole('complementary', { name: 'Preview of Metrics redesign' });
    expect(screen.getByRole('complementary', { name: 'Recent chats' })).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: 'Full page' }));
    await waitFor(() => {
      expect(screen.getByRole('complementary', { name: 'Preview of Metrics redesign' })).toHaveAttribute(
        'data-placement',
        'full',
      );
    });
    expect(screen.getByRole('complementary', { name: 'Recent chats' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Exit full page' }));
    expect(screen.getByRole('complementary', { name: 'Recent chats' })).toBeInTheDocument();
  });
});

describe('SidebarLayout collapse', () => {
  it('collapses to an icon rail and expands from the logo control', () => {
    window.localStorage.removeItem('aui-sidebar-collapsed');

    render(
      <SidebarPreviewHarness>
        <SidebarLayout />
      </SidebarPreviewHarness>,
    );

    const rail = document.querySelector('[data-slot="aui_app-rail"]');
    expect(rail).toHaveAttribute('data-collapsed', 'false');
    expect(screen.getByRole('complementary', { name: 'Recent chats' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(rail).toHaveAttribute('data-collapsed', 'true');
    expect(screen.queryByRole('complementary', { name: 'Recent chats' })).not.toBeInTheDocument();
    expect(window.localStorage.getItem('aui-sidebar-collapsed')).toBe('1');

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(rail).toHaveAttribute('data-collapsed', 'false');
    expect(screen.getByRole('complementary', { name: 'Recent chats' })).toBeInTheDocument();
    expect(window.localStorage.getItem('aui-sidebar-collapsed')).toBe('0');
  });

  it('opens a chat-history flyout from the collapsed rail without expanding', () => {
    window.localStorage.removeItem('aui-sidebar-collapsed');

    render(
      <SidebarPreviewHarness>
        <SidebarLayout />
      </SidebarPreviewHarness>,
    );

    const rail = document.querySelector('[data-slot="aui_app-rail"]');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(rail).toHaveAttribute('data-collapsed', 'true');
    expect(screen.queryByRole('complementary', { name: 'Recent chats' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open chat history' }));
    expect(rail).toHaveAttribute('data-collapsed', 'true');
    expect(screen.getByRole('dialog', { name: 'Chat History' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Chat History' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Chat History' })).not.toBeInTheDocument();
  });
});
