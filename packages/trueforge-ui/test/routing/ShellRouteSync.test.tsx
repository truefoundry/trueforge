// @vitest-environment jsdom
import { act, render, waitFor } from '@testing-library/react';
import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { resolveRoutesConfig } from '@/routing/paths.js';
import { ShellRouteSync } from '@/routing/ShellRouteSync.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider, useShellMode, type AgentConfig } from '@/server/ShellModeContext.js';
import type { ListPermissionsResponse, PermissionsServer } from '@/server/types.js';
import {
  createMockAgentSessionsServer,
  createMockAgentUIServer,
  createMockCatalog,
  createMockSandboxEnvironmentServer,
  createMockScheduleServer,
} from '../server/mockServer.js';

const routes = resolveRoutesConfig();

type Shell = ReturnType<typeof useShellMode>;

let shell: Shell;
let pathname = '';
let search = '';
let setRemoteId: (id: string | undefined) => void = () => undefined;
let navigateApp: NavigateFunction = () => undefined;

function CaptureShell() {
  shell = useShellMode();
  return null;
}

function CaptureLocation() {
  const location = useLocation();
  const navigate = useNavigate();
  pathname = location.pathname;
  search = location.search;
  navigateApp = navigate;
  useEffect(() => {
    pathname = location.pathname;
    search = location.search;
  }, [location.pathname, location.search]);
  return null;
}

function SettingsCatalogProvider({
  children,
  settingsEnabled = true,
  capabilitiesFail = false,
  includeCatalog = true,
  includeSessions = true,
  includeSchedules = false,
  includeEnvironments = false,
  getSession,
  permissions,
}: {
  children: ReactNode;
  settingsEnabled?: boolean;
  capabilitiesFail?: boolean;
  includeCatalog?: boolean;
  includeSessions?: boolean;
  includeSchedules?: boolean;
  includeEnvironments?: boolean;
  getSession?: (req: { sessionId: string }) => Promise<{
    id: string;
    title: string;
    isMutable: boolean;
    createdAt: string;
    updatedAt: string;
    agentName?: string;
  }>;
  permissions?: PermissionsServer;
}) {
  const server = createMockAgentUIServer({
    ...(includeCatalog ? { catalog: createMockCatalog() } : {}),
    ...(includeSessions ? { sessions: createMockAgentSessionsServer() } : {}),
    ...(includeSchedules ? { schedules: createMockScheduleServer() } : {}),
    ...(includeEnvironments ? { sandboxEnvironments: createMockSandboxEnvironmentServer() } : {}),
    ...(permissions == null ? {} : { permissions }),
    getCapabilities: async () => {
      if (capabilitiesFail) throw new Error('Unavailable');
      return {
        data: {
          sandbox: { enabled: true },
          skill: { enabled: true },
          settings: { enabled: settingsEnabled },
        },
      };
    },
    getSession:
      getSession ??
      (async ({ sessionId }) => ({
        id: sessionId,
        title: 'Session',
        isMutable: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      })),
    // findAgentByName walks unfiltered pages and matches by exact name client-side.
    searchAgents: async () => ({ data: [{ name: 'helper', agentId: 'helper-id' }] }),
  });
  return <ServerProvider server={server}>{children}</ServerProvider>;
}

