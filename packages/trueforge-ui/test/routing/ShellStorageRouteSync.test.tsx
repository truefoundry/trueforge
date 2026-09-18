// @vitest-environment jsdom
import { act, render, waitFor } from '@testing-library/react';
import { useEffect, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ShellLocationProvider, useShellLocationStore } from '@/routing/ShellLocationContext.js';
import { clearShellLocationStorage, SHELL_LOCATION_STORAGE_KEY } from '@/routing/shellLocationStore.js';
import { ShellStorageRouteSync } from '@/routing/ShellStorageRouteSync.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider, useShellMode, type AgentConfig } from '@/server/ShellModeContext.js';
import {
  createMockAgentSessionsServer,
  createMockAgentUIServer,
  createMockCatalog,
  createMockScheduleServer,
} from '../server/mockServer.js';

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
  const store = useShellLocationStore();
  const location = store.getLocation();
  pathname = location.pathname;
  search = location.search;
  useEffect(() => {
    return store.subscribe(() => {
      const next = store.getLocation();
      pathname = next.pathname;
      search = next.search;
    });
  }, [store]);
  return null;
}

function SettingsCatalogProvider({
  children,
  settingsEnabled = true,
  includeCatalog = true,
  includeSessions = true,
  includeSchedules = false,
}: {
  children: ReactNode;
  settingsEnabled?: boolean;
  includeCatalog?: boolean;
  includeSessions?: boolean;
  includeSchedules?: boolean;
}) {
  const server = createMockAgentUIServer({
    ...(includeCatalog ? { catalog: createMockCatalog() } : {}),
    ...(includeSessions ? { sessions: createMockAgentSessionsServer() } : {}),
    ...(includeSchedules ? { schedules: createMockScheduleServer() } : {}),
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
    searchAgents: async () => [{ name: 'helper', agentId: 'helper-id' }],
  });
  return <ServerProvider server={server}>{children}</ServerProvider>;
}

function Harness({
  agentConfig,
  initialRemoteId,
  initialSettingsOpen = false,
  settingsEnabled = true,
  includeCatalog = true,
  includeSessions = true,
  includeSchedules = false,
}: {
  agentConfig?: AgentConfig;
  initialRemoteId?: string;
  initialSettingsOpen?: boolean;
  settingsEnabled?: boolean;
  includeCatalog?: boolean;
  includeSessions?: boolean;
  includeSchedules?: boolean;
}) {
  const [remoteId, setId] = useState<string | undefined>(initialRemoteId);
  setRemoteId = setId;
  return (
    <SettingsCatalogProvider
      settingsEnabled={settingsEnabled}
      includeCatalog={includeCatalog}
      includeSessions={includeSessions}
      includeSchedules={includeSchedules}
    >
      <ShellLocationProvider>
        <ShellModeProvider agentConfig={agentConfig} initialSettingsOpen={initialSettingsOpen}>
          <CaptureShell />
          <CaptureLocation />
          <ShellStorageRouteSync activeRemoteId={remoteId} initialSettingsOpen={initialSettingsOpen} />
        </ShellModeProvider>
      </ShellLocationProvider>
    </SettingsCatalogProvider>
  );
}

function seedStorage(pathnameValue: string, searchValue = '') {
  sessionStorage.setItem(
    SHELL_LOCATION_STORAGE_KEY,
    JSON.stringify({ version: 1, pathname: pathnameValue, search: searchValue }),
  );
}

beforeEach(() => {
  clearShellLocationStorage();
  window.history.replaceState(null, '', '/');
  pathname = '';
  search = '';
});

afterEach(() => {
  clearShellLocationStorage();
  window.history.replaceState(null, '', '/');
});

