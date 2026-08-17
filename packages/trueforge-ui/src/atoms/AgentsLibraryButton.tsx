'use client';

import { useEffect, useState } from 'react';

import { Icon } from '../icons/Icon.js';
import { useOptionalServer } from '../server/ServerContext.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';
import { SEARCH_AGENTS_PAGE_SIZE } from './lib/useSearchAgentsList.js';

export type AgentsLibraryButtonProps = {
  className?: string;
  compact?: boolean;
  onSelectAgent?: (agentName: string) => void;
};

export function AgentsLibraryButton({ className, compact = false, onSelectAgent }: AgentsLibraryButtonProps) {
  const AgentsLibrary = useSlot('AgentsLibrary');
  const server = useOptionalServer();
  const shell = useOptionalShellMode();
  const [open, setOpen] = useState(false);
  const [countLabel, setCountLabel] = useState<string | null>(null);

  const enabled = shell?.isLibraryEnabled === true && server != null;
  const agentsListEpoch = shell?.agentsListEpoch ?? 0;

  useEffect(() => {
    // Compact trigger has no count badge; skip so SidebarLayout can keep both
    // collapsed + expanded trees mounted without a duplicate catalog request.
    if (!enabled || !server || compact) return;
    let cancelled = false;
    void server
      .searchAgents({ limit: SEARCH_AGENTS_PAGE_SIZE })
      .then(rows => {
        if (cancelled) return;
        // API has no total; a full page means there may be more.
        setCountLabel(rows.length >= SEARCH_AGENTS_PAGE_SIZE ? `${SEARCH_AGENTS_PAGE_SIZE}+` : String(rows.length));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled, server, agentsListEpoch, compact]);

  if (!enabled) return null;

  return (
    <>
      <div className={cn('relative min-w-0', compact ? 'w-8' : 'w-full', className)}>
        <button
          type="button"
          aria-label={compact ? 'Agents Library' : undefined}
          title={compact ? 'Agents Library' : undefined}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={auiButtonClass({
            variant: 'ghost',
            className: cn(
              'h-8 rounded-md text-sm font-medium text-text-primary shadow-none hover:bg-ghost-button-hover hover:text-ghost-button-text',
              compact ? 'w-8 !justify-center p-0' : 'w-full !justify-start px-2.5',
              open && 'bg-dropdown-selected-item-bg text-dropdown-selected-item-text',
            ),
          })}
          onClick={() => setOpen(true)}
        >
          <Icon name="robot" />
          {!compact ? (
            <>
              <span className="truncate">
                Agents Library
                {countLabel != null ? <span className="text-text-secondary"> ({countLabel})</span> : null}
              </span>
              <Icon name="chevron-right" className="ml-auto size-3.5 shrink-0 opacity-60" />
            </>
          ) : null}
        </button>
      </div>
      <AgentsLibrary open={open} onOpenChange={setOpen} onSelectAgent={onSelectAgent} />
    </>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentsLibraryButton: typeof AgentsLibraryButton;
  }
}
