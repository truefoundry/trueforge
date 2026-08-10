'use client';

import type { TrueFoundryAgentConfig, UseTrueFoundryAgentRuntimeOptions } from '@truefoundry/assistant-ui-runtime';
import { lazy, Suspense, useMemo, type ReactNode } from 'react';

import { cn } from '../atoms/lib/cn.js';
import { Spinner } from '../atoms/primitives/Spinner.js';
import { ServerProvider } from '../server/ServerContext.js';
import { DEFAULT_AGENT_CONFIG, ShellModeProvider, useShellMode, type AgentConfig } from '../server/ShellModeContext.js';
import type { TrueforgeServerConfig } from '../server/TrueforgeServerConfig.js';
import { SlotsProvider, type SlotOverrides } from '../theme/SlotsProvider.js';
import type { LayoutProp, ThemeConfig } from '../theme/types.js';
import PostMcpOauthScreen from './McpOauthContainer/PostMcpOauthScreen.js';
import { TrueFoundryChatProvider, type TrueFoundryChatProviderProps } from './TrueFoundryChatProvider.js';
import { useResolvedServer } from './useResolvedServer.js';

const SidebarLayout = lazy(() => import('../layouts/SidebarLayout.js').then(m => ({ default: m.SidebarLayout })));
const DrawerLayout = lazy(() => import('../layouts/DrawerLayout.js').then(m => ({ default: m.DrawerLayout })));
const DockLayout = lazy(() => import('../layouts/DockLayout.js').then(m => ({ default: m.DockLayout })));
const WidgetLayout = lazy(() => import('../layouts/WidgetLayout.js').then(m => ({ default: m.WidgetLayout })));

export type ChatLayout = 'sidebar' | 'drawer' | 'dock' | 'widget';
export type { AgentConfig } from '../server/ShellModeContext.js';
export type { TrueforgeBuiltInServerConfig, TrueforgeServerConfig } from '../server/TrueforgeServerConfig.js';
export type { LayoutProp } from '../theme/types.js';

type RuntimeAdapters = NonNullable<UseTrueFoundryAgentRuntimeOptions['adapters']>;

export type TrueforgeUIProps = {
  server: TrueforgeServerConfig;
  layout: LayoutProp;
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
};

function LayoutFallback({ className }: { className?: string }) {
  return (
    <div
      className={className}
      style={{
        height: '100%',
        minHeight: '12rem',
        background:
          'linear-gradient(90deg, color-mix(in oklab, var(--muted, #e5e5e5) 55%, transparent) 25%, color-mix(in oklab, var(--muted, #e5e5e5) 25%, transparent) 50%, color-mix(in oklab, var(--muted, #e5e5e5) 55%, transparent) 75%)',
        backgroundSize: '200% 100%',
        animation: 'tfy-aui-pulse 1.2s ease-in-out infinite',
      }}
      aria-hidden
    />
  );
}

/** Shown while `type: "truefoundry"` resolves the agent UI server. */
function ServerInitLoader({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn(
        'flex h-full min-h-48 w-full flex-1 items-center justify-center bg-background text-muted-foreground',
        className,
      )}
    >
      <Spinner size={28} className="text-foreground" />
      <span className="sr-only">Loading</span>
    </div>
  );
}

function ServerInitError({ error, className }: { error: unknown; className?: string }) {
  const message = error instanceof Error ? error.message : 'Failed to initialize server';
  return (
    <div
      role="alert"
      className={cn(
        'flex h-full min-h-48 items-center justify-center bg-background px-6 text-center text-sm text-destructive',
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
  ...providerRest
}: {
  children: ReactNode;
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
      {children}
    </TrueFoundryChatProvider>
  );
}

/**
 * Quick-start assistant UI: slots + runtime + a built-in or custom layout.
 * Pass a built-in `server` config, a ready `AgentUIServer`, and optional `agentConfig`.
 */
export function TrueforgeUI(props: TrueforgeUIProps) {
  const isMcpAuthScreen =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('screenType') === 'mcp-auth';

  // The callback skips server resolution but still inherits host theme and slots.
  return isMcpAuthScreen ? (
    <SlotsProvider overrides={props.overrides} theme={props.theme}>
      <PostMcpOauthScreen />
    </SlotsProvider>
  ) : (
    <TrueforgeUIShell {...props} />
  );
}

function TrueforgeUIShell(props: TrueforgeUIProps) {
  const {
    layout,
    overrides,
    theme,
    className,
    agentConfig = DEFAULT_AGENT_CONFIG,
    initialSettingsOpen = false,
    server: serverConfig,
    onError,
    ...providerRest
  } = props;

  const resolved = useResolvedServer(serverConfig, onError);

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
          <ChatProviderFromShell server={server} onError={onError} {...providerRest}>
            {layoutTree}
          </ChatProviderFromShell>
        </ShellModeProvider>
      </ServerProvider>
    </SlotsProvider>
  );
}
