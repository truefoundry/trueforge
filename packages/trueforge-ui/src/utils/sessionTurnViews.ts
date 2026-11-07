import type { SessionEventItem } from '../server/types.js';
import { MAIN_THREAD_ID } from './sessionEventTimeline.js';

type TurnCreatedEvent = Extract<SessionEventItem['event'], { type: 'turn.created' }>;
type TurnDoneEvent = Extract<SessionEventItem['event'], { type: 'turn.done' }>;
type TurnEvent = Exclude<SessionEventItem['event'], TurnCreatedEvent | TurnDoneEvent>;

const MCP_AUTH_CONTINUE_INPUT = { type: 'user.mcp_auth_continue' } as const;

/** Per-call input attribution summed across model.message events in a turn. */
export type SessionInputTokensBreakdown = {
  harness: number;
  skills: number;
  instructions: number;
  toolDefinitions: number;
  messages: number;
};

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
  /** Uncached input so Input + cache + Output does not double-count cache. */
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** Sum of model.message usage.inputTokensBreakdown across all threads in the turn. */
  inputTokensBreakdown?: SessionInputTokensBreakdown;
  totalCostInUsd?: number;
  durationMs?: number;
  /** Model FQN of the last root-thread model call in the turn. */
  modelName?: string;
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
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
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
    ...(cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {}),
    ...(cacheWrite !== undefined ? { cacheWriteTokens: cacheWrite } : {}),
    ...(totalCostInUsd !== undefined ? { totalCostInUsd } : {}),
  };
}

function rootModelName(events: readonly TurnEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === 'model.message' && event.threadId === MAIN_THREAD_ID && event.model?.name) {
      return event.model.name;
    }
  }
  return undefined;
}

function readNonNegativeInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function readInputTokensBreakdown(usage: unknown): SessionInputTokensBreakdown | undefined {
  if (typeof usage !== 'object' || usage == null) return undefined;
  const raw = Reflect.get(usage, 'inputTokensBreakdown') ?? Reflect.get(usage, 'input_tokens_breakdown');
  if (typeof raw !== 'object' || raw == null) return undefined;
  const harness = readNonNegativeInt(Reflect.get(raw, 'harness'));
  const skills = readNonNegativeInt(Reflect.get(raw, 'skills'));
  const instructions = readNonNegativeInt(Reflect.get(raw, 'instructions'));
  const toolDefinitions =
    readNonNegativeInt(Reflect.get(raw, 'toolDefinitions')) ?? readNonNegativeInt(Reflect.get(raw, 'tool_definitions'));
  const messages = readNonNegativeInt(Reflect.get(raw, 'messages'));
  if (
    harness === undefined &&
    skills === undefined &&
    instructions === undefined &&
    toolDefinitions === undefined &&
    messages === undefined
  ) {
    return undefined;
  }
  return {
    harness: harness ?? 0,
    skills: skills ?? 0,
    instructions: instructions ?? 0,
    toolDefinitions: toolDefinitions ?? 0,
    messages: messages ?? 0,
  };
}

export function sumSessionInputTokensBreakdown(
  left: SessionInputTokensBreakdown | undefined,
  right: SessionInputTokensBreakdown | undefined,
): SessionInputTokensBreakdown | undefined {
  if (left == null && right == null) return undefined;
  return {
    harness: (left?.harness ?? 0) + (right?.harness ?? 0),
    skills: (left?.skills ?? 0) + (right?.skills ?? 0),
    instructions: (left?.instructions ?? 0) + (right?.instructions ?? 0),
    toolDefinitions: (left?.toolDefinitions ?? 0) + (right?.toolDefinitions ?? 0),
    messages: (left?.messages ?? 0) + (right?.messages ?? 0),
  };
}

/** Sum input attribution from every model.message in the turn (all threads). */
function inputTokensBreakdownFromEvents(events: readonly TurnEvent[]): SessionInputTokensBreakdown | undefined {
  let total: SessionInputTokensBreakdown | undefined;
  for (const event of events) {
    if (event.type !== 'model.message') continue;
    const usage = Reflect.get(event, 'usage');
    total = sumSessionInputTokensBreakdown(total, readInputTokensBreakdown(usage));
  }
  return total;
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
    const modelName = rootModelName(group.events);
    const inputTokensBreakdown = inputTokensBreakdownFromEvents(group.events);

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
      ...(modelName === undefined ? {} : { modelName }),
      ...(inputTokensBreakdown === undefined ? {} : { inputTokensBreakdown }),
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
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let totalCostInUsd = 0;
  let durationMs = 0;
  let hasTokens = false;
  let hasInput = false;
  let hasOutput = false;
  let hasCached = false;
  let hasCacheRead = false;
  let hasCacheWrite = false;
  let hasCost = false;
  let hasDuration = false;
  let modelName: string | undefined;
  let inputTokensBreakdown: SessionInputTokensBreakdown | undefined;

  for (const turn of band) {
    if (turn.modelName != null) modelName = turn.modelName;
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
    if (turn.cacheReadTokens != null) {
      cacheReadTokens += turn.cacheReadTokens;
      hasCacheRead = true;
    }
    if (turn.cacheWriteTokens != null) {
      cacheWriteTokens += turn.cacheWriteTokens;
      hasCacheWrite = true;
    }
    if (turn.totalCostInUsd != null) {
      totalCostInUsd += turn.totalCostInUsd;
      hasCost = true;
    }
    if (turn.durationMs != null) {
      durationMs += turn.durationMs;
      hasDuration = true;
    }
    inputTokensBreakdown = sumSessionInputTokensBreakdown(inputTokensBreakdown, turn.inputTokensBreakdown);
  }

  return {
    ...primary,
    ...(hasTokens ? { totalTokens } : {}),
    ...(hasInput ? { inputTokens } : {}),
    ...(hasOutput ? { outputTokens } : {}),
    ...(hasCached ? { cachedTokens } : {}),
    ...(hasCacheRead ? { cacheReadTokens } : {}),
    ...(hasCacheWrite ? { cacheWriteTokens } : {}),
    ...(hasCost ? { totalCostInUsd } : {}),
    ...(hasDuration ? { durationMs } : {}),
    ...(modelName === undefined ? {} : { modelName }),
    ...(inputTokensBreakdown === undefined ? {} : { inputTokensBreakdown }),
  };
}
