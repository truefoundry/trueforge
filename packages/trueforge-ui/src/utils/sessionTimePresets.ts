export const SESSION_TIME_PRESETS = [
  { label: 'Last 30 minutes', windowMs: 30 * 60 * 1000 },
  { label: 'Last 1 hour', windowMs: 60 * 60 * 1000 },
  { label: 'Last 3 hours', windowMs: 3 * 60 * 60 * 1000 },
  { label: 'Last 6 hours', windowMs: 6 * 60 * 60 * 1000 },
  { label: 'Last 12 hours', windowMs: 12 * 60 * 60 * 1000 },
  { label: 'Last 24 hours', windowMs: 24 * 60 * 60 * 1000 },
  { label: 'Last 2 days', windowMs: 2 * 24 * 60 * 60 * 1000 },
  { label: 'Last 7 days', windowMs: 7 * 24 * 60 * 60 * 1000 },
  { label: 'Last 30 days', windowMs: 30 * 24 * 60 * 60 * 1000 },
] as const;

export function formatSessionTimePresetLabel(windowMs: number): string | null {
  return SESSION_TIME_PRESETS.find(preset => preset.windowMs === windowMs)?.label ?? null;
}

export function formatTimezoneOffsetLabel(date = new Date()): string {
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const hours = String(Math.floor(abs / 60)).padStart(2, '0');
  const minutes = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${hours}:${minutes}`;
}

export function toDateTimeLocalValue(ts: number): string {
  const date = new Date(ts);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function fromDateTimeLocalValue(value: string): number | null {
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}
