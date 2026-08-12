'use client';

import { useEffect, useState } from 'react';

import { Icon } from '../icons/Icon.js';
import { libraryAgentId, useOptionalShellMode } from '../server/ShellModeContext.js';
import type { AgentLibraryEntry, AgentSpec } from '../server/types.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';
import { useCompactLayout } from './lib/CompactLayoutContext.js';
import { useSearchAgentsList } from './lib/useSearchAgentsList.js';
import { CenteredModal } from './primitives/CenteredModal.js';
import SearchInput from './primitives/SearchInput.js';
import { Skeleton } from './primitives/Skeleton.js';

export type AgentsLibraryProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectAgent?: (agentName: string) => void;
};

type AgentLibraryRowProps = {
  agent: AgentLibraryEntry;
  showEdit: boolean;
  onTry: () => void;
  onEdit: () => void;
};

function rowActionClass(compact: boolean) {
  return cn(
    'shrink-0 opacity-100 transition-opacity',
    !compact && 'md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100',
    'focus-visible:opacity-100',
  );
}

function AgentLibraryRow({ agent, showEdit, onTry, onEdit }: AgentLibraryRowProps) {
  const compact = useCompactLayout();

  return (
    <div
      role="menuitem"
      className={cn(
        'group flex w-full items-center gap-2.5 rounded-md border border-transparent px-2.5 py-2 transition-colors',
        'hover:border-border hover:bg-ghost-button-hover',
        'focus-within:border-border focus-within:bg-ghost-button-hover',
      )}
    >
      <span className="bg-primary-bg text-text-secondary inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border">
        <Icon name="robot" className="size-4" />
      </span>
      <span className="text-text-primary min-w-0 flex-1 truncate text-left text-sm font-medium leading-tight">
        {agent.name}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {showEdit ? (
          <button
            type="button"
            aria-label={`Edit agent ${agent.name}`}
            className={auiButtonClass({
              variant: 'ghost',
              size: 'sm',
              className: rowActionClass(compact),
            })}
            onClick={onEdit}
          >
            <Icon name="pencil" className="size-3.5" />
            Edit
          </button>
        ) : null}
        <button
          type="button"
          aria-label={`Try agent ${agent.name}`}
          className={auiButtonClass({
            variant: 'outline',
            size: 'sm',
            className: rowActionClass(compact),
          })}
          onClick={onTry}
        >
          <Icon name="play" className="size-3.5" />
          Try
        </button>
      </span>
    </div>
  );
}

export function AgentsLibrary({ open, onOpenChange, onSelectAgent }: AgentsLibraryProps) {
  const shell = useOptionalShellMode();
  const [query, setQuery] = useState('');

  const canEdit = shell?.isComposerEnabled === true;
  const agentsListEpoch = shell?.agentsListEpoch ?? 0;

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const { agents, isInitialLoading, isSearching, loadingMore, error, hasMore, listRef, sentinelRef } =
    useSearchAgentsList({
      enabled: open,
      query,
      refreshKey: agentsListEpoch,
    });

  const closeLibrary = () => {
    onOpenChange(false);
    setQuery('');
  };

  const handleTry = (agent: AgentLibraryEntry) => {
    closeLibrary();
    onSelectAgent?.(agent.name);
    shell?.selectLibraryAgent({
      isMutable: false,
      agentId: libraryAgentId(agent),
      agentName: agent.name,
    });
  };

  const handleEdit = (agent: AgentLibraryEntry, agentSpec: AgentSpec) => {
    closeLibrary();
    onSelectAgent?.(agent.name);
    shell?.selectLibraryAgent({
      isMutable: true,
      agentId: libraryAgentId(agent),
      agentName: agent.name,
      agentSpec,
    });
  };

  return (
    <CenteredModal open={open} onOpenChange={onOpenChange} title="Agents Library">
      <div className="bg-secondary-bg/40 flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border px-4 py-3">
          <SearchInput query={query} setQuery={setQuery} placeholder="Search agents" />
          {isSearching ? (
            <p className="text-text-secondary mt-1.5 text-xs" role="status">
              Searching…
            </p>
          ) : null}
        </div>
        <div
          ref={listRef}
          className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2"
          role="menu"
          aria-label="Agents"
        >
          {isInitialLoading ? (
            <div className="flex flex-col gap-2 p-1" role="status" aria-label="Loading agents">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-11 w-full rounded-md" />
              ))}
            </div>
          ) : error ? (
            <p className="text-failure-bg px-3 py-8 text-center text-sm">{error}</p>
          ) : agents.length === 0 ? (
            <p className="text-text-secondary px-3 py-8 text-center text-sm">
              {query.trim()
                ? `No agents match "${query.trim()}".`
                : 'No agents yet. Build one in a chat, then save it as an agent.'}
            </p>
          ) : (
            <>
              {agents.map(agent => {
                const agentSpec = agent.agentSpec;
                const showEdit = canEdit && agentSpec != null;
                return (
                  <AgentLibraryRow
                    key={libraryAgentId(agent)}
                    agent={agent}
                    showEdit={showEdit}
                    onTry={() => handleTry(agent)}
                    onEdit={() => {
                      if (agentSpec != null) handleEdit(agent, agentSpec);
                    }}
                  />
                );
              })}
              {hasMore ? (
                <div ref={sentinelRef} className="flex h-8 shrink-0 items-center justify-center" aria-hidden>
                  {loadingMore ? (
                    <span className="text-text-secondary text-xs" role="status">
                      Loading more…
                    </span>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </CenteredModal>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentsLibrary: typeof AgentsLibrary;
  }
}
