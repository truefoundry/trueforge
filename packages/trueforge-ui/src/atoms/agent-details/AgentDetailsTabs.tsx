'use client';

import { Icon } from '../../icons/Icon.js';
import { cn } from '../lib/cn.js';
import type { AgentDetailsTab, AgentDetailsTabsProps } from './types.js';

const tabs: Array<{ id: AgentDetailsTab; label: string; icon: string }> = [
  { id: 'overview', label: 'Overview', icon: 'info' },
  { id: 'sessions', label: 'Sessions', icon: 'message-square-text' },
  { id: 'code', label: 'Use In Code', icon: 'code' },
  { id: 'metrics', label: 'Metrics', icon: 'chart' },
];

export function AgentDetailsTabs({ activeTab, onTabChange, showMetrics = false }: AgentDetailsTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Agent details"
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-primary-bg px-3"
    >
      {tabs
        .filter(tab => tab.id !== 'metrics' || showMetrics)
        .map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-current={activeTab === tab.id ? 'page' : undefined}
            className={cn(
              'relative flex h-10 shrink-0 cursor-pointer items-center gap-1.5 px-2 text-xs font-medium text-text-secondary',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring',
              activeTab === tab.id &&
                'text-primary-button-bg after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary-button-bg',
            )}
            onClick={() => onTabChange(tab.id)}
          >
            <Icon name={tab.icon} className="size-3.5" />
            {tab.label}
          </button>
        ))}
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentDetailsTabs: typeof AgentDetailsTabs;
  }
}
