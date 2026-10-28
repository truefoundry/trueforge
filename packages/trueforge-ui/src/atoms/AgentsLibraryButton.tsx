'use client';

import { useQuery } from '@tanstack/react-query';

import { useTrackAnalytics } from '../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../analytics/events.js';
import { Icon } from '../icons/Icon.js';
import { useServerQueryClient } from '../server/queryClient.js';
import { queryKeys } from '../server/queryKeys.js';
import { useOptionalServer } from '../server/ServerContext.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { auiButtonClass, sidebarButtonRadiusClassName, sidebarRailButtonClassName } from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';
import { SEARCH_AGENTS_PAGE_SIZE } from './lib/useSearchAgentsList.js';

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

  return (
    <div className={cn('relative min-w-0', compact ? 'flex justify-center' : 'w-full', className)}>
      <button
        type="button"
        aria-label={compact ? 'Agents' : undefined}
        title={compact ? 'Agents' : undefined}
        aria-current={libraryOpen ? 'page' : undefined}
        className={auiButtonClass({
          variant: 'ghost',
          className: cn(
            sidebarButtonRadiusClassName,
            'font-normal text-sidebar-text shadow-none hover:bg-secondary-button-hover hover:text-ghost-button-text',
            compact ? sidebarRailButtonClassName : 'h-8 w-full !justify-start px-2.5 text-sm',
            libraryOpen &&
              'bg-primary-button-bg font-medium text-primary-button-text hover:bg-primary-button-hover hover:text-primary-button-text',
          ),
        })}
        onClick={() => {
          if (!libraryOpen) track(AnalyticsEvents.Library.OPENED);
          shell?.setLibraryOpen(true);
        }}
      >
        <Icon name="library-big" size={compact ? 14 : undefined} />
        {compact ? (
          <span className="text-center">Agents</span>
        ) : (
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
      </button>
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentsLibraryButton: typeof AgentsLibraryButton;
  }
}