function Harness({
  agentConfig,
  initialRemoteId,
  initialSettingsOpen = false,
  settingsEnabled = true,
  capabilitiesFail = false,
  includeCatalog = true,
  includeSessions = true,
  includeSchedules = false,
  includeEnvironments = false,
  getSession,
  permissions,
}: {
  agentConfig?: AgentConfig;
  initialRemoteId?: string;
  initialSettingsOpen?: boolean;
  settingsEnabled?: boolean;
  capabilitiesFail?: boolean;
  includeCatalog?: boolean;
  includeSessions?: boolean;
  includeSchedules?: boolean;
  includeEnvironments?: boolean;
  getSession?: (req: { sessionId: string }) => Promise<{
    id: string;
    title: string;
    isMutable: boolean;
    createdAt: string;
    updatedAt: string;
    agentName?: string;
  }>;
  permissions?: PermissionsServer;
}) {
  const [remoteId, setId] = useState<string | undefined>(initialRemoteId);
  setRemoteId = setId;
  return (
    <SettingsCatalogProvider
      settingsEnabled={settingsEnabled}
      capabilitiesFail={capabilitiesFail}
      includeCatalog={includeCatalog}
      includeSessions={includeSessions}
      includeSchedules={includeSchedules}
      includeEnvironments={includeEnvironments}
      getSession={getSession}
      permissions={permissions}
    >
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
  initialRemoteId?: string;
  initialSettingsOpen?: boolean;
  settingsEnabled?: boolean;
  capabilitiesFail?: boolean;
  includeCatalog?: boolean;
  includeSessions?: boolean;
  includeSchedules?: boolean;
  includeEnvironments?: boolean;
  getSession?: (req: { sessionId: string }) => Promise<{
    id: string;
    title: string;
    isMutable: boolean;
    createdAt: string;
    updatedAt: string;
    agentName?: string;
  }>;
  permissions?: PermissionsServer;
  strict?: boolean;
}) {
  const tree = (
    <MemoryRouter initialEntries={opts.initialEntries ?? ['/']}>
      <Harness
        agentConfig={opts.agentConfig}
        initialRemoteId={opts.initialRemoteId}
        initialSettingsOpen={opts.initialSettingsOpen}
        settingsEnabled={opts.settingsEnabled}
        capabilitiesFail={opts.capabilitiesFail}
        includeCatalog={opts.includeCatalog}
        includeSessions={opts.includeSessions}
        includeSchedules={opts.includeSchedules}
        includeEnvironments={opts.includeEnvironments}
        getSession={opts.getSession}
        permissions={opts.permissions}
      />
    </MemoryRouter>
  );
  return render(opts.strict ? <StrictMode>{tree}</StrictMode> : tree);
}

