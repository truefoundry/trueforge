'use client';

import { useEffect, useState } from 'react';

import { useTrackAnalytics } from '../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../analytics/events.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalServer } from '../server/ServerContext.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import {
  auiButtonClass,
  shellRailSelectedClassName,
  sidebarButtonRadiusClassName,
  sidebarRailButtonClassName,
} from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';
import { SEARCH_AGENTS_PAGE_SIZE } from './lib/useSearchAgentsList.js';
import { ShellLink } from './primitives/ShellLink.js';
import { RailTooltip } from './primitives/Tooltip.js';

export type AgentsLibraryButtonProps = {
  className?: string;
  compact?: boolean;
};

export function AgentsLibraryButton({ className, compact = false }: AgentsLibraryButtonProps) {
  const server = useOptionalServer();
  const shell = useOptionalShellMode();
  const track = useTrackAnalytics();
  const [countLabel, setCountLabel] = useState<string | null>(null);

  const enabled = shell?.isLibraryEnabled === true && server != null;
  const libraryOpen = shell?.libraryOpen === true;
  const agentsListEpoch = shell?.agentsListEpoch ?? 0;

  useEffect(() => {
    // Compact rail has no count badge; skip the catalog request.
    if (!enabled || !server || compact) return;
    let cancelled = false;
    void server
      .searchAgents({ limit: SEARCH_AGENTS_PAGE_SIZE })
      .then(page => {
        if (cancelled) return;
        // API has no total; a next-page token means there may be more.
        setCountLabel(
          page.nextPageToken != null && page.nextPageToken !== ''
            ? `${SEARCH_AGENTS_PAGE_SIZE}+`
            : String(page.data.length),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled, server, agentsListEpoch, compact]);

  if (!enabled) return null;

  const control = (
    <ShellLink
      place={{ type: 'library' }}
      aria-label={compact ? 'Agents' : undefined}
      aria-current={libraryOpen ? 'page' : undefined}
      className={auiButtonClass({
        variant: 'ghost',
        className: cn(
          'font-normal shadow-none hover:bg-secondary-button-hover hover:text-ghost-button-text',
          compact
            ? cn(sidebarRailButtonClassName, 'text-inherit')
            : cn(sidebarButtonRadiusClassName, 'h-8 w-full !justify-start px-2.5 text-sm text-sidebar-text'),
          libraryOpen && shellRailSelectedClassName,
        ),
      })}
      onNavigate={() => {
        if (!libraryOpen) track(AnalyticsEvents.Library.OPENED);
        shell?.setLibraryOpen(true);
      }}
    >
      <Icon name="book-text" size={compact ? 16 : undefined} />
      {compact ? null : (
        <>
          <span className="truncate">
            Agents
            {countLabel != null ? (
              <span className={cn(!libraryOpen && 'text-text-secondary')}> ({countLabel})</span>
            ) : null}
          </span>
          <Icon name="chevron-right" className="ml-auto size-3.5 shrink-0 opacity-60" />
        </>
      )}
    </ShellLink>
  );

  return (
    <div className={cn('relative min-w-0', compact ? 'flex justify-center' : 'w-full', className)}>
      {compact ? <RailTooltip content="Agents">{control}</RailTooltip> : control}
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentsLibraryButton: typeof AgentsLibraryButton;
  }
}
