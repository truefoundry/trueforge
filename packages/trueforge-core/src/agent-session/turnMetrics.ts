import type { AgentThreadMetrics } from '../core/runtime/metrics';
import { accrueAgentThreadMetrics, createEmptyAgentThreadMetrics } from '../core/runtime/metrics';
import type {
  CancellationReason,
  TerminalTurnState,
  TurnMetrics,
  TurnMetricsCheckpoint,
  TurnState,
} from './schemas/turn';
import { TurnMetricsCheckpointSchema } from './schemas/turn';
import { SessionStoreInvariantError } from './store/SessionStoreErrors';

/** Result of one winning pause, resume, terminal, or freeze transition. */
export interface FoldedTurnMetrics {
  checkpoint: TurnMetricsCheckpoint;
  /** Closed running interval. Zero when the turn was already paused. */
  duration_ms: number;
  /** Undefined leaves session cost untouched. */
  cost_delta: number | undefined;
  /** Set on freeze when the checkpoint has a non-zero public total. */
  public_metrics: TurnMetrics | undefined;
}

export type TurnMetricsTransition =
  | { kind: 'pause'; observed_at: string; metrics: AgentThreadMetrics }
  | { kind: 'resume'; observed_at: string }
  | {
      kind: 'terminal';
      completed_at: string;
      stored_status: 'running' | 'paused';
      /** Billable totals for the open stretch. Added to the checkpoint. */
      metrics: AgentThreadMetrics;
    }
  | { kind: 'freeze'; completed_at: string; stored_status: 'running' | 'paused' };

/** Fresh checkpoint for a new turn. Does not copy a parent turn. */
export function createInitialTurnMetricsCheckpoint(running_since: string): TurnMetricsCheckpoint {
  return {
    metrics: createEmptyAgentThreadMetrics(),
    active_duration_ms: 0,
    running_since,
  };
}

/** Copy the three metrics keys onto a snapshot or checkpoint. */
export function writeTurnMetricsCheckpoint(target: TurnMetricsCheckpoint, source: TurnMetricsCheckpoint): void {
  target.metrics = source.metrics;
  target.active_duration_ms = source.active_duration_ms;
  target.running_since = source.running_since;
}

/**
 * Legacy rows omit the metrics keys. A running row keeps `created_at` as the open
 * interval so a never-paused terminal duration stays `completed_at - created_at`.
 */
export function resolveStoredTurnMetricsCheckpoint(input: {
  checkpoint: object;
  state: TurnState;
  created_at: Date;
}): TurnMetricsCheckpoint {
  const flat = readFlatTurnMetrics(input.checkpoint);
  if (flat !== undefined) {
    return flat;
  }
  return {
    metrics: createEmptyAgentThreadMetrics(),
    active_duration_ms: 0,
    running_since: input.state.status === 'running' ? input.created_at.toISOString() : null,
  };
}

function readFlatTurnMetrics(checkpoint: object): TurnMetricsCheckpoint | undefined {
  const metrics = ownProperty(checkpoint, 'metrics');
  const activeDurationMs = ownProperty(checkpoint, 'active_duration_ms');
  const runningSince = ownProperty(checkpoint, 'running_since');
  if (metrics === undefined && activeDurationMs === undefined && runningSince === undefined) {
    return undefined;
  }
  return parseTurnMetricsCheckpoint({
    metrics,
    active_duration_ms: activeDurationMs,
    running_since: runningSince,
  });
}

function parseTurnMetricsCheckpoint(raw: unknown): TurnMetricsCheckpoint {
  const parsed = TurnMetricsCheckpointSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SessionStoreInvariantError('turn checkpoint metrics are invalid');
  }
  return parsed.data;
}

/** Public billable subset. Drops orchestrator-only counters. */
export function turnMetricsFromAgentThreadMetrics(metrics: AgentThreadMetrics): TurnMetrics {
  return {
    total_input_tokens: metrics.total_input_tokens,
    total_output_tokens: metrics.total_output_tokens,
    total_tokens: metrics.total_tokens,
    total_cache_read_tokens: metrics.total_cache_read_tokens,
    total_cache_write_tokens: metrics.total_cache_write_tokens,
    total_reasoning_tokens: metrics.total_reasoning_tokens,
    total_cost_in_usd: metrics.total_cost_in_usd,
  };
}

export function cancelledStateWithCheckpointMetrics(input: {
  reason: CancellationReason;
  completed_at: string;
  public_metrics: TurnMetrics | undefined;
}): TerminalTurnState {
  if (input.public_metrics === undefined) {
    return {
      status: 'cancelled',
      reason: input.reason,
      completed_at: input.completed_at,
    };
  }
  return {
    status: 'cancelled',
    reason: input.reason,
    completed_at: input.completed_at,
    metrics: input.public_metrics,
  };
}

