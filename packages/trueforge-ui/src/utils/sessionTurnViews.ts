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
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
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

function readMetricNumber(metrics: object, camel: string, snake: string): number | undefined {
  const camelValue = Reflect.get(metrics, camel);
  if (typeof camelValue === 'number' && Number.isFinite(camelValue)) return camelValue;
  const snakeValue = Reflect.get(metrics, snake);
  return typeof snakeValue === 'number' && Number.isFinite(snakeValue) ? snakeValue : undefined;
}

function metricsFromTerminalState(state: unknown): {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
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
  const explicitTotal = readMetricNumber(metrics, 'totalTokens', 'total_tokens');
  const rawInputTokens = readMetricNumber(metrics, 'totalInputTokens', 'total_input_tokens');
  const outputTokens = readMetricNumber(metrics, 'totalOutputTokens', 'total_output_tokens');
  const cacheRead = readMetricNumber(metrics, 'totalCacheReadTokens', 'total_cache_read_tokens');
  const cacheWrite = readMetricNumber(metrics, 'totalCacheWriteTokens', 'total_cache_write_tokens');
  const totalCostInUsd = readMetricNumber(metrics, 'totalCostInUsd', 'total_cost_in_usd');
  const cachedTokens =
    cacheRead !== undefined || cacheWrite !== undefined ? (cacheRead ?? 0) + (cacheWrite ?? 0) : undefined;
  // Input in UI breakdowns is uncached so Input + Cached + Output does not double-count cache.
  const inputTokens = rawInputTokens !== undefined ? Math.max(0, rawInputTokens - (cachedTokens ?? 0)) : undefined;
  const totalTokens =
    explicitTotal ??
    (rawInputTokens !== undefined || outputTokens !== undefined
      ? (rawInputTokens ?? 0) + (outputTokens ?? 0)
      : undefined);
  return {
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(cachedTokens !== undefined ? { cachedTokens } : {}),
    ...(totalCostInUsd !== undefined ? { totalCostInUsd } : {}),
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
