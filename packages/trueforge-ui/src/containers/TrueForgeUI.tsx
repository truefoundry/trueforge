'use client';

import { lazy, Suspense, type ComponentType } from 'react';

import { SlotsProvider } from '../theme/SlotsProvider.js';
import PostMcpOauthScreen from './McpOauthContainer/PostMcpOauthScreen.js';
import { ServerInitLoader, TrueForgeUIShell, type TrueForgeUIProps } from './TrueForgeUIShell.js';

export type { RoutePlace, RoutesConfig } from '../routing/types.js';
export type { AgentConfig } from '../server/ShellModeContext.js';
export type { TrueForgeBuiltInServerConfig, TrueForgeServerConfig } from '../server/TrueForgeServerConfig.js';
export type { LayoutProp } from '../theme/types.js';
export type { ChatLayout, TrueForgeUIProps } from './TrueForgeUIShell.js';

// Lazy so `react-router` stays out of the base bundle unless `withRouter` is set.
const TrueForgeUIWithRouter = lazy<ComponentType<Omit<TrueForgeUIProps, 'withRouter'>>>(() =>
  import('./TrueForgeUIWithRouter.js').then(m => ({ default: m.TrueForgeUIWithRouter })),
);

/**
 * Quick-start assistant UI: slots + runtime + a built-in or custom layout.
 * Pass a built-in `server` config, a ready `AgentUIServer`, and optional `agentConfig`.
 */
export function TrueForgeUI(props: TrueForgeUIProps) {
  const isMcpAuthScreen =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('screenType') === 'mcp-auth';

  // The callback skips server resolution but still inherits host theme and slots.
  if (isMcpAuthScreen) {
    return (
      <SlotsProvider overrides={props.overrides} theme={props.theme}>
        <PostMcpOauthScreen />
      </SlotsProvider>
    );
  }

  const { withRouter, ...rest } = props;
  if (withRouter) {
    return (
      <Suspense fallback={<ServerInitLoader className={props.className} />}>
        <TrueForgeUIWithRouter {...rest} />
      </Suspense>
    );
  }
  return <TrueForgeUIShell {...rest} />;
}
