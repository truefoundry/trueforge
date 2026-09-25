/** Absolute local date+time for tooltips (e.g. "Apr 5, 2026, 2:03 PM"). */
export function formatAbsoluteDateTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}
