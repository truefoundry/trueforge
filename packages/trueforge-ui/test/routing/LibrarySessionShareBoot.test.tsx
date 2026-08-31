// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { LibrarySessionShareBoot } from '@/routing/LibrarySessionShareBoot.js';
import { ShellModeProvider, useShellMode } from '@/server/ShellModeContext.js';

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

describe('LibrarySessionShareBoot', () => {
  it('opens the library agent from ?agentId= without a router', () => {
    window.history.replaceState(null, '', '/?agentId=agent-1&sessionId=sess-1');
    const { getByText } = render(
      <ShellModeProvider>
        <LibrarySessionShareBoot />
        <Probe />
      </ShellModeProvider>,
    );
    expect(getByText('agent-1')).toBeInTheDocument();
  });

  it('leaves the library closed when the share query is absent', () => {
    const { getByText } = render(
      <ShellModeProvider>
        <LibrarySessionShareBoot />
        <Probe />
      </ShellModeProvider>,
    );
    expect(getByText('none')).toBeInTheDocument();
    expect(getByText('sessions-closed')).toBeInTheDocument();
  });

  it('opens the sessions browser from ?view=sessions without a router', () => {
    window.history.replaceState(null, '', '/?view=sessions&agentId=agent-1');
    const { getByText } = render(
      <ShellModeProvider>
        <LibrarySessionShareBoot />
        <Probe />
      </ShellModeProvider>,
    );
    expect(getByText('none')).toBeInTheDocument();
    expect(getByText('sessions-open')).toBeInTheDocument();
  });
});
