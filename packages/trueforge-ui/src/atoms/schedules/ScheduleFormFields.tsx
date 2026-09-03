'use client';

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
  onAgentIdChange?: (agentId: string) => void;
  agentOptions: Array<{ agentId: string; name: string }>;
  agentPickerDisabled?: boolean;
};

export function ScheduleFormFields({
  values,
  onChange,
  agentId,
  onAgentIdChange,
  agentOptions,
  agentPickerDisabled = false,
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
        <PopoverSelect
          aria-label="Agent"
          placeholder="Select an agent"
          value={agentId}
          options={agentOptions.map(agent => ({ value: agent.agentId, label: agent.name }))}
          onValueChange={value => onAgentIdChange?.(value)}
          disabled={agentPickerDisabled || onAgentIdChange == null}
        />
      </div>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium">Name</span>
        <input
          value={values.name}
          onChange={e => set('name', e.target.value)}
          placeholder="harness-daily-digest"
          className={auiInputClass('h-9')}
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
        <legend className="mb-1.5 text-sm font-medium">Recurrence</legend>
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-border p-1">
          {RECURRENCE_OPTIONS.map(opt => {
            const selected = values.recurrence === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                className={cn(
                  'rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                  selected
                    ? 'border border-primary-button-bg/40 bg-primary-button-bg/10 text-primary-button-bg'
                    : 'text-text-secondary hover:bg-ghost-button-hover border border-transparent',
                )}
                aria-pressed={selected}
                onClick={() => set('recurrence', opt.value)}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      {values.recurrence === 'hourly' ? (
        <div className="block max-w-[8rem]">
          <span className="mb-1.5 block text-sm font-medium">Minute</span>
          <PopoverSelect
            aria-label="Minute"
            value={String(values.minute)}
            options={MINUTE_OPTIONS}
            onValueChange={value => set('minute', Number(value))}
          />
        </div>
      ) : null}

      {values.recurrence === 'daily' || values.recurrence === 'weekly' ? (
        <div className="flex flex-wrap gap-3">
          <div className="block min-w-[7rem] flex-1">
            <span className="mb-1.5 block text-sm font-medium">Hour</span>
            <PopoverSelect
              aria-label="Hour"
              value={String(values.hour)}
              options={HOUR_OPTIONS}
              onValueChange={value => set('hour', Number(value))}
            />
          </div>
          <div className="block min-w-[7rem] flex-1">
            <span className="mb-1.5 block text-sm font-medium">Minute</span>
            <PopoverSelect
              aria-label="Minute"
              value={String(values.minute)}
              options={MINUTE_OPTIONS}
              onValueChange={value => set('minute', Number(value))}
            />
          </div>
        </div>
      ) : null}

      {values.recurrence === 'weekly' ? (
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Days</legend>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_OPTIONS.map(day => {
              const selected = values.weekdays.includes(day.value);
              return (
                <button
                  key={day.value}
                  type="button"
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-xs font-medium',
                    selected
                      ? 'border-primary-button-bg/40 bg-primary-button-bg/10 text-primary-button-bg'
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

      {values.recurrence === 'custom' ? (
        <div className="rounded-md border border-border bg-secondary-bg/40 px-3 py-2">
          <span className="text-text-secondary block text-xs">Existing custom schedule</span>
          <code className="text-text-primary mt-1 block font-mono text-sm">{values.customCron}</code>
          <span className="text-text-secondary mt-1 block text-xs">
            Select Hourly, Daily, or Weekly to replace this schedule.
          </span>
        </div>
      ) : null}

      <div className="block">
        <span className="mb-1.5 block text-sm font-medium">Timezone</span>
        <PopoverSelect
          aria-label="Timezone"
          value={values.timezone}
          options={timezoneOptions}
          onValueChange={value => set('timezone', value)}
          menuPlacement="top"
        />
      </div>

      <div className="rounded-lg border border-border bg-secondary-bg/40 px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <span className="text-text-secondary text-[10px] font-semibold tracking-wide uppercase">Frequency</span>
          <code className="text-text-secondary font-mono text-xs">{cron || '—'}</code>
        </div>
        <p className="text-text-primary mt-1 text-sm font-semibold">{cadence || '—'}</p>
      </div>
    </div>
  );
}
