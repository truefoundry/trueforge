'use client';

import { useTrackAnalytics } from '../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../analytics/events.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalSandboxEnvironmentServer, useServerCapabilities } from '../server/ServerContext.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { isEnvironmentsChromeEnabled } from '../server/serverChrome.js';
import {
  auiButtonClass,
  shellRailSelectedClassName,
  sidebarButtonRadiusClassName,
  sidebarRailButtonClassName,
} from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';
import { ShellLink } from './primitives/ShellLink.js';
import { RailTooltip } from './primitives/Tooltip.js';

export type EnvironmentsButtonProps = {
  className?: string;
  compact?: boolean;
};

export function EnvironmentsButton({ className, compact = false }: EnvironmentsButtonProps) {
  const shell = useOptionalShellMode();
  const sandboxEnvironmentServer = useOptionalSandboxEnvironmentServer();
  const capabilities = useServerCapabilities();
  const track = useTrackAnalytics();

  const enabled =
    isEnvironmentsChromeEnabled({ sandboxEnvironments: sandboxEnvironmentServer, capabilities }) && shell != null;
  const open = shell?.environmentsOpen === true;

  if (!enabled || shell == null) return null;

  const control = (
    <ShellLink
      place={{ type: 'environments' }}
      aria-label={compact ? 'Environments' : undefined}
      aria-current={open ? 'page' : undefined}
      className={auiButtonClass({
        variant: 'ghost',
        className: cn(
          'font-normal shadow-none hover:bg-secondary-button-hover hover:text-ghost-button-text',
          compact
            ? cn(sidebarRailButtonClassName, 'text-inherit')
            : cn(sidebarButtonRadiusClassName, 'h-8 w-full !justify-start px-2.5 text-sm text-sidebar-text'),
          open && shellRailSelectedClassName,
        ),
      })}
      onNavigate={() => {
        if (!open) track(AnalyticsEvents.Environment.PAGE_OPENED);
        shell.setEnvironmentsOpen(!open);
      }}
    >
      <Icon name="monitor" size={compact ? 16 : undefined} />
      {compact ? null : (
        <>
          <span className="truncate">Environments</span>
          <Icon name="chevron-right" className="ml-auto size-3.5 shrink-0 opacity-60" />
        </>
      )}
    </ShellLink>
  );

  return (
    <div className={cn('relative min-w-0', compact ? 'flex justify-center' : 'w-full', className)}>
      {compact ? <RailTooltip content="Environments">{control}</RailTooltip> : control}
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    EnvironmentsButton: typeof EnvironmentsButton;
  }
}
