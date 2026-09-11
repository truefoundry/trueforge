'use client';

import { Icon } from '../../icons/Icon.js';
import type { AgentLibraryEntry } from '../../server/types.js';
import { AgentSearchPicker } from '../AgentSearchPicker.js';
import { cn } from '../lib/cn.js';
import { auiInputClass } from '../lib/inputClasses.js';
import { PopoverSelect } from '../primitives/PopoverSelect.js';
import {
  WEEKDAY_OPTIONS,
  formatCadenceSummary,
  getTimezoneOptions,
  valuesToCron,
  type RecurrenceKind,
  type ScheduleFormValues,
} from './cadence.js';

export const RECURRENCE_OPTIONS: Array<{ value: RecurrenceKind; label: string }> = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: hour.toString().padStart(2, '0'),
}));
const MINUTE_OPTIONS = [0, 15, 30, 45].map(minute => ({
  value: String(minute),
  label: `:${minute.toString().padStart(2, '0')}`,
}));

export type ScheduleFormFieldsProps = {
  values: ScheduleFormValues;
  onChange: (next: ScheduleFormValues) => void;
  agentId: string;
  agentLabel: string;
  onAgentIdChange?: (agentId: string) => void;
  onAgentPicked?: (agent: AgentLibraryEntry) => void;
  agentPickerDisabled?: boolean;
  onBuildAgent?: () => void;
};

export function ScheduleFormFields({
  values,
  onChange,
  agentId,
  agentLabel,
  onAgentIdChange,
  onAgentPicked,
  agentPickerDisabled = false,
  onBuildAgent,
}: ScheduleFormFieldsProps) {
  const cron = valuesToCron(values);
  const cadence = formatCadenceSummary({ cron, timezone: values.timezone });
  const timezoneOptions = getTimezoneOptions(values.timezone);

  const set = <K extends keyof ScheduleFormValues>(key: K, value: ScheduleFormValues[K]) => {
    onChange({ ...values, [key]: value });
  };

  const toggleWeekday = (day: number) => {
    const has = values.weekdays.includes(day);
    const weekdays = has ? values.weekdays.filter(d => d !== day) : [...values.weekdays, day];
    onChange({ ...values, weekdays: weekdays.length > 0 ? weekdays : [day] });
  };

  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <div className="block">
        <span className="mb-1.5 block text-sm font-medium">Agent</span>
        <AgentSearchPicker
          aria-label="Agent"
          placeholder="Search agent"
          value={agentId}
          selectedLabel={agentLabel}
          onValueChange={value => onAgentIdChange?.(value)}
          onAgentPicked={onAgentPicked}
          disabled={agentPickerDisabled || onAgentIdChange == null}
          onBuildAgent={onBuildAgent}
        />
      </div>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium">Name</span>
        <input
          value={values.name}
          onChange={e => set('name', e.target.value)}
          placeholder="harness-daily-digest"
          className={auiInputClass('h-8')}
          required
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium">Task</span>
        <textarea
          value={values.task}
          onChange={e => set('task', e.target.value)}
          rows={3}
          placeholder="Summarise yesterday's harness runs and post the digest…"
          className={auiInputClass('resize-y py-2')}
          required
        />
      </label>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Frequency</legend>
        <div className="rounded-t-lg border border-border p-4">
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-primary-bg p-1">
              {RECURRENCE_OPTIONS.map(opt => {
                const selected = values.recurrence === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    className={cn(
                      'rounded-md border px-2 py-2 text-sm font-medium transition-colors',
                      selected
                        ? 'border-primary-button-bg/40 bg-primary-button-bg/10 font-semibold text-primary-button-bg'
                        : 'border-transparent text-text-secondary hover:bg-ghost-button-hover',
                    )}
                    aria-pressed={selected}
                    onClick={() => set('recurrence', opt.value)}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {values.recurrence === 'custom' ? (
              <div className="rounded-md border border-border bg-secondary-bg/40 px-3 py-2">
                <span className="block text-xs text-text-secondary">Existing custom schedule</span>
                <code className="mt-1 block font-mono text-sm text-text-primary">{values.customCron}</code>
                <span className="mt-1 block text-xs text-text-secondary">
                  Select Hourly, Daily, or Weekly to replace this schedule.
                </span>
              </div>
            ) : null}

            {values.recurrence === 'weekly' ? (
              <fieldset>
                <legend className="mb-2 text-sm font-medium">Days</legend>
                <div className="flex gap-2">
                  {WEEKDAY_OPTIONS.map(day => {
                    const selected = values.weekdays.includes(day.value);
                    return (
                      <button
                        key={day.value}
                        type="button"
                        className={cn(
                          'min-w-0 flex-1 rounded-md border px-3 py-2 text-[0.8125rem] font-medium',
                          selected
                            ? 'border-primary-button-bg/40 bg-primary-button-bg/10 font-semibold text-primary-button-bg'
                            : 'border-border text-text-secondary hover:bg-ghost-button-hover',
                        )}
                        aria-pressed={selected}
                        onClick={() => toggleWeekday(day.value)}
                      >
                        {day.label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ) : null}

            <div className="flex gap-4">
              {values.recurrence === 'daily' || values.recurrence === 'weekly' ? (
                <div className="min-w-0 flex-1">
                  <span className="mb-1.5 block text-sm font-medium">Hour</span>
                  <PopoverSelect
                    aria-label="Hour"
                    value={String(values.hour)}
                    options={HOUR_OPTIONS}
                    onValueChange={value => set('hour', Number(value))}
                  />
                </div>
              ) : null}
              {values.recurrence !== 'custom' ? (
                <div className="min-w-0 flex-1">
                  <span className="mb-1.5 block text-sm font-medium">Minute</span>
                  <PopoverSelect
                    aria-label="Minute"
                    value={String(values.minute)}
                    options={MINUTE_OPTIONS}
                    onValueChange={value => set('minute', Number(value))}
                  />
                </div>
              ) : null}
              <div className="min-w-0 flex-1">
                <span className="mb-1.5 block text-sm font-medium">Timezone</span>
                <PopoverSelect
                  aria-label="Timezone"
                  value={values.timezone}
                  options={timezoneOptions}
                  onValueChange={value => set('timezone', value)}
                  menuClassName="w-full min-w-0"
                />
              </div>
            </div>
          </div>
        </div>
        <div className="rounded-b-lg border border-t-0 border-border bg-primary-button-bg/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <Icon name="clock" className="size-4 shrink-0 text-primary-button-bg" />
            <span className="shrink-0 text-xs font-medium text-text-secondary">Schedule</span>
            <p className="min-w-0 flex-1 truncate text-sm text-text-primary">{cadence || '—'}</p>
            <code className="shrink-0 whitespace-nowrap font-mono text-[0.8125rem] font-bold text-text-secondary">
              {cron || '—'}
            </code>
          </div>
        </div>
      </fieldset>
    </div>
  );
}
