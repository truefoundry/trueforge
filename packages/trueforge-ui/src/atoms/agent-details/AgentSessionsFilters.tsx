'use client';

import { useEffect, useRef, useState } from 'react';

import { useOptionalServer } from '../../server/ServerContext.js';
import { useOptionalShellMode } from '../../server/ShellModeContext.js';
import type { AgentBuilderServer, AgentLibraryEntry } from '../../server/types.js';
import { SESSION_CUSTOM_RANGE_MAX_DAYS, type SessionTimeRange } from '../../utils/sessionShareUrl.js';
import {
  formatSessionTimePresetLabel,
  formatTimezoneOffsetLabel,
  fromDateTimeLocalValue,
  SESSION_TIME_PRESETS,
  toDateTimeLocalValue,
} from '../../utils/sessionTimePresets.js';
import { cn } from '../lib/cn.js';
import { SEARCH_AGENTS_PAGE_SIZE } from '../lib/useSearchAgentsList.js';

async function searchAllAgents(
  server: Pick<AgentBuilderServer, 'searchAgents'>,
  offset = 0,
): Promise<AgentLibraryEntry[]> {
  const rows = await server.searchAgents({ limit: SEARCH_AGENTS_PAGE_SIZE, offset });
  if (rows.length < SEARCH_AGENTS_PAGE_SIZE) return rows;
  return [...rows, ...(await searchAllAgents(server, offset + rows.length))];
}

export type AgentSessionsFiltersProps = {
  agentId: string | null;
  timeRange: SessionTimeRange;
  onAgentChange: (agentId: string | null) => void;
  onTimeRangeChange: (range: SessionTimeRange) => void;
};

export function AgentSessionsFilters({
  agentId,
  timeRange,
  onAgentChange,
  onTimeRangeChange,
}: AgentSessionsFiltersProps) {
  const server = useOptionalServer();
  const shell = useOptionalShellMode();
  const [agents, setAgents] = useState<AgentLibraryEntry[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [customPickerOpen, setCustomPickerOpen] = useState(false);
  const [fromValue, setFromValue] = useState(() => toDateTimeLocalValue(timeRange.startTs));
  const [toValue, setToValue] = useState(() => toDateTimeLocalValue(timeRange.endTs));
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (server == null) return undefined;
    let cancelled = false;
    void searchAllAgents(server).then(
      rows => {
        if (!cancelled) setAgents(rows);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [server, shell?.agentsListEpoch]);

  useEffect(() => {
    setFromValue(toDateTimeLocalValue(timeRange.startTs));
    setToValue(toDateTimeLocalValue(timeRange.endTs));
  }, [timeRange.endTs, timeRange.startTs]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (popoverRef.current?.contains(event.target as Node) !== true) {
        setMenuOpen(false);
        setCustomPickerOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      setCustomPickerOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const timeLabel =
    timeRange.timeWindowMs != null
      ? (formatSessionTimePresetLabel(timeRange.timeWindowMs) ?? 'Custom Time Range')
      : 'Custom Time Range';

  const applyCustom = () => {
    const startTs = fromDateTimeLocalValue(fromValue);
    const endTs = fromDateTimeLocalValue(toValue);
    if (startTs == null || endTs == null || startTs >= endTs) return;
    const minStart = Date.now() - SESSION_CUSTOM_RANGE_MAX_DAYS * 24 * 60 * 60 * 1000;
    const clampedStartTs = Math.max(startTs, minStart);
    if (clampedStartTs >= endTs) return;
    onTimeRangeChange({ startTs: clampedStartTs, endTs });
    setMenuOpen(false);
    setCustomPickerOpen(false);
  };

  return (
    <div className="flex min-w-0 items-center gap-2">
      <label className="flex items-center gap-1 text-xs text-text-secondary">
        Agents
        <select
          aria-label="Filter sessions by agent"
          className="h-8 max-w-36 rounded-md border border-border bg-primary-bg px-2 text-xs text-text-primary"
          value={agentId ?? ''}
          onChange={event => onAgentChange(event.target.value.length === 0 ? null : event.target.value)}
        >
          <option value="">All</option>
          {agents.map(agent => {
            const id = agent.agentId ?? agent.name;
            return (
              <option key={id} value={id}>
                {agent.name}
              </option>
            );
          })}
        </select>
      </label>
      <div className="relative" ref={popoverRef}>
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-haspopup="listbox"
          className="h-8 min-w-36 rounded-md border border-border bg-primary-bg px-2 text-left text-xs text-text-primary"
          onClick={() => {
            setMenuOpen(open => {
              if (open) setCustomPickerOpen(false);
              return !open;
            });
          }}
        >
          {timeLabel}
        </button>
        {menuOpen ? (
          <div className="absolute right-0 z-20 mt-1 flex overflow-hidden rounded-md border border-border bg-card-bg shadow-md">
            {customPickerOpen ? (
              <div className="flex w-64 min-w-0 flex-col gap-2 border-r border-border p-3">
                <div className="text-sm font-medium text-text-primary">Select Time Range</div>
                <p className="text-xs text-text-secondary">{`You can select time for last ${String(SESSION_CUSTOM_RANGE_MAX_DAYS)} days`}</p>
                <label className="flex flex-col gap-1 text-xs text-text-secondary">
                  From
                  <input
                    type="datetime-local"
                    step="1"
                    className="h-8 rounded-md border border-border bg-primary-bg px-2 text-xs text-text-primary"
                    value={fromValue}
                    onChange={event => setFromValue(event.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-text-secondary">
                  To
                  <input
                    type="datetime-local"
                    step="1"
                    className="h-8 rounded-md border border-border bg-primary-bg px-2 text-xs text-text-primary"
                    value={toValue}
                    onChange={event => setToValue(event.target.value)}
                  />
                </label>
                <p className="text-xs text-text-secondary">
                  Timezone: <span className="font-medium text-text-primary">{formatTimezoneOffsetLabel()}</span>
                </p>
                <button
                  type="button"
                  className="mt-auto h-8 rounded-md bg-primary-button-bg px-3 text-xs font-medium text-primary-button-text"
                  onClick={applyCustom}
                >
                  Apply
                </button>
              </div>
            ) : null}
            <div className="flex max-h-80 w-44 shrink-0 flex-col overflow-y-auto py-1" role="listbox">
              <button
                type="button"
                className={cn(
                  'px-3 py-2 text-left text-xs',
                  timeRange.timeWindowMs == null
                    ? 'bg-dropdown-selected-item-bg text-dropdown-selected-item-text'
                    : 'text-text-primary hover:bg-ghost-button-hover',
                )}
                onClick={() => setCustomPickerOpen(true)}
              >
                Custom Time Range
              </button>
              {SESSION_TIME_PRESETS.map(preset => (
                <button
                  key={preset.windowMs}
                  type="button"
                  className={cn(
                    'px-3 py-2 text-left text-xs',
                    timeRange.timeWindowMs === preset.windowMs
                      ? 'bg-dropdown-selected-item-bg text-dropdown-selected-item-text'
                      : 'text-text-primary hover:bg-ghost-button-hover',
                  )}
                  onClick={() => {
                    const endTs = Date.now();
                    onTimeRangeChange({
                      startTs: endTs - preset.windowMs,
                      endTs,
                      timeWindowMs: preset.windowMs,
                    });
                    setMenuOpen(false);
                    setCustomPickerOpen(false);
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentSessionsFilters: typeof AgentSessionsFilters;
  }
}
