'use client';

import { useQuery } from '@tanstack/react-query';

import { useTrackAnalytics } from '../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../analytics/events.js';
import { Icon } from '../icons/Icon.js';
import { useServerQueryClient } from '../server/queryClient.js';
import { queryKeys } from '../server/queryKeys.js';
import { useOptionalServer } from '../server/ServerContext.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import {
  auiButtonClass,
  shellHoverClassName,
  shellRailSelectedClassName,
  shellSelectedClassName,
  sidebarButtonRadiusClassName,
  sidebarCompactNavButtonClassName,
} from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';
import { SEARCH_AGENTS_PAGE_SIZE } from './lib/useSearchAgentsList.js';
import { RailTooltip } from './primitives/Tooltip.js';

export type AgentsLibraryButtonProps = {
  className?: string;
  compact?: boolean;
};

export function AgentsLibraryButton({ className, compact = false }: AgentsLibraryButtonProps) {
  const server = useOptionalServer();
  const shell = useOptionalShellMode();
  const track = useTrackAnalytics();
  const queryClient = useServerQueryClient();

  const enabled = shell?.isLibraryEnabled === true && server != null;
  const libraryOpen = shell?.libraryOpen === true;

  // Same key as the library's first page, so opening the library reuses this response.
  const firstPageQuery = useQuery(
    {
      queryKey: queryKeys.agents.search({ limit: SEARCH_AGENTS_PAGE_SIZE }),
      queryFn: () =>
        server == null
          ? Promise.reject(new Error('Agent search requires a server.'))
          : server.searchAgents({ limit: SEARCH_AGENTS_PAGE_SIZE }),
      // Compact rail has no count badge; skip the catalog request.
      enabled: enabled && !compact,
    },
    queryClient,
  );
  const firstPage = firstPageQuery.data;
  // API has no total; a next-page token means there may be more.
  const countLabel =
    firstPage == null
      ? null
      : firstPage.nextPageToken != null && firstPage.nextPageToken !== ''
        ? `${SEARCH_AGENTS_PAGE_SIZE}+`
        : String(firstPage.data.length);

  if (!enabled) return null;

  const button = (
    <button
      type="button"
      aria-label={compact ? 'Agents' : undefined}
      aria-current={libraryOpen ? 'page' : undefined}
      className={auiButtonClass({
        variant: 'ghost',
        className: cn(
          'font-normal shadow-none',
          compact
            ? sidebarCompactNavButtonClassName
            : cn(
                sidebarButtonRadiusClassName,
                'h-8 w-full !justify-start px-2.5 text-sm text-sidebar-text',
                shellHoverClassName,
              ),
          libraryOpen && (compact ? shellRailSelectedClassName : shellSelectedClassName),
        ),
      })}
      onClick={() => {
        if (!libraryOpen) track(AnalyticsEvents.Library.OPENED);
        shell?.setLibraryOpen(true);
      }}
    >
      <Icon name="agent-2" />
      {compact ? null : (
        <span className="truncate">
          Agents
          {countLabel != null ? (
            <span className={cn(!libraryOpen && 'text-text-secondary')}> ({countLabel})</span>
          ) : null}
        </span>
      )}
    </button>
  );

  return (
    <div className={cn('relative min-w-0', compact ? 'flex justify-center' : 'w-full', className)}>
      {compact ? <RailTooltip content="Agents">{button}</RailTooltip> : button}
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentsLibraryButton: typeof AgentsLibraryButton;
  }
}
