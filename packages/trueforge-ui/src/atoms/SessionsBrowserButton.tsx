'use client';

import { useTrackAnalytics } from '../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../analytics/events.js';
import { useSessionShareSearch } from '../hooks/useSessionShareSearch.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalAgentSessionsServer } from '../server/ServerContext.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { isSessionsChromeEnabled } from '../server/serverChrome.js';
import { defaultSessionTimeRange, readSessionShareSearch } from '../utils/sessionShareUrl.js';
import {
  auiButtonClass,
  shellRailSelectedClassName,
  sidebarButtonRadiusClassName,
  sidebarRailButtonClassName,
} from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';
import { RailTooltip } from './primitives/Tooltip.js';

export type SessionsBrowserButtonProps = {
  className?: string;
  compact?: boolean;
};

export function SessionsBrowserButton({ className, compact = false }: SessionsBrowserButtonProps) {
  const sessionsServer = useOptionalAgentSessionsServer();
  const shell = useOptionalShellMode();
  const track = useTrackAnalytics();
  const { updateShareSearch } = useSessionShareSearch();
  const sessionsOpen = shell?.sessionsOpen === true;
  const enabled = isSessionsChromeEnabled({ sessions: sessionsServer }) && shell != null;

  if (!enabled) return null;

  const button = (
    <button
      type="button"
      aria-label={compact ? 'Sessions' : undefined}
      aria-current={sessionsOpen ? 'page' : undefined}
      className={auiButtonClass({
        variant: 'ghost',
        className: cn(
          'font-normal shadow-none hover:bg-secondary-button-hover hover:text-ghost-button-text',
          compact
            ? cn(sidebarRailButtonClassName, 'text-inherit')
            : cn(sidebarButtonRadiusClassName, 'h-8 w-full !justify-start px-2.5 text-sm text-sidebar-text'),
          sessionsOpen && shellRailSelectedClassName,
        ),
      })}
      onClick={() => {
        if (!sessionsOpen) {
          track(AnalyticsEvents.SessionsBrowser.OPENED);
          const share = readSessionShareSearch(window.location.search);
          updateShareSearch({
            view: 'sessions',
            agentId: null,
            sessionId: null,
            timeRange: share.timeRange ?? defaultSessionTimeRange(),
          });
        }
        shell.setSessionsOpen(true);
      }}
    >
      <Icon name="message-square-text" size={compact ? 16 : undefined} />
      {compact ? null : (
        <>
          <span className="truncate">Sessions</span>
          <Icon name="chevron-right" className="ml-auto size-3.5 shrink-0 opacity-60" />
        </>
      )}
    </button>
  );

  return (
    <div className={cn('relative min-w-0', compact ? 'flex justify-center' : 'w-full', className)}>
      {compact ? <RailTooltip content="Sessions">{button}</RailTooltip> : button}
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    SessionsBrowserButton: typeof SessionsBrowserButton;
  }
}