/**
 * One fold for every winning transition. Pause and terminal add the stretch.
 * Duration is only the interval this transition closes.
 */
export function foldTurnMetricsCheckpoint(input: {
  stored: TurnMetricsCheckpoint;
  transition: TurnMetricsTransition;
}): FoldedTurnMetrics {
  switch (input.transition.kind) {
    case 'pause':
      return foldPause(input.stored, input.transition);
    case 'resume':
      return foldResume(input.stored, input.transition);
    case 'terminal':
      return foldTerminal(input.stored, input.transition);
    case 'freeze':
      return foldFreeze(input.stored, input.transition);
  }
}

function foldPause(
  stored: TurnMetricsCheckpoint,
  transition: Extract<TurnMetricsTransition, { kind: 'pause' }>,
): FoldedTurnMetrics {
  const duration_ms = closedRunningIntervalMs({
    running_since: stored.running_since,
    closed_at: transition.observed_at,
  });
  return {
    checkpoint: {
      metrics: accrueAgentThreadMetrics(stored.metrics, transition.metrics),
      active_duration_ms: stored.active_duration_ms + duration_ms,
      running_since: null,
    },
    duration_ms,
    cost_delta: transition.metrics.total_cost_in_usd,
    public_metrics: undefined,
  };
}

function foldResume(
  stored: TurnMetricsCheckpoint,
  transition: Extract<TurnMetricsTransition, { kind: 'resume' }>,
): FoldedTurnMetrics {
  return {
    checkpoint: {
      metrics: stored.metrics,
      active_duration_ms: stored.active_duration_ms,
      running_since: transition.observed_at,
    },
    duration_ms: 0,
    cost_delta: undefined,
    public_metrics: undefined,
  };
}

function foldTerminal(
  stored: TurnMetricsCheckpoint,
  transition: Extract<TurnMetricsTransition, { kind: 'terminal' }>,
): FoldedTurnMetrics {
  const duration_ms =
    transition.stored_status === 'running'
      ? closedRunningIntervalMs({
          running_since: stored.running_since,
          closed_at: transition.completed_at,
        })
      : 0;
  return {
    checkpoint: {
      metrics: accrueAgentThreadMetrics(stored.metrics, transition.metrics),
      active_duration_ms: stored.active_duration_ms + duration_ms,
      running_since: null,
    },
    duration_ms,
    cost_delta: transition.metrics.total_cost_in_usd,
    public_metrics: undefined,
  };
}

function foldFreeze(
  stored: TurnMetricsCheckpoint,
  transition: Extract<TurnMetricsTransition, { kind: 'freeze' }>,
): FoldedTurnMetrics {
  const duration_ms =
    transition.stored_status === 'running'
      ? closedRunningIntervalMs({
          running_since: stored.running_since,
          closed_at: transition.completed_at,
        })
      : 0;
  return {
    checkpoint: {
      metrics: stored.metrics,
      active_duration_ms: stored.active_duration_ms + duration_ms,
      running_since: transition.stored_status === 'running' ? null : stored.running_since,
    },
    duration_ms,
    cost_delta: undefined,
    public_metrics: publicMetricsIfRecorded(stored.metrics),
  };
}

function closedRunningIntervalMs(input: { running_since: string | null; closed_at: string }): number {
  if (input.running_since === null) {
    return 0;
  }
  const elapsed = Date.parse(input.closed_at) - Date.parse(input.running_since);
  if (!Number.isFinite(elapsed) || elapsed <= 0) {
    return 0;
  }
  return Math.trunc(elapsed);
}

function publicMetricsIfRecorded(metrics: AgentThreadMetrics): TurnMetrics | undefined {
  const publicMetrics = turnMetricsFromAgentThreadMetrics(metrics);
  const totals = [
    publicMetrics.total_input_tokens,
    publicMetrics.total_output_tokens,
    publicMetrics.total_tokens,
    publicMetrics.total_cache_read_tokens,
    publicMetrics.total_cache_write_tokens,
    publicMetrics.total_reasoning_tokens,
    publicMetrics.total_cost_in_usd,
  ];
  if (!totals.some(value => value !== undefined && value > 0)) {
    return undefined;
  }
  return publicMetrics;
}

function ownProperty(value: object, key: string): unknown {
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (entryKey === key) {
      return entryValue;
    }
  }
  return undefined;
}
