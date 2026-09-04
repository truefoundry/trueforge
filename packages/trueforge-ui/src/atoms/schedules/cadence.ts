export type RecurrenceKind = 'hourly' | 'daily' | 'weekly' | 'custom';

export type ScheduleFormValues = {
  name: string;
  task: string;
  recurrence: RecurrenceKind;
  hour: number;
  minute: number;
  /** Cron DOW: 0=Sun … 6=Sat. Used when recurrence is weekly. */
  weekdays: number[];
  customCron: string;
  timezone: string;
};

export const TIMEZONE_OPTIONS = [
  { value: 'America/New_York', label: 'America/New_York (ET)' },
  { value: 'America/Chicago', label: 'America/Chicago (CT)' },
  { value: 'America/Denver', label: 'America/Denver (MT)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (PT)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/London', label: 'Europe/London (GMT/BST)' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin (CET)' },
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata (IST)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST)' },
] as const;

export function resolveLocalTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function getTimezoneOptions(selectedTimezone?: string): Array<{ value: string; label: string }> {
  const localTimezone = resolveLocalTimezone();
  const knownTimezones = new Set<string>(TIMEZONE_OPTIONS.map(option => option.value));
  // Keep both browser-local and persisted zones selectable even when they are
  // outside the curated common-timezone list.
  const additionalTimezones = [localTimezone, selectedTimezone].flatMap(timezone => {
    if (timezone == null || timezone.length === 0 || knownTimezones.has(timezone)) return [];
    knownTimezones.add(timezone);
    return [{ value: timezone, label: timezone === localTimezone ? `${timezone} (Local)` : timezone }];
  });
  return [...additionalTimezones, ...TIMEZONE_OPTIONS];
}

export const WEEKDAY_OPTIONS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
] as const;

const TZ_ABBR: Record<string, string> = {
  'America/New_York': 'ET',
  'America/Chicago': 'CT',
  'America/Denver': 'MT',
  'America/Los_Angeles': 'PT',
  UTC: 'UTC',
  'Europe/London': 'GMT',
  'Europe/Berlin': 'CET',
  'Asia/Kolkata': 'IST',
  'Asia/Tokyo': 'JST',
};

export function defaultScheduleFormValues(): ScheduleFormValues {
  return {
    name: '',
    task: '',
    recurrence: 'daily',
    hour: 9,
    minute: 0,
    weekdays: [1],
    customCron: '0 9 * * *',
    timezone: resolveLocalTimezone(),
  };
}

