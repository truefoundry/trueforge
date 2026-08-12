// @vitest-environment jsdom
import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessageLike } from '@assistant-ui/react';
import { fireEvent, render, screen } from '@testing-library/react';
import { trueFoundryExtras, type TrueFoundryRuntimeExtras } from '@truefoundry/assistant-ui-runtime';
import { describe, expect, it, vi } from 'vitest';

import { McpAuthContainer } from '@/containers/McpAuthContainer.js';

const SERVERS = [
  { id: 'srv-1', name: 'github', authUrl: 'https://example.com/auth/github' },
  { id: 'srv-2', name: 'slack', authUrl: 'https://example.com/auth/slack' },
];
const PENDING = { mcpServers: SERVERS };

function McpAuthHarness({
  pendingMcpAuth,
  resumeMcpAuth,
  isRunning = false,
}: {
  pendingMcpAuth: TrueFoundryRuntimeExtras['pendingMcpAuth'];
  resumeMcpAuth: TrueFoundryRuntimeExtras['resumeMcpAuth'];
  isRunning?: boolean;
}) {
  const messages: ThreadMessageLike[] = [];
  const runtime = useExternalStoreRuntime({
    messages,
    isRunning,
    convertMessage: (m: ThreadMessageLike) => m,
    onNew: async () => {},
    extras: trueFoundryExtras.provide({
      pendingApprovals: [],
      pendingToolResponses: [],
      pendingMcpAuth,
      resumeUnavailable: false,
      sandboxId: undefined,
      respondToToolApproval: () => {},
      respondToToolResponse: () => {},
      resumeMcpAuth,
      downloadSandboxFile: async () => new Blob(),
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
    <AssistantRuntimeProvider runtime={runtime}>
      <McpAuthContainer />
    </AssistantRuntimeProvider>
  );
}

describe('McpAuthContainer', () => {
  it('renders nothing when there is no pending MCP auth', () => {
    render(<McpAuthHarness pendingMcpAuth={null} resumeMcpAuth={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /continue/i })).not.toBeInTheDocument();
  });

  it('renders a Connect button per server that opens auth in a new tab', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<McpAuthHarness pendingMcpAuth={PENDING} resumeMcpAuth={vi.fn().mockResolvedValue(undefined)} />);
    expect(screen.getByText('github')).toBeInTheDocument();
    expect(screen.getByText('slack')).toBeInTheDocument();

    const connectButtons = screen.getAllByRole('button', { name: /connect/i });
    expect(connectButtons).toHaveLength(2);

    const [githubButton, slackButton] = connectButtons;
    if (githubButton === undefined || slackButton === undefined) {
      throw new Error('Expected connector buttons');
    }
    fireEvent.click(githubButton);
    fireEvent.click(slackButton);

    expect(openSpy).toHaveBeenCalledWith('https://example.com/auth/github', '_blank', 'noopener,noreferrer');
    expect(openSpy).toHaveBeenCalledWith('https://example.com/auth/slack', '_blank', 'noopener,noreferrer');
    openSpy.mockRestore();
  });

  it('calls resume when Continue is clicked', () => {
    const resumeMcpAuth = vi.fn().mockResolvedValue(undefined);
    render(<McpAuthHarness pendingMcpAuth={PENDING} resumeMcpAuth={resumeMcpAuth} isRunning={false} />);

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(resumeMcpAuth).toHaveBeenCalledTimes(1);
  });

  it('disables Continue while the thread is running', () => {
    render(<McpAuthHarness pendingMcpAuth={PENDING} resumeMcpAuth={vi.fn()} isRunning={true} />);
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  });
});