describe('ShellRouteSync', () => {
  it('applies a session deep link on boot', async () => {
    renderSync({ initialEntries: ['/sessions/abc'] });
    await waitFor(() => expect(shell.pendingSessionId).toBe('abc'));
    expect(pathname).toBe('/sessions/abc');
  });

  it('rewrites a non-manager session deep link to the shared read-only view', async () => {
    renderSync({
      initialEntries: ['/sessions/shared-by-other'],
      permissions: {
        listPermissions: vi.fn(async (): Promise<ListPermissionsResponse> => ({
          data: { type: 'session', permissions: { 'shared-by-other': [] } },
        })),
      },
    });

    await waitFor(() => expect(shell.sharedSessionId).toBe('shared-by-other'));
    expect(shell.sessionsOpen).toBe(true);
    expect(shell.pendingSessionId).toBeUndefined();
    await waitFor(() => expect(pathname).toBe('/sessions/share/shared-by-other'));
  });

  it('keeps a manager session deep link on the live chat route', async () => {
    renderSync({
      initialEntries: ['/sessions/owned'],
      permissions: {
        listPermissions: vi.fn(async (): Promise<ListPermissionsResponse> => ({
          data: { type: 'session', permissions: { owned: ['MANAGE'] } },
        })),
      },
    });

    await waitFor(() => expect(shell.pendingSessionId).toBe('owned'));
    expect(shell.sharedSessionId).toBeNull();
    expect(pathname).toBe('/sessions/owned');
  });

  it('keeps the session URL and surfaces a pane error when a deep link is forbidden', async () => {
    const forbidden = Object.assign(new Error('Only the session creator can access this session'), {
      statusCode: 403,
    });
    renderSync({
      initialEntries: ['/sessions/forbidden'],
      getSession: async () => {
        throw forbidden;
      },
    });

    await waitFor(() => {
      expect(shell.sessionAccessError).toBe('Only the session creator can access this session');
    });
    expect(shell.pendingSessionId).toBe('forbidden');
    expect(pathname).toBe('/sessions/forbidden');
  });

  it('keeps the inaccessible deep-link URL even when a prior thread remote id is still live', async () => {
    renderSync({
      initialEntries: ['/sessions/prior'],
      initialRemoteId: 'prior',
      getSession: async ({ sessionId }) => {
        if (sessionId === 'forbidden') {
          throw Object.assign(new Error('Only the session creator can access this session'), { statusCode: 403 });
        }
        return {
          id: sessionId,
          title: 'Session',
          isMutable: true,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        };
      },
    });
    // Prior thread is already live via activeRemoteId, so boot skips openSession.
    await waitFor(() => expect(pathname).toBe('/sessions/prior'));

    act(() => {
      navigateApp('/sessions/forbidden');
    });

    await waitFor(() => {
      expect(shell.sessionAccessError).toBe('Only the session creator can access this session');
    });
    expect(shell.pendingSessionId).toBe('forbidden');
    // Must not snap back to the prior live thread while the error pane is showing.
    await waitFor(() => expect(pathname).toBe('/sessions/forbidden'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(pathname).toBe('/sessions/forbidden');
  });

  it('releases the boot URL wait when a superseded session load fails', async () => {
    const resolvers = new Map<
      string,
      {
        resolve: (value: {
          id: string;
          title: string;
          isMutable: boolean;
          createdAt: string;
          updatedAt: string;
        }) => void;
        reject: (error: unknown) => void;
      }
    >();
    renderSync({
      initialEntries: ['/sessions/boot'],
      getSession: ({ sessionId }) =>
        new Promise((resolve, reject) => {
          resolvers.set(sessionId, { resolve, reject });
        }),
    });
    await waitFor(() => expect(resolvers.has('boot')).toBe(true));

    // URL→shell opens another session while boot is still in flight (requestedSessionRef moves).
    act(() => {
      navigateApp('/sessions/other');
    });
    await waitFor(() => expect(resolvers.has('other')).toBe(true));

    await act(async () => {
      resolvers
        .get('boot')
        ?.reject(Object.assign(new Error('Only the session creator can access this session'), { statusCode: 403 }));
      await Promise.resolve();
    });
    expect(shell.sessionAccessError).toBeNull();

    await act(async () => {
      resolvers.get('other')?.resolve({
        id: 'other',
        title: 'Other',
        isMutable: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });
      await Promise.resolve();
    });
    await waitFor(() => expect(shell.pendingSessionId).toBe('other'));

    // Without releasing the abandoned boot wait, New Chat could not update the URL.
    act(() => {
      shell.openDraft();
    });
    await waitFor(() => expect(pathname).toBe('/'));
  });

  it('keeps the session URL and surfaces a pane error when a deep link is not found', async () => {
    const notFound = Object.assign(new Error('Session not found: missing'), { statusCode: 404 });
    renderSync({
      initialEntries: ['/sessions/missing'],
      getSession: async () => {
        throw notFound;
      },
    });

    await waitFor(() => {
      expect(shell.sessionAccessError).toBe('Session not found: missing');
    });
    expect(shell.pendingSessionId).toBe('missing');
    expect(pathname).toBe('/sessions/missing');
  });

  it('ignores a late access failure after the user starts a New Chat', async () => {
    let rejectLoad: ((error: unknown) => void) | undefined;
    renderSync({
      initialEntries: ['/sessions/slow'],
      getSession: () =>
        new Promise((_, reject) => {
          rejectLoad = reject;
        }),
    });
    await waitFor(() => expect(rejectLoad).toBeDefined());
    const loadingRuntimeKey = shell.runtimeKey;

    act(() => {
      shell.openDraft();
    });
    expect(shell.runtimeKey).not.toBe(loadingRuntimeKey);

    await act(async () => {
      rejectLoad?.(Object.assign(new Error('Only the session creator can access this session'), { statusCode: 403 }));
      await Promise.resolve();
    });

    expect(shell.sessionAccessError).toBeNull();
    expect(shell.pendingSessionId).toBeUndefined();
    await waitFor(() => expect(pathname).toBe('/'));

    act(() => {
      shell.openHistorySession({ sessionId: 'later', isMutable: true });
    });
    await waitFor(() => expect(pathname).toBe('/sessions/later'));
  });

  it('applies an agent deep link on boot and resolves its history filter id', async () => {
    renderSync({ initialEntries: ['/agents/helper'], agentConfig: { mode: 'AgentLibrary' }, strict: true });
    expect(shell.mode).toMatchObject({ status: 'active', isMutable: false, agentName: 'helper' });
    await waitFor(() => expect(shell.listSessionsAgentId).toBe('helper-id'));
    expect(pathname).toBe('/agents/helper');
    expect(search).toBe('?try_agent_name=helper');
    expect(shell.historyAgentFilter?.intent).toBe('try-agent');
  });

  it('restores a filtered history session from its agent-name query', async () => {
    renderSync({
      initialEntries: ['/sessions/abc?history_agent_name=helper'],
      agentConfig: { mode: 'AgentLibraryWithComposer' },
    });

    await waitFor(() => expect(shell.pendingSessionId).toBe('abc'));
    await waitFor(() => expect(shell.listSessionsAgentId).toBe('helper-id'));
    expect(shell.historyAgentFilter).toEqual({
      agentId: 'helper-id',
      agentName: 'helper',
      intent: 'history',
    });
    expect(search).toBe('?history_agent_name=helper');
  });

  it('clears a restored filter when no exact agent name exists', async () => {
    renderSync({
      initialEntries: ['/sessions/abc?history_agent_name=missing'],
      agentConfig: { mode: 'AgentLibraryWithComposer' },
    });

    await waitFor(() => expect(shell.pendingSessionId).toBe('abc'));
    await waitFor(() => expect(shell.historyAgentFilter).toBeNull());
    await waitFor(() => expect(search).toBe(''));
    expect(shell.listSessionsAgentId).toBeUndefined();
  });

  it('pushes the URL when the shell selects an immutable agent', () => {
    renderSync({ initialEntries: ['/'], agentConfig: { mode: 'AgentLibrary' } });
    expect(pathname).toBe('/');
    act(() => shell.selectLibraryAgent({ isMutable: false, agentId: 'foo-id', agentName: 'foo' }));
    expect(pathname).toBe('/agents/foo');
    expect(search).toBe('?try_agent_name=foo');
  });

  it('preserves Try Agent intent when its new chat acquires a session id', async () => {
    renderSync({ initialEntries: ['/agents/helper'], agentConfig: { mode: 'AgentLibraryWithComposer' } });
    await waitFor(() => expect(shell.listSessionsAgentId).toBe('helper-id'));

    act(() => setRemoteId('session-from-try'));

    expect(pathname).toBe('/sessions/session-from-try');
    expect(search).toBe('?try_agent_name=helper');
  });

  it('clears Try Agent URL and history filter when New Chat opens', async () => {
    renderSync({ initialEntries: ['/agents/helper'], agentConfig: { mode: 'AgentLibraryWithComposer' } });
    await waitFor(() => expect(shell.listSessionsAgentId).toBe('helper-id'));

    act(() => shell.openDraft());

    expect(pathname).toBe('/');
    expect(search).toBe('');
    expect(shell.historyAgentFilter).toBeNull();
    expect(shell.listSessionsAgentId).toBeUndefined();
  });

  it('writes and clears a manual history filter without changing the chat place', () => {
    renderSync({ initialEntries: ['/'], agentConfig: { mode: 'AgentLibraryWithComposer' } });

    act(() =>
      shell.setHistoryAgentFilter({
        agentId: 'helper-id',
        agentName: 'helper',
        intent: 'history',
      }),
    );
    expect(pathname).toBe('/');
    expect(search).toBe('?history_agent_name=helper');

    act(() => shell.setHistoryAgentFilter(null));
    expect(pathname).toBe('/');
    expect(search).toBe('');
  });

  it('clears history filter query state when leaving chat routes', () => {
    renderSync({ initialEntries: ['/'], agentConfig: { mode: 'AgentLibraryWithComposer' } });

    act(() =>
      shell.setHistoryAgentFilter({
        agentId: 'helper-id',
        agentName: 'helper',
        intent: 'history',
      }),
    );
    expect(search).toBe('?history_agent_name=helper');

    act(() => shell.openAgentBuilder());
    expect(pathname).toBe('/build-agent');
    expect(search).toBe('');
    expect(shell.historyAgentFilter).toBeNull();

    act(() =>
      shell.setHistoryAgentFilter({
        agentId: 'helper-id',
        agentName: 'helper',
        intent: 'history',
      }),
    );
    act(() => shell.setLibraryOpen(true));
    expect(pathname).toBe('/library');
    expect(search).toBe('');
    expect(shell.historyAgentFilter).toBeNull();
  });

  it('applies and mirrors the build-agent route', () => {
    renderSync({ initialEntries: ['/build-agent'] });
    expect(shell.mode).toMatchObject({ status: 'active', isMutable: true, isCreateAgent: true });
    expect(pathname).toBe('/build-agent');

    act(() => shell.openDraft());
    expect(pathname).toBe('/');
    act(() => shell.openAgentBuilder());
    expect(pathname).toBe('/build-agent');
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

  it('unregisters /settings when capabilities fail to load', async () => {
    renderSync({ initialEntries: ['/settings'], capabilitiesFail: true });
    await waitFor(() => {
      expect(shell.settingsOpen).toBe(false);
      expect(pathname).toBe('/');
    });
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

  it('unregisters /library/:agentId when sessions port is missing', async () => {
    renderSync({
      initialEntries: ['/library/agent-7'],
      agentConfig: { mode: 'AgentLibraryWithComposer' },
      includeSessions: false,
    });
    await waitFor(() => {
      expect(shell.libraryAgentId).toBeNull();
      expect(pathname).toBe('/');
    });
    act(() => shell.openLibraryAgent('agent-7'));
    expect(shell.libraryAgentId).toBeNull();
  });

  it('unregisters sessions browser when sessions port is missing', async () => {
    renderSync({
      initialEntries: ['/sessions'],
      agentConfig: { mode: 'AgentLibraryWithComposer' },
      includeSessions: false,
    });
    await waitFor(() => {
      expect(shell.sessionsOpen).toBe(false);
      expect(pathname).toBe('/');
    });
    act(() => shell.setSessionsOpen(true));
    expect(shell.sessionsOpen).toBe(false);
    expect(pathname).toBe('/');
  });

  it('mirrors sessions browser open through history when sessions port is present', () => {
    renderSync({ initialEntries: ['/'], agentConfig: { mode: 'AgentLibraryWithComposer' } });
    act(() => shell.setSessionsOpen(true));
    expect(shell.sessionsOpen).toBe(true);
    expect(pathname).toBe('/sessions');
  });

  it('unregisters /schedules when schedules port is missing', async () => {
    renderSync({
      initialEntries: ['/schedules'],
      agentConfig: { mode: 'AgentLibraryWithComposer' },
      includeSchedules: false,
    });
    await waitFor(() => {
      expect(shell.schedulesOpen).toBe(false);
      expect(pathname).toBe('/');
    });
    act(() => shell.setSchedulesOpen(true));
    expect(shell.schedulesOpen).toBe(false);
    expect(pathname).toBe('/');
  });

  it('mirrors schedules open through history when schedules port is present', () => {
    renderSync({
      initialEntries: ['/'],
      agentConfig: { mode: 'AgentLibraryWithComposer' },
      includeSchedules: true,
    });
    act(() => shell.setSchedulesOpen(true));
    expect(shell.schedulesOpen).toBe(true);
    expect(pathname).toBe('/schedules');
  });

  it('unregisters /environments when sandboxEnvironments port is missing', async () => {
    renderSync({
      initialEntries: ['/environments'],
      agentConfig: { mode: 'AgentLibraryWithComposer' },
      includeEnvironments: false,
    });
    await waitFor(() => {
      expect(shell.environmentsOpen).toBe(false);
      expect(pathname).toBe('/');
    });
    act(() => shell.setEnvironmentsOpen(true));
    expect(shell.environmentsOpen).toBe(false);
    expect(pathname).toBe('/');
  });

  it('mirrors environments open through history when sandboxEnvironments port is present', () => {
    renderSync({
      initialEntries: ['/'],
      agentConfig: { mode: 'AgentLibraryWithComposer' },
      includeEnvironments: true,
    });
    act(() => shell.setEnvironmentsOpen(true));
    expect(shell.environmentsOpen).toBe(true);
    expect(pathname).toBe('/environments');
  });

  it('returns to the chat place when a /library deep link is closed', () => {
    renderSync({ initialEntries: ['/library'], agentConfig: { mode: 'AgentLibraryWithComposer' } });
    expect(shell.libraryOpen).toBe(true);
    act(() => shell.setLibraryOpen(false));
    expect(pathname).toBe('/');
  });
});
