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

/** Human-readable relative time (e.g. "just now", "5 min ago", "2 hours ago"). */
export function formatRelativeTime(
  iso: string | null | undefined,
  { fallback = '—', nowMs = Date.now() }: { fallback?: string; nowMs?: number } = {},
): string {
  if (iso == null) return fallback;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return fallback;
  const deltaSec = Math.round((nowMs - then) / 1000);
  if (deltaSec < 60) return 'just now';
  const mins = Math.round(deltaSec / 60);
  if (mins < 60) return `${String(mins)} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${String(hours)} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${String(days)} day${days === 1 ? '' : 's'} ago`;
}
