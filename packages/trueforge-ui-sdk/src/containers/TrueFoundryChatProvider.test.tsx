// @vitest-environment jsdom
import { useExternalStoreRuntime, type ThreadMessageLike } from '@assistant-ui/react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AgentUIServer } from '../server/types.js';

vi.mock('@truefoundry/assistant-ui-runtime', () => ({
  trueFoundryAttachmentAdapter: {},
  useTrueFoundryAgentRuntime: () =>
    // Called from ChatRuntimeScope (a React component), so hooks are valid here.
    useExternalStoreRuntime<ThreadMessageLike>({
      messages: [],
      isRunning: false,
      convertMessage: (message: ThreadMessageLike) => message,
      onNew: async () => {},
    }),
}));

import { TrueFoundryChatProvider } from './TrueFoundryChatProvider.js';

function mockServer(): AgentUIServer {
  return {
    createSession: vi.fn(),
    listSessions: vi.fn(),
    getSession: vi.fn(),
    updateSession: vi.fn(),
    createTurn: vi.fn(),
    cancelSession: vi.fn(),
    listTurns: vi.fn(),
    getTurn: vi.fn(),
    listEvents: vi.fn(),
    getModels: vi.fn(async () => []),
    getSkills: vi.fn(async () => []),
    getMcp: vi.fn(async () => []),
    searchAgents: vi.fn(async () => []),
    saveAgent: vi.fn(async () => ({})),
  } as unknown as AgentUIServer;
}

describe('TrueFoundryChatProvider', () => {
  it('mounts children under the chat provider with a mock server', () => {
    render(
      <TrueFoundryChatProvider server={mockServer()} agentName="my-agent">
        <div>chat-child</div>
      </TrueFoundryChatProvider>,
    );

    expect(screen.getByText('chat-child')).toBeInTheDocument();
  });
});