describe('ShellStorageRouteSync', () => {
  it('restores a session place from sessionStorage on boot', async () => {
    seedStorage('/sessions/abc');
    render(<Harness />);
    await waitFor(() => expect(shell.pendingSessionId).toBe('abc'));
    expect(pathname).toBe('/sessions/abc');
    expect(window.location.pathname).toBe('/');
  });

  it('restores settings from sessionStorage on boot', async () => {
    seedStorage('/settings');
    render(<Harness />);
    await waitFor(() => expect(shell.settingsOpen).toBe(true));
    expect(pathname).toBe('/settings');
  });

  it('restores a library agent with tab search from sessionStorage', async () => {
    seedStorage('/library/agent-1', '?tab=sessions&agentId=agent-1');
    render(<Harness />);
    await waitFor(() => expect(shell.libraryAgentId).toBe('agent-1'));
    expect(shell.libraryOpen).toBe(true);
    expect(pathname).toBe('/library/agent-1');
    expect(search).toBe('?tab=sessions&agentId=agent-1');
  });

  it('restores the sessions browser with a time-window search', async () => {
    seedStorage('/sessions', '?view=sessions&s_tw=86400000');
    render(<Harness />);
    await waitFor(() => expect(shell.sessionsOpen).toBe(true));
    expect(pathname).toBe('/sessions');
    expect(search).toContain('s_tw=86400000');
  });

  it('persists shell navigation across remount', async () => {
    const { unmount } = render(<Harness agentConfig={{ mode: 'AgentLibraryWithComposer' }} />);
    await waitFor(() => expect(pathname).toBe('/'));
    act(() => shell.setSettingsOpen(true));
    await waitFor(() => expect(pathname).toBe('/settings'));
    unmount();

    render(<Harness agentConfig={{ mode: 'AgentLibraryWithComposer' }} />);
    await waitFor(() => expect(shell.settingsOpen).toBe(true));
    expect(pathname).toBe('/settings');
  });

  it('mirrors an acquired session id into the stored location', async () => {
    render(<Harness agentConfig={{ mode: 'AgentLibraryWithComposer' }} />);
    await waitFor(() => expect(pathname).toBe('/'));
    act(() => setRemoteId('session-from-chat'));
    await waitFor(() => expect(pathname).toBe('/sessions/session-from-chat'));
    const stored = JSON.parse(sessionStorage.getItem(SHELL_LOCATION_STORAGE_KEY) ?? '{}') as {
      pathname?: string;
    };
    expect(stored.pathname).toBe('/sessions/session-from-chat');
  });

  it('lets a pasted share link win over stored state and strips the window URL', async () => {
    seedStorage('/settings');
    window.history.replaceState(null, '', '/?view=sessions&s_tw=3600000');
    render(<Harness />);
    await waitFor(() => expect(shell.sessionsOpen).toBe(true));
    expect(shell.settingsOpen).toBe(false);
    expect(pathname).toBe('/sessions');
    expect(window.location.search).toBe('');
    expect(search).toContain('view=sessions');
  });

  it('lets a pasted agent share link open the library agent over stored root', async () => {
    seedStorage('/');
    window.history.replaceState(null, '', '/?agentId=shared-agent&sessionId=sess-9&tab=sessions');
    render(<Harness />);
    await waitFor(() => expect(shell.libraryAgentId).toBe('shared-agent'));
    expect(pathname).toBe('/library/shared-agent');
    expect(window.location.search).toBe('');
    expect(search).toContain('agentId=shared-agent');
    expect(search).toContain('sessionId=sess-9');
  });

  it('falls back to root when sessionStorage is corrupted', async () => {
    sessionStorage.setItem(SHELL_LOCATION_STORAGE_KEY, '{not-json');
    render(<Harness />);
    await waitFor(() => expect(pathname).toBe('/'));
    expect(shell.pendingSessionId).toBeUndefined();
  });

  it('clears view from the store when sessions close without touching the window URL', async () => {
    seedStorage('/sessions', '?view=sessions');
    window.history.replaceState(null, '', '/host-page?keep=1');
    render(<Harness />);
    await waitFor(() => expect(shell.sessionsOpen).toBe(true));
    act(() => shell.setSessionsOpen(false));
    await waitFor(() => expect(shell.sessionsOpen).toBe(false));
    expect(window.location.search).toBe('?keep=1');
    expect(search).not.toContain('view=sessions');
  });
});
