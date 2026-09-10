// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { LibrarySessionShareBoot } from '@/routing/LibrarySessionShareBoot.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider, useShellMode } from '@/server/ShellModeContext.js';
import { createMockAgentSessionsServer, createMockAgentUIServer } from '../server/mockServer.js';

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

function Probe() {
  const shell = useShellMode();
  return (
    <div>
      <span>{shell.libraryAgentId ?? 'none'}</span>
      <span>{shell.sessionsOpen ? 'sessions-open' : 'sessions-closed'}</span>
    </div>
  );
}

function renderBoot({ includeSessions = true }: { includeSessions?: boolean } = {}) {
  const server = createMockAgentUIServer({
    ...(includeSessions ? { sessions: createMockAgentSessionsServer() } : {}),
  });
  return render(
    <ServerProvider server={server}>
      <ShellModeProvider>
        <LibrarySessionShareBoot />
        <Probe />
      </ShellModeProvider>
    </ServerProvider>,
  );
}

describe('LibrarySessionShareBoot', () => {
  it('opens the library agent from ?agentId= without a router', () => {
    window.history.replaceState(null, '', '/?agentId=agent-1&sessionId=sess-1');
    const { getByText } = renderBoot();
    expect(getByText('agent-1')).toBeInTheDocument();
  });

  it('leaves the library closed when the share query is absent', () => {
    const { getByText } = renderBoot();
    expect(getByText('none')).toBeInTheDocument();
    expect(getByText('sessions-closed')).toBeInTheDocument();
  });

  it('opens the sessions browser from ?view=sessions without a router', () => {
    window.history.replaceState(null, '', '/?view=sessions&agentId=agent-1');
    const { getByText } = renderBoot();
    expect(getByText('none')).toBeInTheDocument();
    expect(getByText('sessions-open')).toBeInTheDocument();
  });

  it('ignores ?view=sessions when sessions port is missing', () => {
    window.history.replaceState(null, '', '/?view=sessions');
    const { getByText } = renderBoot({ includeSessions: false });
    expect(getByText('sessions-closed')).toBeInTheDocument();
  });

  it('ignores ?agentId= when sessions port is missing', () => {
    window.history.replaceState(null, '', '/?agentId=agent-1');
    const { getByText } = renderBoot({ includeSessions: false });
    expect(getByText('none')).toBeInTheDocument();
  });
});