export function timezoneAbbrev(timezone: string): string {
  return TZ_ABBR[timezone] ?? timezone.split('/').pop() ?? timezone;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function formatClock({ hour, minute }: { hour: number; minute: number }): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(h12)}:${pad2(minute)} ${period}`;
}

export function valuesToCron(values: ScheduleFormValues): string {
  const minute = values.minute;
  const hour = values.hour;
  switch (values.recurrence) {
    case 'hourly':
      return `${String(minute)} * * * *`;
    case 'daily':
      return `${String(minute)} ${String(hour)} * * *`;
    case 'weekly': {
      const days = [...values.weekdays].sort((a, b) => a - b);
      const dow = days.length > 0 ? days.join(',') : '*';
      return `${String(minute)} ${String(hour)} * * ${dow}`;
    }
    case 'custom':
      return values.customCron.trim();
  }
}

export function formatCadenceSummary(input: { cron: string; timezone: string }): string {
  const abbr = timezoneAbbrev(input.timezone);
  const parts = input.cron.trim().split(/\s+/);
  if (parts.length !== 5) return input.cron;

  const [minuteRaw, hourRaw, dayOfMonthRaw, monthRaw, dowRaw] = parts;
  if (dayOfMonthRaw !== '*' || monthRaw !== '*') return input.cron;

  const minute = Number(minuteRaw);
  const hour = Number(hourRaw);

  if (hourRaw === '*' && dowRaw === '*' && minuteRaw !== undefined && !Number.isNaN(minute)) {
    return `Hourly at :${pad2(minute)} ${abbr}`;
  }

  if (
    dowRaw === '*' &&
    hourRaw !== undefined &&
    minuteRaw !== undefined &&
    !Number.isNaN(hour) &&
    !Number.isNaN(minute)
  ) {
    return `Daily ${formatClock({ hour, minute })} ${abbr}`;
  }

  if (
    dowRaw === '1-5' &&
    hourRaw !== undefined &&
    minuteRaw !== undefined &&
    !Number.isNaN(hour) &&
    !Number.isNaN(minute)
  ) {
    return `Weekdays ${formatClock({ hour, minute })} ${abbr}`;
  }

  if (
    dowRaw != null &&
    /^\d(?:,\d)*$/.test(dowRaw) &&
    hourRaw !== undefined &&
    minuteRaw !== undefined &&
    !Number.isNaN(hour) &&
    !Number.isNaN(minute)
  ) {
    const labels = dowRaw.split(',').map(d => WEEKDAY_OPTIONS.find(w => w.value === Number(d))?.label ?? d);
    if (labels.length === 1) {
      const day = labels[0] === 'Mon' ? 'Monday' : labels[0];
      return `Every ${day} ${formatClock({ hour, minute })} ${abbr}`;
    }
    return `${labels.join(', ')} ${formatClock({ hour, minute })} ${abbr}`;
  }

  return input.cron;
}

/** Best-effort parse of known patterns into form values for edit. */
export function cronToFormValues(input: {
  name: string;
  task: string;
  cron: string;
  timezone: string;
}): ScheduleFormValues {
  const base = defaultScheduleFormValues();
  const parts = input.cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    return {
      ...base,
      name: input.name,
      task: input.task,
      timezone: input.timezone,
      recurrence: 'custom',
      customCron: input.cron,
    };
  }

  const [minuteRaw, hourRaw, dom, month, dowRaw] = parts;
  const minute = Number(minuteRaw);
  const hour = Number(hourRaw);

  if (dom !== '*' || month !== '*') {
    return {
      ...base,
      name: input.name,
      task: input.task,
      timezone: input.timezone,
      recurrence: 'custom',
      customCron: input.cron,
    };
  }

  if (hourRaw === '*' && dowRaw === '*' && !Number.isNaN(minute)) {
    return {
      ...base,
      name: input.name,
      task: input.task,
      timezone: input.timezone,
      recurrence: 'hourly',
      minute,
      customCron: input.cron,
    };
  }

  if (dowRaw === '*' && !Number.isNaN(hour) && !Number.isNaN(minute)) {
    return {
      ...base,
      name: input.name,
      task: input.task,
      timezone: input.timezone,
      recurrence: 'daily',
      hour,
      minute,
      customCron: input.cron,
    };
  }

  if (dowRaw != null && /^\d(?:,\d)*$/.test(dowRaw) && !Number.isNaN(hour) && !Number.isNaN(minute)) {
    return {
      ...base,
      name: input.name,
      task: input.task,
      timezone: input.timezone,
      recurrence: 'weekly',
      hour,
      minute,
      weekdays: dowRaw.split(',').map(Number),
      customCron: input.cron,
    };
  }

  // Weekdays 1-5 → treat as custom so the cron string is preserved on save.
  return {
    ...base,
    name: input.name,
    task: input.task,
    timezone: input.timezone,
    recurrence: 'custom',
    customCron: input.cron,
    hour: Number.isNaN(hour) ? base.hour : hour,
    minute: Number.isNaN(minute) ? base.minute : minute,
  };
}

export function formatRelativeTime(iso: string | null, nowMs = Date.now()): string {
  if (iso == null) return 'Never';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'Never';
  const deltaSec = Math.round((nowMs - then) / 1000);
  if (deltaSec < 60) return 'just now';
  const mins = Math.round(deltaSec / 60);
  if (mins < 60) return `${String(mins)} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${String(hours)} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${String(days)} day${days === 1 ? '' : 's'} ago`;
}
