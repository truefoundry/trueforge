'use client';

import { useEffect, useState } from 'react';

import { Icon } from '../icons/Icon.js';
import { useOptionalServer } from '../server/ServerContext.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import type { AgentLibraryEntry } from '../server/types.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';
import { useCompactLayout } from './lib/CompactLayoutContext.js';
import { CenteredModal } from './primitives/CenteredModal.js';
import { Skeleton } from './primitives/Skeleton.js';

export type AgentsLibraryProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectAgent?: (agentName: string) => void;
};

function AgentLibraryRow({ agent, onSelect }: { agent: AgentLibraryEntry; onSelect: () => void }) {
  const compact = useCompactLayout();

  return (
    <div
      role="menuitem"
      className={cn(
        'group flex w-full items-center gap-2.5 rounded-md border border-transparent px-2.5 py-2 transition-colors',
        'hover:border-border hover:bg-accent',
        'focus-within:border-border focus-within:bg-accent',
      )}
    >
      <span className="bg-background text-muted-foreground inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border">
        <Icon name="robot" className="size-4" />
      </span>
      <span className="text-foreground min-w-0 flex-1 truncate text-left text-sm font-medium leading-tight">
        {agent.name}
      </span>
      <button
        type="button"
        aria-label={`Try agent ${agent.name}`}
        className={auiButtonClass({
          variant: 'outline',
          size: 'sm',
          className: cn(
            'shrink-0 opacity-100 transition-opacity',
            !compact && 'md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100',
            'focus-visible:opacity-100',
          ),
        })}
        onClick={onSelect}
      >
        Try Agent
      </button>
    </div>
  );
}

export function AgentsLibrary({ open, onOpenChange, onSelectAgent }: AgentsLibraryProps) {
  const server = useOptionalServer();
  const shell = useOptionalShellMode();
  const [query, setQuery] = useState('');
  const [agents, setAgents] = useState<AgentLibraryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    if (!server) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void server
      .searchAgents({ query: query.trim() || undefined, limit: 50 })
      .then(rows => {
        if (!cancelled) setAgents(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load agents.');
          setAgents([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, query, server]);

  const handleSelect = (name: string) => {
    onOpenChange(false);
    setQuery('');
    onSelectAgent?.(name);
    shell?.selectAgent(name);
  };

  return (
    <CenteredModal open={open} onOpenChange={onOpenChange} title="Agents Library">
      {/*
        Single-pane layout modeled on the MCP tools modal's left column
        (search + icon rows). Detail columns need fields beyond AgentLibraryEntry.
      */}
      <div className="bg-muted/40 flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border px-4 py-3">
          <label className="relative block">
            <Icon
              name="search"
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
            />
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search agents"
              className="border-input bg-background placeholder:text-muted-foreground h-9 w-full rounded-md border py-1 pr-3 pl-8 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              autoFocus
            />
          </label>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2" role="menu" aria-label="Agents">
          {loading ? (
            <div className="flex flex-col gap-2 p-1" role="status" aria-label="Loading agents">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-11 w-full rounded-md" />
              ))}
            </div>
          ) : error ? (
            <p className="text-destructive px-3 py-8 text-center text-sm">{error}</p>
          ) : agents.length === 0 ? (
            <p className="text-muted-foreground px-3 py-8 text-center text-sm">No agents found</p>
          ) : (
            agents.map(agent => (
              <AgentLibraryRow key={agent.name} agent={agent} onSelect={() => handleSelect(agent.name)} />
            ))
          )}
        </div>
      </div>
    </CenteredModal>
  );
}
