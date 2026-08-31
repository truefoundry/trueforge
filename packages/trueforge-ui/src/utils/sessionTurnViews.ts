import type { SessionEventItem } from '../server/types.js';

export type SessionTurnView = {
  turnId: string;
  turnNumber: number;
  showHeader: boolean;
  totalTokens?: number;
  totalCostInUsd?: number;
  durationMs?: number;
};

function metricsFromTerminalState(state: unknown): {
  totalTokens?: number;
  totalCostInUsd?: number;
} {
  if (typeof state !== 'object' || state == null || !('status' in state)) {
    return {};
  }
  const status = Reflect.get(state, 'status');
  if (status !== 'done' && status !== 'cancelled' && status !== 'error') {
    return {};
  }
  const metrics = Reflect.get(state, 'metrics');
  if (metrics == null || typeof metrics !== 'object') {
    return {};
  }
  const totalTokens = Reflect.get(metrics, 'totalTokens');
  const totalCostInUsd = Reflect.get(metrics, 'totalCostInUsd');
  return {
    ...(typeof totalTokens === 'number' ? { totalTokens } : {}),
    ...(typeof totalCostInUsd === 'number' ? { totalCostInUsd } : {}),
  };
}

/** Build ascending turn headers from durable session events (newest-first pages reversed). */
export function buildSessionTurnViews(itemsAsc: SessionEventItem[]): SessionTurnView[] {
  const views: SessionTurnView[] = [];
  let openTurnId: string | null = null;
  let openCreatedAt: string | null = null;
  let turnNumber = 0;

  for (const item of itemsAsc) {
    const { turnId, event } = item;
    if (event.type === 'turn.created') {
      openTurnId = turnId;
      openCreatedAt = event.createdAt;
      continue;
    }
    if (event.type !== 'turn.done' || openTurnId !== turnId || openCreatedAt == null) {
      continue;
    }
    turnNumber += 1;
    const durationMs = Math.max(0, new Date(event.createdAt).getTime() - new Date(openCreatedAt).getTime());
    views.push({
      turnId,
      turnNumber,
      showHeader: true,
      durationMs,
      ...metricsFromTerminalState(event.state),
    });
    openTurnId = null;
    openCreatedAt = null;
  }

  return views;
}
