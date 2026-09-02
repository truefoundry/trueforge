'use client';

import { useEffect, useRef, useState } from 'react';

import { Icon } from '../../icons/Icon.js';
import { useOptionalServer } from '../../server/ServerContext.js';
import { useOptionalShellMode } from '../../server/ShellModeContext.js';
import type { AgentLibraryEntry } from '../../server/types.js';
import { SESSION_CUSTOM_RANGE_MAX_DAYS, type SessionTimeRange } from '../../utils/sessionShareUrl.js';
import {
  formatSessionTimePresetLabel,
  formatTimezoneOffsetLabel,
  fromDateTimeLocalValue,
  SESSION_TIME_PRESETS,
  toDateTimeLocalValue,
} from '../../utils/sessionTimePresets.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { cn } from '../lib/cn.js';
import { auiInputClass } from '../lib/inputClasses.js';
import { auiSelectMenuClass, auiSelectOptionClass, auiSelectTriggerClass } from '../lib/selectClasses.js';
import { searchAllAgents } from '../lib/useSearchAgentsList.js';
import { PopoverSelect } from '../primitives/PopoverSelect.js';

export type AgentSessionsFiltersProps = {
  agentId: string | null;
  timeRange: SessionTimeRange;
  onAgentChange: (agentId: string | null) => void;
  onTimeRangeChange: (range: SessionTimeRange) => void;
  showAgentFilter?: boolean;
  showCustomTimeRange?: boolean;
};

export function AgentSessionsFilters({
  agentId,
  timeRange,
  onAgentChange,
  onTimeRangeChange,
  showAgentFilter = true,
  showCustomTimeRange = true,
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
    if (!showAgentFilter || server == null) return undefined;
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
  }, [server, shell?.agentsListEpoch, showAgentFilter]);

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
      {showAgentFilter ? (
        <PopoverSelect
          aria-label="Filter sessions by agent"
          prefix="Agents"
          className="min-w-[12rem]"
          value={agentId ?? ''}
          options={[
            { value: '', label: 'All' },
            ...agents.map(agent => ({ value: agent.agentId ?? agent.name, label: agent.name })),
          ]}
          onValueChange={value => onAgentChange(value.length === 0 ? null : value)}
        />
      ) : null}
      <div className="relative" ref={popoverRef}>
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-haspopup="listbox"
          className={auiSelectTriggerClass('min-w-36')}
          onClick={() => {
            setMenuOpen(open => {
              if (open) setCustomPickerOpen(false);
              return !open;
            });
          }}
        >
          <span className="truncate">{timeLabel}</span>
          <Icon name="chevron-down" className="size-4 shrink-0" />
        </button>
        {menuOpen ? (
          <div className={auiSelectMenuClass('right-0 flex max-h-none overflow-y-visible p-0')}>
            {customPickerOpen ? (
              <div className="flex w-64 min-w-0 flex-col gap-2 border-r border-border p-3">
                <div className="text-sm font-medium text-text-primary">Select Time Range</div>
                <p className="text-xs text-text-secondary">{`You can select time for last ${String(SESSION_CUSTOM_RANGE_MAX_DAYS)} days`}</p>
                <label className="flex flex-col gap-1 text-xs text-text-secondary">
                  From
                  <input
                    type="datetime-local"
                    step="1"
                    className={auiInputClass('h-9')}
                    value={fromValue}
                    onChange={event => setFromValue(event.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-text-secondary">
                  To
                  <input
                    type="datetime-local"
                    step="1"
                    className={auiInputClass('h-9')}
                    value={toValue}
                    onChange={event => setToValue(event.target.value)}
                  />
                </label>
                <p className="text-xs text-text-secondary">
                  Timezone: <span className="font-medium text-text-primary">{formatTimezoneOffsetLabel()}</span>
                </p>
                <button type="button" className={auiButtonClass({ className: 'mt-auto' })} onClick={applyCustom}>
                  Apply
                </button>
              </div>
            ) : null}
            <div className="flex max-h-80 w-44 shrink-0 flex-col overflow-y-auto p-1" role="listbox">
              {showCustomTimeRange ? (
                <button
                  type="button"
                  role="option"
                  aria-selected={timeRange.timeWindowMs == null}
                  className={auiSelectOptionClass()}
                  onClick={() => setCustomPickerOpen(true)}
                >
                  <span className="min-w-0 flex-1 truncate">Custom Time Range</span>
                  <Icon
                    name="check"
                    className={cn(
                      'ml-auto size-4 shrink-0',
                      timeRange.timeWindowMs == null ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                </button>
              ) : null}
              {SESSION_TIME_PRESETS.map(preset => {
                const selected = timeRange.timeWindowMs === preset.windowMs;
                return (
                  <button
                    key={preset.windowMs}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={auiSelectOptionClass()}
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
                    <span className="min-w-0 flex-1 truncate">{preset.label}</span>
                    <Icon
                      name="check"
                      className={cn('ml-auto size-4 shrink-0', selected ? 'opacity-100' : 'opacity-0')}
                    />
                  </button>
                );
              })}
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
