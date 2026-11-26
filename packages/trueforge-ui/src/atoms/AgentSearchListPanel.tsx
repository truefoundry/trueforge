'use client';

import { useState } from 'react';

import type { AgentLibraryEntry } from '../server/types.js';
import { AgentSearchResultsList } from './AgentSearchResultsList.js';
import { cn } from './lib/cn.js';
import { useSearchAgentsList } from './lib/useSearchAgentsList.js';
import SearchInput from './primitives/SearchInput.js';

/** Figma agent picker panel: 204×260 list chrome. */
const PANEL_WIDTH_CLASS = 'w-[12.75rem]';
const LIST_MAX_HEIGHT_CLASS = 'max-h-[16.25rem]';

export type AgentSearchListPanelProps = {
  enabled: boolean;
  selectedAgentId?: string;
  onPick: (agent: AgentLibraryEntry) => void;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
};

/**
 * Search field + paginated agent list for submenu panels.
 * Same data path as AgentSearchPicker (`useSearchAgentsList`).
 */
export function AgentSearchListPanel({
  enabled,
  selectedAgentId,
  onPick,
  placeholder = 'Search agent...',
  className,
  'aria-label': ariaLabel = 'Agents',
}: AgentSearchListPanelProps) {
  const [query, setQuery] = useState('');
  const list = useSearchAgentsList({ enabled, query });

  return (
    <div className={cn('flex min-h-0 flex-col gap-2 p-2', PANEL_WIDTH_CLASS, className)}>
      <SearchInput
        query={query}
        setQuery={setQuery}
        placeholder={placeholder}
        // Keep focus on the Agents menuitem so ArrowUp can return to Assistant.
        autoFocus={false}
        // Figma: Weight 900, Solid, 12px; field colors from design.
        iconSize={12}
        iconClassName="left-2 size-3 font-[900] stroke-[2.5] text-[#82A0CE]"
        inputClassName={cn(
          'border-[#CEE0F8] bg-[#F0F7FF] pl-7 text-text-primary',
          'placeholder:text-[#5E7BAA]',
          'dark:border-gray-250 dark:bg-input-box-bg dark:placeholder:text-text-secondary/70',
        )}
      />
      <AgentSearchResultsList
        list={list}
        query={query}
        selectedAgentId={selectedAgentId}
        onPick={onPick}
        aria-label={ariaLabel}
        className={cn(LIST_MAX_HEIGHT_CLASS, 'text-text-primary')}
      />
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentSearchListPanel: typeof AgentSearchListPanel;
  }
}
