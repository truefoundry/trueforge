'use client';

import { useSessionShareSearch } from '../hooks/useSessionShareSearch.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalAgentSessionsServer } from '../server/ServerContext.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { defaultSessionTimeRange, readSessionShareSearch } from '../utils/sessionShareUrl.js';
import { cn } from './lib/cn.js';
import { Button } from './primitives/Button.js';

export type SessionsBrowserButtonProps = {
  className?: string;
  compact?: boolean;
};

export function SessionsBrowserButton({ className, compact = false }: SessionsBrowserButtonProps) {
  const sessionsServer = useOptionalAgentSessionsServer();
  const shell = useOptionalShellMode();
  const { updateShareSearch } = useSessionShareSearch();
  const sessionsOpen = shell?.sessionsOpen === true;

  if (sessionsServer == null || shell == null) return null;

  return (
    <div className={cn('relative min-w-0', compact ? 'w-8' : 'w-full', className)}>
      <Button.Ghost
        type="button"
        aria-label={compact ? 'Sessions' : undefined}
        title={compact ? 'Sessions' : undefined}
        aria-current={sessionsOpen ? 'page' : undefined}
        className={cn(
          'h-8 rounded-md text-sm font-medium text-text-primary shadow-none hover:bg-ghost-button-hover hover:text-ghost-button-text',
          compact ? 'w-8 !justify-center p-0' : 'w-full !justify-start px-2.5',
          sessionsOpen && 'bg-dropdown-selected-item-bg text-dropdown-selected-item-text',
        )}
        onClick={() => {
          if (!sessionsOpen) {
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
        <Icon name="clock-rotate-left" />
        {!compact ? (
          <>
            <span className="truncate">Sessions</span>
            <Icon name="chevron-right" className="ml-auto size-3.5 shrink-0 opacity-60" />
          </>
        ) : null}
      </Button.Ghost>
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    SessionsBrowserButton: typeof SessionsBrowserButton;
  }
}
