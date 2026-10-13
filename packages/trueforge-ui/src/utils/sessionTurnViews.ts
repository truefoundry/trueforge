import type { SessionEventItem } from '../server/types.js';

type TurnCreatedEvent = Extract<SessionEventItem['event'], { type: 'turn.created' }>;
type TurnDoneEvent = Extract<SessionEventItem['event'], { type: 'turn.done' }>;
type TurnEvent = Exclude<SessionEventItem['event'], TurnCreatedEvent | TurnDoneEvent>;

const MCP_AUTH_CONTINUE_INPUT = { type: 'user.mcp_auth_continue' } as const;

export type SessionTurnView = {
  turnId: string;
  /** Chronological index among every event turn (1..N). Unique; used for gap compression. */
  eventTurnNumber: number;
  /** Display band among renderable turns (1..R). */
  turnNumber: number;
  /** True when the turn has user/continuation input worth its own transcript section. */
  renderable: boolean;
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

const RENDERABLE_INPUT_TYPES = new Set([
  'user.message',
  'user.tool_approval',
  'user.tool_response',
  'user.mcp_auth_continue',
]);

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

function turnEndedWithMcpAuth(done: TurnDoneEvent | undefined): boolean {
  if (done == null || done.state.status !== 'done') return false;
  const actions = done.state.requiredActions;
  if (!Array.isArray(actions)) return false;
  return actions.some(action => action.type === 'mcp.auth_required');
}

/** Production MCP resumes often omit input; normalize so summary/projection helpers work. */
function withMcpAuthContinueInput(created: TurnCreatedEvent): TurnCreatedEvent {
  const input = created.input ?? [];
  if (input.some(item => item.type === 'user.mcp_auth_continue')) return created;
  return { ...created, input: [...input, MCP_AUTH_CONTINUE_INPUT] };
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

  // Include every turn.created (metrics need all turns). Empty-input MCP-auth
  // resumes become their own transcript band via synthesized continue input.
  const groups = Array.from(groupsByTurnId.entries())
    .flatMap(([turnId, group]) => (group.created === undefined ? [] : [{ turnId, created: group.created, group }]))
    .sort((left, right) => timestampMs(left.created.createdAt) - timestampMs(right.created.createdAt));

  let renderableTurnNumber = 0;
  return groups.map(({ turnId, created, group }, index) => {
    const done = group.done;
    const previousDone = index > 0 ? groups[index - 1]?.group.done : undefined;
    const isMcpAuthResume = !isRenderableTurn(created) && turnEndedWithMcpAuth(previousDone);
    const viewCreated = isMcpAuthResume ? withMcpAuthContinueInput(created) : created;
    const renderable = isRenderableTurn(viewCreated);
    if (renderable) renderableTurnNumber += 1;
    group.events.sort((left, right) => timestampMs(left.createdAt) - timestampMs(right.createdAt));

    return {
      turnId,
      eventTurnNumber: index + 1,
      turnNumber: Math.max(1, renderableTurnNumber),
      renderable,
      showHeader: renderable,
      created: viewCreated,
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

/** Sum tokens/cost/duration for every event-turn that shares a display band. */
export function aggregateSessionTurnBand(
  turns: readonly SessionTurnView[],
  turnNumber: number,
): SessionTurnView | undefined {
  const band = turns.filter(turn => turn.turnNumber === turnNumber);
  const primary = band.find(turn => turn.renderable) ?? band[0];
  if (primary == null) return undefined;

  let totalTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let totalCostInUsd = 0;
  let durationMs = 0;
  let hasTokens = false;
  let hasInput = false;
  let hasOutput = false;
  let hasCached = false;
  let hasCost = false;
  let hasDuration = false;

  for (const turn of band) {
    if (turn.totalTokens != null) {
      totalTokens += turn.totalTokens;
      hasTokens = true;
    }
    if (turn.inputTokens != null) {
      inputTokens += turn.inputTokens;
      hasInput = true;
    }
    if (turn.outputTokens != null) {
      outputTokens += turn.outputTokens;
      hasOutput = true;
    }
    if (turn.cachedTokens != null) {
      cachedTokens += turn.cachedTokens;
      hasCached = true;
    }
    if (turn.totalCostInUsd != null) {
      totalCostInUsd += turn.totalCostInUsd;
      hasCost = true;
    }
    if (turn.durationMs != null) {
      durationMs += turn.durationMs;
      hasDuration = true;
    }
  }

  return {
    ...primary,
    ...(hasTokens ? { totalTokens } : {}),
    ...(hasInput ? { inputTokens } : {}),
    ...(hasOutput ? { outputTokens } : {}),
    ...(hasCached ? { cachedTokens } : {}),
    ...(hasCost ? { totalCostInUsd } : {}),
    ...(hasDuration ? { durationMs } : {}),
  };
}
