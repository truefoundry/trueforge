// @vitest-environment jsdom
import { act, render, waitFor } from '@testing-library/react';
import { useEffect, useState, type ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { resolveRoutesConfig } from '@/routing/paths.js';
import { ShellRouteSync } from '@/routing/ShellRouteSync.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider, useShellMode, type AgentConfig } from '@/server/ShellModeContext.js';
import { createMockAgentUIServer, createMockCatalog } from '../server/mockServer.js';

const routes = resolveRoutesConfig();

type Shell = ReturnType<typeof useShellMode>;

let shell: Shell;
let pathname = '';
let search = '';
let setRemoteId: (id: string | undefined) => void = () => undefined;

function CaptureShell() {
  shell = useShellMode();
  return null;
}

function CaptureLocation() {
  const location = useLocation();
  pathname = location.pathname;
  search = location.search;
  useEffect(() => {
    pathname = location.pathname;
    search = location.search;
  }, [location.pathname, location.search]);
  return null;
}

function SettingsCatalogProvider({
  children,
  settingsEnabled = true,
  includeCatalog = true,
}: {
  children: ReactNode;
  settingsEnabled?: boolean;
  includeCatalog?: boolean;
}) {
  const server = createMockAgentUIServer({
    ...(includeCatalog ? { catalog: createMockCatalog() } : {}),
    getCapabilities: async () => ({
      data: {
        sandbox: { enabled: true },
        skill: { enabled: true },
        settings: { enabled: settingsEnabled },
      },
    }),
    getSession: async ({ sessionId }) => ({
      id: sessionId,
      title: 'Session',
      isMutable: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }),
  });
  return <ServerProvider server={server}>{children}</ServerProvider>;
}

function Harness({
  agentConfig,
  initialRemoteId,
  initialSettingsOpen = false,
  settingsEnabled = true,
  includeCatalog = true,
}: {
  agentConfig?: AgentConfig;
  initialRemoteId?: string;
  initialSettingsOpen?: boolean;
  settingsEnabled?: boolean;
  includeCatalog?: boolean;
}) {
  const [remoteId, setId] = useState<string | undefined>(initialRemoteId);
  setRemoteId = setId;
  return (
    <SettingsCatalogProvider settingsEnabled={settingsEnabled} includeCatalog={includeCatalog}>
      <ShellModeProvider agentConfig={agentConfig} initialSettingsOpen={initialSettingsOpen}>
        <CaptureShell />
        <CaptureLocation />
        <ShellRouteSync routes={routes} activeRemoteId={remoteId} initialSettingsOpen={initialSettingsOpen} />
      </ShellModeProvider>
    </SettingsCatalogProvider>
  );
}

function renderSync(opts: {
  initialEntries?: string[];
  agentConfig?: AgentConfig;
  initialSettingsOpen?: boolean;
  settingsEnabled?: boolean;
  includeCatalog?: boolean;
}) {
  return render(
    <MemoryRouter initialEntries={opts.initialEntries ?? ['/']}>
      <Harness
        agentConfig={opts.agentConfig}
        initialSettingsOpen={opts.initialSettingsOpen}
        settingsEnabled={opts.settingsEnabled}
        includeCatalog={opts.includeCatalog}
      />
    </MemoryRouter>,
  );
}

describe('ShellRouteSync', () => {
  it('applies a session deep link on boot', async () => {
    renderSync({ initialEntries: ['/sessions/abc'] });
    await waitFor(() => expect(shell.pendingSessionId).toBe('abc'));
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

  it('mirrors settings open/close through history', async () => {
    renderSync({ initialEntries: ['/'] });
    await waitFor(() => {
      act(() => shell.setSettingsOpen(true));
      expect(pathname).toBe('/settings');
    });
    act(() => shell.setSettingsOpen(false));
    expect(pathname).toBe('/');
  });

  it('mirrors library open/close through history', () => {
    renderSync({ initialEntries: ['/'], agentConfig: { mode: 'AgentLibraryWithComposer' } });
    act(() => shell.setLibraryOpen(true));
    expect(pathname).toBe('/library');
    act(() => shell.setLibraryOpen(false));
    expect(pathname).toBe('/');
  });

  it('mirrors library agent detail through history', () => {
    renderSync({ initialEntries: ['/'], agentConfig: { mode: 'AgentLibraryWithComposer' } });
    act(() => shell.openLibraryAgent('agent/id'));
    expect(pathname).toBe('/library/agent%2Fid');
    expect(shell.libraryAgentId).toBe('agent/id');
    act(() => shell.closeLibraryAgent());
    expect(pathname).toBe('/library');
  });

  it('closes the library when selecting a session from the overlay', () => {
    renderSync({ initialEntries: ['/library'], agentConfig: { mode: 'AgentLibraryWithComposer' } });
    expect(shell.libraryOpen).toBe(true);
    expect(pathname).toBe('/library');
    act(() => shell.openHistorySession({ sessionId: 'sess-1', isMutable: false, agentName: 'helper' }));
    expect(shell.libraryOpen).toBe(false);
    expect(pathname).toBe('/sessions/sess-1');
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

  it('opens settings on boot when initialSettingsOpen is set and pushes the URL', async () => {
    renderSync({ initialEntries: ['/'], initialSettingsOpen: true });
    await waitFor(() => {
      expect(shell.settingsOpen).toBe(true);
      expect(pathname).toBe('/settings');
    });
  });

  // Boot replaces into /settings, so Back would leave the app instead of closing it.
  it('returns to the chat place when settings opened on boot is closed', async () => {
    renderSync({ initialEntries: ['/'], initialSettingsOpen: true });
    await waitFor(() => expect(pathname).toBe('/settings'));
    act(() => shell.setSettingsOpen(false));
    expect(pathname).toBe('/');
  });

  it('returns to the chat place when a /settings deep link is closed', async () => {
    renderSync({ initialEntries: ['/settings'] });
    await waitFor(() => expect(shell.settingsOpen).toBe(true));
    act(() => shell.setSettingsOpen(false));
    expect(pathname).toBe('/');
  });

  it('unregisters /settings when settings capability is disabled', async () => {
    renderSync({ initialEntries: ['/settings'], settingsEnabled: false });
    await waitFor(() => {
      expect(shell.settingsOpen).toBe(false);
      expect(pathname).toBe('/');
    });
    act(() => shell.setSettingsOpen(true));
    expect(shell.settingsOpen).toBe(false);
    expect(pathname).toBe('/');
  });

  it('ignores initialSettingsOpen when Settings chrome has no catalog', async () => {
    renderSync({ initialEntries: ['/'], initialSettingsOpen: true, includeCatalog: false });
    await waitFor(() => {
      expect(shell.settingsOpen).toBe(false);
      expect(pathname).toBe('/');
    });
  });

  it('opens library on boot from a /library deep link', () => {
    renderSync({ initialEntries: ['/library'], agentConfig: { mode: 'AgentLibraryWithComposer' } });
    expect(shell.libraryOpen).toBe(true);
    expect(pathname).toBe('/library');
  });

  it('clears stale session query state from the library URL while preserving host keys', async () => {
    renderSync({
      initialEntries: ['/library?theme=dark&sessionId=sess-1&agentId=agent-1&s_sts=1&s_ets=2'],
      agentConfig: { mode: 'AgentLibraryWithComposer' },
    });
    expect(pathname).toBe('/library');
    await waitFor(() => expect(search).toBe('?theme=dark'));
  });

  it('opens agent details on boot from a /library/:agentId deep link', () => {
    renderSync({ initialEntries: ['/library/agent-7'], agentConfig: { mode: 'AgentLibraryWithComposer' } });
    expect(shell.libraryOpen).toBe(true);
    expect(shell.libraryAgentId).toBe('agent-7');
    expect(pathname).toBe('/library/agent-7');
  });

  it('returns to the chat place when a /library deep link is closed', () => {
    renderSync({ initialEntries: ['/library'], agentConfig: { mode: 'AgentLibraryWithComposer' } });
    expect(shell.libraryOpen).toBe(true);
    act(() => shell.setLibraryOpen(false));
    expect(pathname).toBe('/');
  });
});
