// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ClearChatButton } from '@/atoms/ClearChatButton.js';
import { SelectAgentEmptyState } from '@/atoms/SelectAgentEmptyState.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider } from '@/server/ShellModeContext.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { RuntimeHarness } from '../containers/RuntimeHarness.js';
import { createMockAgentUIServer } from '../server/mockServer.js';

vi.mock('@truefoundry/assistant-ui-runtime', () => ({
  useTrueFoundryAgentSpec: () => ({
    agentSpec: {
      model: { name: 'openai-main/gpt-4.1' },
    },
  }),
}));

const startedMessages = [{ role: 'user' as const, content: 'hello', id: 'm1' }];

function mockServer() {
  return createMockAgentUIServer({
    searchAgents: vi.fn(async () => [{ name: 'alpha', agentId: 'alpha' }]),
  });
}

describe('ClearChatButton', () => {
  it('is hidden while idle', () => {
    render(
      <SlotsProvider>
        <ShellModeProvider agentConfig={{ mode: 'AgentLibrary' }}>
          <RuntimeHarness messages={[]}>
            <ClearChatButton />
          </RuntimeHarness>
        </ShellModeProvider>
      </SlotsProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Clear chat' })).not.toBeInTheDocument();
  });

  it('is visible on an empty named agent chat', () => {
    render(
      <SlotsProvider>
        <ShellModeProvider agentConfig={{ mode: 'SingleAgent', name: 'a' }}>
          <RuntimeHarness messages={[]}>
            <ClearChatButton />
          </RuntimeHarness>
        </ShellModeProvider>
      </SlotsProvider>,
    );
    expect(screen.getByRole('button', { name: 'Clear chat' })).toBeInTheDocument();
  });

  it('is hidden on mutable sessions', () => {
    render(
      <SlotsProvider>
        <ShellModeProvider agentConfig={{ mode: 'AgentComposer' }}>
          <RuntimeHarness messages={startedMessages}>
            <ClearChatButton />
          </RuntimeHarness>
        </ShellModeProvider>
      </SlotsProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Clear chat' })).not.toBeInTheDocument();
  });

  it('calls clearChat when clicked after a chat has started', () => {
    render(
      <SlotsProvider>
        <ShellModeProvider agentConfig={{ mode: 'SingleAgent', name: 'a' }}>
          <RuntimeHarness messages={startedMessages}>
            <ClearChatButton />
          </RuntimeHarness>
        </ShellModeProvider>
      </SlotsProvider>,
    );
    expect(screen.getByRole('button', { name: 'Clear chat' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear chat' }));
  });
});

describe('SelectAgentEmptyState', () => {
  it('renders CTA when idle', () => {
    render(
      <SlotsProvider>
        <ServerProvider server={mockServer()}>
          <ShellModeProvider agentConfig={{ mode: 'AgentLibrary' }}>
            <SelectAgentEmptyState />
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>,
    );
    expect(screen.getByText('Select an agent to start chatting')).toBeInTheDocument();
  });

  it('renders nothing when not idle', () => {
    render(
      <SlotsProvider>
        <ShellModeProvider agentConfig={{ mode: 'SingleAgent', name: 'a' }}>
          <SelectAgentEmptyState />
        </ShellModeProvider>
      </SlotsProvider>,
    );
    expect(screen.queryByText('Select an agent to start chatting')).not.toBeInTheDocument();
  });
});
