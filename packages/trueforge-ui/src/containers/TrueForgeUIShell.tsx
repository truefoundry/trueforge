'use client';

import type { TrueFoundryAgentConfig, UseTrueFoundryAgentRuntimeOptions } from '@truefoundry/assistant-ui-runtime';
import { lazy, Suspense, useCallback, useMemo, useState, type ReactNode } from 'react';

import { DraftCatalogProvider } from '../atoms/draft/DraftCatalogProvider.js';
import { DraftSpecPreferenceBridge } from '../atoms/draft/DraftSpecPreferenceBridge.js';
import { cn } from '../atoms/lib/cn.js';
import { Spinner } from '../atoms/primitives/Spinner.js';
import { RemoteIdRouteBridge } from '../routing/RemoteIdRouteBridge.js';
import type { ResolvedRoutes, RoutesConfig } from '../routing/types.js';
import { ServerProvider } from '../server/ServerContext.js';
import { DEFAULT_AGENT_CONFIG, ShellModeProvider, useShellMode, type AgentConfig } from '../server/ShellModeContext.js';
import type { TrueForgeServerConfig } from '../server/TrueForgeServerConfig.js';
import { SlotsProvider, type SlotOverrides } from '../theme/SlotsProvider.js';
import type { LayoutProp, ThemeConfig } from '../theme/types.js';
import { getErrorMessage } from '../utils/getErrorMessage.js';
import { TrueFoundryChatProvider, type TrueFoundryChatProviderProps } from './TrueFoundryChatProvider.js';
import { useResolvedServer } from './useResolvedServer.js';

const SidebarLayout = lazy(() => import('../layouts/SidebarLayout.js').then(m => ({ default: m.SidebarLayout })));
const DrawerLayout = lazy(() => import('../layouts/DrawerLayout.js').then(m => ({ default: m.DrawerLayout })));
const DockLayout = lazy(() => import('../layouts/DockLayout.js').then(m => ({ default: m.DockLayout })));
const WidgetLayout = lazy(() => import('../layouts/WidgetLayout.js').then(m => ({ default: m.WidgetLayout })));
const ShellRouteSync = lazy(() => import('../routing/ShellRouteSync.js').then(m => ({ default: m.ShellRouteSync })));

export type ChatLayout = 'sidebar' | 'drawer' | 'dock' | 'widget';

type RuntimeAdapters = NonNullable<UseTrueFoundryAgentRuntimeOptions['adapters']>;

export type TrueForgeUIProps = {
  server: TrueForgeServerConfig;
  /** Built-in layout string or a custom layout component. Defaults to `"sidebar"`. */
  layout?: LayoutProp;
  overrides?: SlotOverrides;
  theme?: ThemeConfig;
  className?: string;
  initialSessionId?: string;
  adapters?: RuntimeAdapters;
  onError?: (error: unknown) => void;
  /**
   * Agent / library / composer shell mode.
   * Defaults to `{ mode: "AgentLibraryWithComposer" }`.
   */
  agentConfig?: AgentConfig;
  /** Open settings on first paint only (host boot with no models configured). */
  initialSettingsOpen?: boolean;
  /**
   * Sync shell navigation to the browser URL via react-router (opt-in).
   * Requires `react-router-dom` in the host. Leave off for dock/widget embeds
   * and hosts that own their own router. Defaults to `false`.
   */
  withRouter?: boolean;
  /** URL path customization; only honored when `withRouter`. */
  routes?: RoutesConfig;
};

export type TrueForgeUIShellProps = Omit<TrueForgeUIProps, 'withRouter'> & { resolvedRoutes?: ResolvedRoutes };

function LayoutFallback({ className }: { className?: string }) {
  return (
    <div
      className={className}
      style={{
        height: '100%',
        minHeight: '12rem',
        background:
          'linear-gradient(90deg, color-mix(in oklab, var(--secondary-bg) 55%, transparent) 25%, color-mix(in oklab, var(--secondary-bg) 25%, transparent) 50%, color-mix(in oklab, var(--secondary-bg) 55%, transparent) 75%)',
        backgroundSize: '200% 100%',
        animation: 'tfy-aui-pulse 1.2s ease-in-out infinite',
      }}
      aria-hidden
    />
  );
}

/** Shown while `type: "truefoundry"` resolves the agent UI server. */
export function ServerInitLoader({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn(
        'flex h-full min-h-48 w-full flex-1 items-center justify-center bg-primary-bg text-text-secondary',
        className,
      )}
    >
      <Spinner size={28} className="text-text-primary" />
      <span className="sr-only">Loading</span>
    </div>
  );
}

function ServerInitError({ error, className }: { error: unknown; className?: string }) {
  const message = getErrorMessage(error, 'Failed to initialize server');
  return (
    <div
      role="alert"
      className={cn(
        'flex h-full min-h-48 items-center justify-center bg-primary-bg px-6 text-center text-sm text-failure-bg',
        className,
      )}
    >
      {message}
    </div>
  );
}

function isBuiltInLayout(layout: LayoutProp): layout is ChatLayout {
  return layout === 'sidebar' || layout === 'drawer' || layout === 'dock' || layout === 'widget';
}

function BuiltInLayoutView({ layout, className }: { layout: ChatLayout; className?: string }) {
  switch (layout) {
    case 'sidebar':
      return <SidebarLayout className={className} />;
    case 'drawer':
      return <DrawerLayout className={className} />;
    case 'dock':
      return <DockLayout className={className} />;
    case 'widget':
      return <WidgetLayout className={className} />;
  }
}

