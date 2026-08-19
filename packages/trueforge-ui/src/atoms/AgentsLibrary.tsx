'use client';

import { useEffect, useState } from 'react';

import { Icon } from '../icons/Icon.js';
import { libraryAgentId, useOptionalShellMode } from '../server/ShellModeContext.js';
import type { AgentLibraryEntry, AgentSpec } from '../server/types.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';
import { useSearchAgentsList } from './lib/useSearchAgentsList.js';
import { CenteredModal } from './primitives/CenteredModal.js';
import SearchInput from './primitives/SearchInput.js';
import { Skeleton } from './primitives/Skeleton.js';
import { Tooltip } from './primitives/Tooltip.js';

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

/** Short label for model fqns like `provider/gpt-4.1` → `gpt-4.1`. */
function displayModelLabel(modelName: string): string {
  const slash = modelName.lastIndexOf('/');
  return slash >= 0 ? modelName.slice(slash + 1) : modelName;
}

function AgentLibraryRow({ agent, showEdit, onTry, onEdit }: AgentLibraryRowProps) {
  const spec = agent.agentSpec;
  const modelName = spec?.model.name;
  const skillsCount = spec?.skills?.length ?? 0;
  const mcpCount = spec?.mcpServers?.length ?? 0;
  const skillNames = (spec?.skills ?? []).map(s => (s as { name?: string }).name).filter(Boolean);
  const mcpNames = (spec?.mcpServers ?? []).map(m => (m as { name?: string }).name).filter(Boolean);
  const connectorsTitle = mcpNames.length ? `Connectors: ${mcpNames.join(', ')}` : `${mcpCount} connectors`;
  const skillsTitle = skillNames.length ? `Skills: ${skillNames.join(', ')}` : `${skillsCount} skills`;

  return (
    <div
      role="menuitem"
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md border border-transparent px-2.5 py-2 transition-colors',
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
      {spec != null ? (
        <span className="text-text-secondary flex shrink-0 items-center gap-2">
          {modelName ? (
            <span className="bg-primary-button-bg/10 text-primary-button-bg inline-flex max-w-[8rem] items-center gap-1 truncate rounded-full px-2 py-0.5 text-xs font-medium">
              <Icon name="cpu" className="size-3.5 shrink-0" />
              <span className="truncate">{displayModelLabel(modelName)}</span>
            </span>
          ) : null}
          <Tooltip content={connectorsTitle}>
            <span className="inline-flex items-center gap-1 text-xs" aria-label={connectorsTitle}>
              <Icon name="plug" className="size-3.5" />
              {mcpCount}
            </span>
          </Tooltip>
          <Tooltip content={skillsTitle}>
            <span className="inline-flex items-center gap-1 text-xs" aria-label={skillsTitle}>
              <Icon name="lightbulb" className="size-3.5" />
              {skillsCount}
            </span>
          </Tooltip>
        </span>
      ) : null}
      <span className="flex shrink-0 items-center gap-1.5">
        {showEdit ? (
          <button
            type="button"
            aria-label={`Edit agent ${agent.name}`}
            className={auiButtonClass({
              variant: 'ghost',
              size: 'sm',
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
