'use client';

import { Icon } from '../icons/Icon.js';
import { libraryAgentId } from '../server/ShellModeContext.js';
import type { AgentLibraryEntry } from '../server/types.js';
import { cn } from './lib/cn.js';
import { auiSelectOptionClass } from './lib/selectClasses.js';
import type { UseSearchAgentsListResult } from './lib/useSearchAgentsList.js';

export type AgentSearchResultsListProps = {
  list: Pick<
    UseSearchAgentsListResult,
    'agents' | 'isInitialLoading' | 'isSearching' | 'loadingMore' | 'hasMore' | 'error' | 'listRef' | 'sentinelRef'
  >;
  query: string;
  selectedAgentId?: string;
  onPick: (agent: AgentLibraryEntry) => void;
  listboxId?: string;
  'aria-label'?: string;
  className?: string;
  /** Optional row above results while the query is empty (e.g. filter "All agents"). */
  allOption?: { value: string; label: string; selected: boolean; onPick: () => void };
};

/**
 * Shared scrollable agent rows for AgentSearchPicker and the composer Agents submenu.
 * Callers own `useSearchAgentsList` so open/enabled and query state stay local.
 */
export function AgentSearchResultsList({
  list,
  query,
  selectedAgentId,
  onPick,
  listboxId,
  'aria-label': ariaLabel = 'Agents',
  className,
  allOption,
}: AgentSearchResultsListProps) {
  const { agents, isInitialLoading, isSearching, loadingMore, hasMore, error, listRef, sentinelRef } = list;
  const queryTrimmed = query.trim();
  const showError = !isInitialLoading && error != null;
  const showEmptyCatalog = !isInitialLoading && error == null && agents.length === 0 && queryTrimmed === '';
  const showNoMatch = !isInitialLoading && error == null && agents.length === 0 && queryTrimmed !== '';

  return (
    <div
      ref={listRef}
      id={listboxId}
      role="listbox"
      aria-label={ariaLabel}
      className={cn('min-h-0 flex-1 overflow-y-auto p-1', className)}
    >
      {allOption != null && queryTrimmed === '' ? (
        <button
          type="button"
          role="option"
          aria-selected={allOption.selected}
          className={auiSelectOptionClass()}
          onClick={allOption.onPick}
        >
          <span className="min-w-0 flex-1 truncate">{allOption.label}</span>
          <Icon
            name="check"
            className={cn('ml-auto size-4 shrink-0', allOption.selected ? 'opacity-100' : 'opacity-0')}
          />
        </button>
      ) : null}
      {isInitialLoading ? (
        <p className="text-text-secondary px-3 py-5 text-center text-sm" role="status">
          Loading…
        </p>
      ) : showError ? (
        <p className="text-failure-bg px-3 py-5 text-center text-sm" role="alert">
          {error}
        </p>
      ) : showEmptyCatalog ? (
        <p className="text-text-secondary px-3 py-5 text-center text-sm">No Agents created yet</p>
      ) : showNoMatch ? (
        <p className="text-text-secondary px-3 py-5 text-center text-sm" role="status">
          No agents match &quot;{queryTrimmed}&quot;.
        </p>
      ) : (
        <>
          {isSearching ? (
            <p className="sr-only" role="status">
              Searching…
            </p>
          ) : null}
          {agents.map(agent => {
            const id = libraryAgentId(agent);
            const selected = selectedAgentId === id;
            return (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={selected}
                className={auiSelectOptionClass()}
                onClick={() => onPick(agent)}
              >
                <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                <Icon name="check" className={cn('ml-auto size-4 shrink-0', selected ? 'opacity-100' : 'opacity-0')} />
              </button>
            );
          })}
          {hasMore ? (
            <div ref={sentinelRef} className="flex h-6 shrink-0 items-center justify-center" aria-hidden>
              {loadingMore ? (
                <span className="text-text-secondary text-[0.6875rem]" role="status">
                  Loading more…
                </span>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