function LayoutChildren({ layout, className }: { layout: LayoutProp; className?: string }) {
  if (isBuiltInLayout(layout)) {
    return (
      <Suspense fallback={<LayoutFallback className={className} />}>
        <BuiltInLayoutView layout={layout} className={className} />
      </Suspense>
    );
  }
  const HostLayout = layout;
  return <HostLayout className={className} />;
}

function ChatProviderFromShell({
  children,
  initialSessionId: hostInitialSessionId,
  onRemoteIdChange,
  ...providerRest
}: {
  children: ReactNode;
  /** When routing, reports the active thread's remote id up to `ShellRouteSync`. */
  onRemoteIdChange?: (id: string | undefined) => void;
} & Omit<TrueFoundryChatProviderProps, 'agent' | 'agentName' | 'listSessionsAgentId' | 'children'>) {
  const { mode, runtimeKey, listSessionsAgentId, pendingSessionId } = useShellMode();

  // Freeze draft seed for the life of this runtimeKey so bindMutableAgent (identity /
  // instructions on shell) does not push a new defaultAgentSpec into the runtime.
  const draftDefaultAgentSpec = useMemo(() => {
    if (mode.status === 'active' && mode.isMutable) {
      return mode.agentSpec ?? { model: { name: 'openai-main/gpt-4.1' } };
    }
    return { model: { name: 'openai-main/gpt-4.1' } };
    // runtimeKey is the remount boundary for mutable chats.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on runtimeKey only
  }, [runtimeKey]);

  const agent: TrueFoundryAgentConfig = useMemo(() => {
    // idle uses a placeholder draft so layout chrome (useAui) still mounts;
    // layouts render an empty CTA instead of the thread.
    if (mode.status === 'idle') {
      return {
        mode: 'draft',
        defaultAgentSpec: { model: { name: 'openai-main/gpt-4.1' } },
      };
    }
    // Runtime still uses named|draft; shell mutability maps onto that adapter.
    if (!mode.isMutable) {
      const agentName = mode.agentName ?? mode.agentId ?? pendingSessionId;
      if (agentName == null) {
        // Active immutable without identity should not happen; keep chrome mounted.
        return {
          mode: 'draft',
          defaultAgentSpec: { model: { name: 'openai-main/gpt-4.1' } },
        };
      }
      return { mode: 'named', agentName };
    }
    return {
      mode: 'draft',
      defaultAgentSpec: draftDefaultAgentSpec,
    };
  }, [mode, draftDefaultAgentSpec, pendingSessionId]);

  return (
    <TrueFoundryChatProvider
      key={runtimeKey}
      {...providerRest}
      agent={agent}
      listSessionsAgentId={listSessionsAgentId}
      initialSessionId={pendingSessionId ?? hostInitialSessionId}
    >
      <DraftCatalogProvider>
        <DraftSpecPreferenceBridge />
        {onRemoteIdChange != null ? <RemoteIdRouteBridge onRemoteIdChange={onRemoteIdChange} /> : null}
        {children}
      </DraftCatalogProvider>
    </TrueFoundryChatProvider>
  );
}

/** Internal shell. `resolvedRoutes` present iff mounted under `TrueForgeUIWithRouter`. */
export function TrueForgeUIShell(props: TrueForgeUIShellProps) {
  const {
    layout = 'sidebar',
    overrides,
    theme,
    className,
    agentConfig = DEFAULT_AGENT_CONFIG,
    initialSettingsOpen = false,
    server: serverConfig,
    onError,
    resolvedRoutes,
    routes: _routes,
    ...providerRest
  } = props;

  const resolved = useResolvedServer(serverConfig, onError);
  const [activeRemoteId, setActiveRemoteId] = useState<string | undefined>(undefined);
  const handleRemoteIdChange = useCallback((id: string | undefined) => setActiveRemoteId(id), []);

  if (resolved.status === 'loading') {
    return (
      <SlotsProvider overrides={overrides} theme={theme}>
        <ServerInitLoader className={className} />
      </SlotsProvider>
    );
  }

  if (resolved.status === 'error') {
    return (
      <SlotsProvider overrides={overrides} theme={theme}>
        <ServerInitError error={resolved.error} className={className} />
      </SlotsProvider>
    );
  }

  const server = resolved.server;
  const layoutTree = <LayoutChildren layout={layout} className={className} />;

  return (
    <SlotsProvider overrides={overrides} theme={theme}>
      <ServerProvider server={server}>
        <ShellModeProvider agentConfig={agentConfig} initialSettingsOpen={initialSettingsOpen}>
          {resolvedRoutes != null ? (
            <Suspense fallback={null}>
              <ShellRouteSync
                routes={resolvedRoutes}
                activeRemoteId={activeRemoteId}
                initialSettingsOpen={initialSettingsOpen}
              />
            </Suspense>
          ) : null}
          <ChatProviderFromShell
            server={server}
            onError={onError}
            onRemoteIdChange={resolvedRoutes != null ? handleRemoteIdChange : undefined}
            {...providerRest}
          >
            {layoutTree}
          </ChatProviderFromShell>
        </ShellModeProvider>
      </ServerProvider>
    </SlotsProvider>
  );
}
