// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { resolveRoutesConfig } from '@/routing/paths.js';
import { ShellRouteSync } from '@/routing/ShellRouteSync.js';
import { ShellModeProvider, useShellMode, type AgentConfig } from '@/server/ShellModeContext.js';

const routes = resolveRoutesConfig();

type Shell = ReturnType<typeof useShellMode>;

let shell: Shell;
let pathname = '';
let setRemoteId: (id: string | undefined) => void = () => undefined;

function CaptureShell() {
  shell = useShellMode();
  return null;
}

function CaptureLocation() {
  const location = useLocation();
  pathname = location.pathname;
  useEffect(() => {
    pathname = location.pathname;
  }, [location.pathname]);
  return null;
}

function Harness({
  agentConfig,
  initialRemoteId,
  initialSettingsOpen = false,
}: {
  agentConfig?: AgentConfig;
  initialRemoteId?: string;
  initialSettingsOpen?: boolean;
}) {
  const [remoteId, setId] = useState<string | undefined>(initialRemoteId);
  setRemoteId = setId;
  return (
    <ShellModeProvider agentConfig={agentConfig} initialSettingsOpen={initialSettingsOpen}>
      <CaptureShell />
      <CaptureLocation />
      <ShellRouteSync routes={routes} activeRemoteId={remoteId} initialSettingsOpen={initialSettingsOpen} />
    </ShellModeProvider>
  );
}

function renderSync(opts: { initialEntries?: string[]; agentConfig?: AgentConfig; initialSettingsOpen?: boolean }) {
  return render(
    <MemoryRouter initialEntries={opts.initialEntries ?? ['/']}>
      <Harness agentConfig={opts.agentConfig} initialSettingsOpen={opts.initialSettingsOpen} />
    </MemoryRouter>,
  );
}

describe('ShellRouteSync', () => {
  it('applies a session deep link on boot', () => {
    renderSync({ initialEntries: ['/sessions/abc'] });
    expect(shell.pendingSessionId).toBe('abc');
    expect(pathname).toBe('/sessions/abc');
  });

  it('applies an agent deep link on boot', () => {
    renderSync({ initialEntries: ['/agents/helper'], agentConfig: { mode: 'AgentLibrary' } });
    expect(shell.mode).toMatchObject({ status: 'active', isMutable: false, agentName: 'helper' });
  });

  it('pushes the URL when the shell selects an immutable agent', () => {
    renderSync({ initialEntries: ['/'], agentConfig: { mode: 'AgentLibrary' } });
    expect(pathname).toBe('/');
    act(() => shell.selectLibraryAgent({ isMutable: false, agentName: 'foo' }));
    expect(pathname).toBe('/agents/foo');
  });

  it('mirrors settings open/close through history', () => {
    renderSync({ initialEntries: ['/'] });
    act(() => shell.setSettingsOpen(true));
    expect(pathname).toBe('/settings');
    act(() => shell.setSettingsOpen(false));
    expect(pathname).toBe('/');
  });

  it('replaces to the session path when a fresh chat acquires a remote id', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Harness agentConfig={{ mode: 'AgentComposer' }} />
      </MemoryRouter>,
    );
    expect(pathname).toBe('/');
    act(() => setRemoteId('new-session'));
    expect(pathname).toBe('/sessions/new-session');
  });

  it('opens settings on boot when initialSettingsOpen is set and pushes the URL', () => {
    renderSync({ initialEntries: ['/'], initialSettingsOpen: true });
    expect(shell.settingsOpen).toBe(true);
    expect(pathname).toBe('/settings');
  });

  // Boot replaces into /settings, so Back would leave the app instead of closing it.
  it('returns to the chat place when settings opened on boot is closed', () => {
    renderSync({ initialEntries: ['/'], initialSettingsOpen: true });
    act(() => shell.setSettingsOpen(false));
    expect(pathname).toBe('/');
  });

  it('returns to the chat place when a /settings deep link is closed', () => {
    renderSync({ initialEntries: ['/settings'] });
    expect(shell.settingsOpen).toBe(true);
    act(() => shell.setSettingsOpen(false));
    expect(pathname).toBe('/');
  });
});
