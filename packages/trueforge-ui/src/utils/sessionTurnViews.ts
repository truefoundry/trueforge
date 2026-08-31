import type { SessionEventItem } from '../server/types.js';

type TurnCreatedEvent = Extract<SessionEventItem['event'], { type: 'turn.created' }>;
type TurnDoneEvent = Extract<SessionEventItem['event'], { type: 'turn.done' }>;
type TurnEvent = Exclude<SessionEventItem['event'], TurnCreatedEvent | TurnDoneEvent>;

export type SessionTurnView = {
  turnId: string;
  turnNumber: number;
  showHeader: boolean;
  created: TurnCreatedEvent;
  done?: TurnDoneEvent;
  events: TurnEvent[];
  totalTokens?: number;
  totalCostInUsd?: number;
  durationMs?: number;
};

type TurnGroup = {
  created?: TurnCreatedEvent;
  done?: TurnDoneEvent;
  events: TurnEvent[];
};

const RENDERABLE_INPUT_TYPES = new Set(['user.message', 'user.tool_approval', 'user.tool_response']);

function timestampMs(createdAt: string): number {
  const value = Date.parse(createdAt);
  return Number.isNaN(value) ? 0 : value;
}

function isRenderableTurn(created: TurnCreatedEvent): boolean {
  const input = Reflect.get(created, 'input');
  if (!Array.isArray(input)) return false;
  return input.some(item => {
    if (typeof item !== 'object' || item == null || !('type' in item)) return false;
    const type = Reflect.get(item, 'type');
    return typeof type === 'string' && RENDERABLE_INPUT_TYPES.has(type);
  });
}

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
  const totalTokens = Reflect.get(metrics, 'totalTokens') ?? Reflect.get(metrics, 'total_tokens');
  const totalCostInUsd = Reflect.get(metrics, 'totalCostInUsd') ?? Reflect.get(metrics, 'total_cost_in_usd');
  return {
    ...(typeof totalTokens === 'number' ? { totalTokens } : {}),
    ...(typeof totalCostInUsd === 'number' ? { totalCostInUsd } : {}),
  };
}

/**
 * Build canonical ascending turn groups from durable session events.
 * Pair by turnId so interleaved turn.created / turn.done still match; ignore
 * orphan terminal or content events that never had a turn.created.
 */
export function buildSessionTurnViews(itemsAsc: SessionEventItem[]): SessionTurnView[] {
  const groupsByTurnId = new Map<string, TurnGroup>();

  for (const item of itemsAsc) {
    const { turnId, event } = item;
    const group = groupsByTurnId.get(turnId) ?? { events: [] };

    if (event.type === 'turn.created') {
      group.created = event;
    } else if (event.type === 'turn.done') {
      group.done = event;
    } else {
      group.events.push(event);
    }
    groupsByTurnId.set(turnId, group);
  }

  // Number only renderable turns so cards and the timeline share one index.
  const groups = Array.from(groupsByTurnId.entries())
    .flatMap(([turnId, group]) =>
      group.created === undefined || !isRenderableTurn(group.created)
        ? []
        : [{ turnId, created: group.created, group }],
    )
    .sort((left, right) => timestampMs(left.created.createdAt) - timestampMs(right.created.createdAt));

  return groups.map(({ turnId, created, group }, index) => {
    const done = group.done;
    group.events.sort((left, right) => timestampMs(left.createdAt) - timestampMs(right.createdAt));

    return {
      turnId,
      turnNumber: index + 1,
      showHeader: true,
      created,
      ...(done === undefined
        ? {}
        : {
            done,
            durationMs: Math.max(0, timestampMs(done.createdAt) - timestampMs(created.createdAt)),
            ...metricsFromTerminalState(done.state),
          }),
      events: group.events,
    };
  });
}
