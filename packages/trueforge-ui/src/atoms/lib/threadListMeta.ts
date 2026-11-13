import { TURN_STATUS, type TurnStatus } from '../../server/types.js';

/** Matches TrueForge `PATCH /sessions/{id}` title max. */
export const MAX_SESSION_TITLE_LENGTH = 50;

const TURN_STATUS_VALUES = new Set<string>(Object.values(TURN_STATUS));

function isTurnStatus(value: unknown): value is TurnStatus {
  return typeof value === 'string' && TURN_STATUS_VALUES.has(value);
}

/** Tailwind bg class for a last-turn status dot; undefined means hide the dot. */
export function lastTurnStatusDotClass(status: TurnStatus | undefined | null): string | undefined {
  switch (status) {
    case 'paused':
      return 'bg-warning-bg';
    case 'error':
      return 'bg-failure-bg';
    default:
      return undefined;
  }
}

/** Screen-reader label for a last-turn status; undefined when the row has no live status chrome. */
export function lastTurnStatusLabel(status: TurnStatus | undefined | null): string | undefined {
  switch (status) {
    case 'running':
      return 'Running';
    case 'paused':
      return 'Waiting for input';
    case 'error':
      return 'Failed';
    default:
      return undefined;
  }
}

/** Whether the title should use the running shimmer. */
export function isRunningTurnStatus(status: TurnStatus | undefined | null): boolean {
  return status === 'running';
}

/** Paused tips blink — the user still needs to act. */
export function isPausedTurnStatus(status: TurnStatus | undefined | null): boolean {
  return status === 'paused';
}

/** Compact relative age for sidebar session rows (e.g. 30m, 22h, 1d). */
export function formatRelativeShort(date: Date, now: Date = new Date()): string {
  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(days / 365)}y`;
}

/**
 * Indices into `threadIds` ordered newest-first by `lastMessageAt`.
 * Stabilizes UI when assistant-ui appends a switched-to thread at the end.
 * Missing `lastMessageAt` (empty local "New Chat") sorts as newest so it stays on top.
 */
export function threadListIndicesByRecency({
  threadIds,
  threadItems,
}: {
  threadIds: readonly string[];
  threadItems: readonly { id: string; remoteId?: string | null; lastMessageAt?: Date | null }[];
}): number[] {
  const timeByKey = new Map<string, number>();
  for (const item of threadItems) {
    // Empty / not-yet-messaged threads have no timestamp; treat as newest.
    const t = item.lastMessageAt?.getTime() ?? Number.POSITIVE_INFINITY;
    timeByKey.set(item.id, t);
    if (item.remoteId != null) timeByKey.set(item.remoteId, t);
  }
  return threadIds
    .map((id, index) => ({ index, t: timeByKey.get(id) ?? 0 }))
    .sort((a, b) => b.t - a.t || a.index - b.index)
    .map(row => row.index);
}

export function readThreadAgentName(custom: unknown): string | undefined {
  if (custom == null || typeof custom !== 'object') return undefined;
  if (!('agentName' in custom)) return undefined;
  const value = Reflect.get(custom, 'agentName');
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Session mutability from thread-list custom (runtime ≥ isMutable stamp). */
export function readThreadIsMutable(custom: unknown): boolean | undefined {
  if (custom == null || typeof custom !== 'object') return undefined;
  if (!('isMutable' in custom)) return undefined;
  const value = Reflect.get(custom, 'isMutable');
  return typeof value === 'boolean' ? value : undefined;
}

/** Last-turn status stamped on thread-list custom by `sessionToThreadMetadata`. */
export function readThreadLastTurnStatus(custom: unknown): TurnStatus | undefined {
  if (custom == null || typeof custom !== 'object') return undefined;
  if (!('lastTurnStatus' in custom)) return undefined;
  const value = Reflect.get(custom, 'lastTurnStatus');
  return isTurnStatus(value) ? value : undefined;
}

/** Merge `lastTurnStatus` into thread-list custom (omits the key when cleared). */
export function threadCustomWithLastTurnStatus(
  custom: unknown,
  status: TurnStatus | null | undefined,
): Record<string, unknown> {
  const base =
    custom != null && typeof custom === 'object' && !Array.isArray(custom)
      ? Object.fromEntries(Object.entries(custom))
      : {};
  Reflect.deleteProperty(base, 'lastTurnStatus');
  if (status != null) {
    base.lastTurnStatus = status;
  }
  return base;
}

/**
 * Prefer `custom.isMutable`; fall back to agentName presence for older runtimes
 * that only stamped `agentName` on named rows.
 */
export function threadListItemIsMutable(custom: unknown): boolean {
  return readThreadIsMutable(custom) ?? readThreadAgentName(custom) == null;
}

/**
 * Fast-path `switchToThread` for mutable history rows only when Edit chrome is
 * safe to keep. Blank drafts (no agentName/agentId) may share one shell; an
 * Edit-bound shell must remount via `openHistorySession` when leaving its
 * pending session so Update does not keep the previous agentName over another
 * draft's runtime spec.
 */
export function canReuseMutableShell({
  sessionMutable,
  shellMutable,
  shellAgentName,
  shellAgentId,
  remoteId,
  pendingSessionId,
}: {
  sessionMutable: boolean;
  shellMutable: boolean;
  shellAgentName?: string;
  shellAgentId?: string;
  remoteId?: string | null;
  pendingSessionId?: string;
}): boolean {
  if (!sessionMutable || !shellMutable) return false;
  const editBound = (shellAgentName != null && shellAgentName !== '') || (shellAgentId != null && shellAgentId !== '');
  if (!editBound) return true;
  return remoteId != null && remoteId === pendingSessionId;
}
