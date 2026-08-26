import { getErrorMessage, ThemeProvider, TrueForgeUI, type SlotOverrides } from '@truefoundry/trueforge-ui';
import {
  createTrueForgeClient,
  getCapabilities,
  listModels,
  type HarnessAgentSpec,
} from '@truefoundry/trueforge-ui/plugins/trueforge-agent-server-adapter';
import { useEffect, useMemo, useState } from 'react';
import { AuthErrorScreen } from './AuthErrorScreen';
import { createAuthAwareFetch } from './authFetch';
import { probeSession, type SessionState } from './authSession';
import { parseAuthErrorReason, shouldShowAuthErrorScreen, stripAuthErrorSearch } from './authStatusSearch';
import { GetStartedScreen } from './GetStartedScreen';
import { LogoutButton } from './LogoutButton';

/** Shared cookie/OIDC fetch for boot helpers and `<TrueForgeUI server />`. */
const authAwareFetch = createAuthAwareFetch();
const bootClient = createTrueForgeClient({ fetch: authAwareFetch });

type BootState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; defaultAgentSpec: HarnessAgentSpec; openSettings: boolean };

export function App() {
  const authError = parseAuthErrorReason(window.location.search);
  const [session, setSession] = useState<SessionState | 'checking'>('checking');
  const [boot, setBoot] = useState<BootState>({ status: 'loading' });

  // Gate boot on a non-redirecting `/me` probe: unauthenticated users see the
  // welcome screen instead of being bounced to login by the auth-aware fetch.
  // Probe even when the URL has `?error=` — a replayed callback can leave that
  // query on a session that is still valid.
  useEffect(() => {
    const state = { cancelled: false };
    void probeSession().then(result => {
      if (!state.cancelled) {
        setSession(result);
      }
    });
    return () => {
      state.cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (session !== 'authenticated') {
      return;
    }
    if (parseAuthErrorReason(window.location.search) == null) {
      return;
    }
    window.history.replaceState(
      window.history.state,
      '',
      stripAuthErrorSearch({
        pathname: window.location.pathname,
        search: window.location.search,
        hash: window.location.hash,
      }),
    );
  }, [session]);

  useEffect(() => {
    if (session !== 'authenticated') {
      return;
    }
    const state = { cancelled: false };
    void (async () => {
      try {
        const [models, capabilities] = await Promise.all([listModels(bootClient), getCapabilities(bootClient)]);
        if (state.cancelled) {
          return;
        }
        const first = models[0];
        const sandboxConfig = { sandbox: { enabled: capabilities.sandbox.enabled } };
        if (first === undefined) {
          setBoot({
            status: 'ready',
            openSettings: true,
            defaultAgentSpec: {
              model: { name: '' },
              config: sandboxConfig,
            },
          });
          return;
        }
        const reasoningEfforts = first.properties.reasoningEfforts;
        // Default to the lowest real effort, not "none" — catalog lists are ordered ascending.
        const defaultReasoningEffort = reasoningEfforts?.find(effort => effort !== 'none') ?? reasoningEfforts?.[0];
        setBoot({
          status: 'ready',
          openSettings: false,
          defaultAgentSpec: {
            model: {
              name: first.name,
              ...(defaultReasoningEffort ? { params: { reasoningEffort: defaultReasoningEffort } } : {}),
            },
            config: sandboxConfig,
          },
        });
      } catch (err) {
        if (!state.cancelled) {
          setBoot({
            status: 'error',
            message: getErrorMessage(err, 'Failed to boot'),
          });
        }
      }
    })();
    return () => {
      state.cancelled = true;
    };
  }, [session]);

  const overrides: SlotOverrides = useMemo(() => ({ ShellActionsActionSlot: LogoutButton }), []);

  const authErrorReason = shouldShowAuthErrorScreen({ authError, session });
  if (authErrorReason != null) {
    return (
      <ThemeProvider>
        <AuthErrorScreen reason={authErrorReason} />
      </ThemeProvider>
    );
  }

  if (session === 'checking') {
    return (
      <ThemeProvider>
        <div className="boot-screen">Loading application…</div>
      </ThemeProvider>
    );
  }

  if (session === 'unauthenticated') {
    return (
      <ThemeProvider>
        <GetStartedScreen />
      </ThemeProvider>
    );
  }

  if (boot.status === 'error') {
    return (
      <ThemeProvider>
        <div className="boot-screen" data-error="true">
          Failed to load application configuration: {boot.message}
        </div>
      </ThemeProvider>
    );
  }

  if (boot.status === 'loading') {
    return (
      <ThemeProvider>
        <div className="boot-screen">Loading application…</div>
      </ThemeProvider>
    );
  }

  return (
    <div className="app-root">
      <TrueForgeUI
        server={{ type: 'trueforge', baseUrl: '/', fetch: authAwareFetch }}
        layout="sidebar"
        withRouter
        agentConfig={{
          mode: 'AgentLibraryWithComposer',
          defaultAgentSpec: boot.defaultAgentSpec,
        }}
        initialSettingsOpen={boot.openSettings}
        overrides={overrides}
        className="app-assistant"
      />
    </div>
  );
}
