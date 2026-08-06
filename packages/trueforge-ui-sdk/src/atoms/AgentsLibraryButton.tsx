'use client';

import { useEffect, useState } from 'react';

import { Icon } from '../icons/Icon.js';
import { useOptionalServer } from '../server/ServerContext.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { AgentsLibrary } from './AgentsLibrary.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';

export type AgentsLibraryButtonProps = {
  className?: string;
  compact?: boolean;
  onSelectAgent?: (agentName: string) => void;
};

export function AgentsLibraryButton({ className, compact = false, onSelectAgent }: AgentsLibraryButtonProps) {
  const server = useOptionalServer();
  const shell = useOptionalShellMode();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState<number | null>(null);

  const enabled = shell?.isLibraryEnabled === true && server != null;

  useEffect(() => {
    if (!enabled || !server) return;
    let cancelled = false;
    void server
      .searchAgents({ limit: 50 })
      .then(rows => {
        if (!cancelled) setCount(rows.length);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled, server]);

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
              'h-8 rounded-md text-sm font-medium text-foreground shadow-none hover:bg-accent hover:text-accent-foreground',
              compact ? 'w-8 !justify-center p-0' : 'w-full !justify-start px-2.5',
              open && 'bg-accent text-accent-foreground',
            ),
          })}
          onClick={() => setOpen(true)}
        >
          <Icon name="robot" />
          {!compact ? (
            <>
              <span className="truncate">
                Agents Library
                {count != null ? <span className="text-muted-foreground"> ({count})</span> : null}
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
