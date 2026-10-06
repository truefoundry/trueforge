import type { TrueForgeApi } from '@truefoundry/trueforge-sdk';
import type {
  NonTerminalTurnState,
  SessionEventItem,
  TurnDoneMetrics,
  TurnInboundEvent,
  TurnState,
  TurnStatePaused,
  TurnStreamingEvent,
} from '../../server/types.js';

/** SDK token fields are optional; the UI contract requires numbers. Keep cost for session tiles. */
export function toUiTurnDoneMetrics(metrics: TrueForgeApi.TurnMetrics): TurnDoneMetrics {
  return {
    totalInputTokens: metrics.totalInputTokens ?? 0,
    totalOutputTokens: metrics.totalOutputTokens ?? 0,
    totalTokens: metrics.totalTokens ?? 0,
    totalCacheReadTokens: metrics.totalCacheReadTokens ?? 0,
    totalCacheWriteTokens: metrics.totalCacheWriteTokens ?? 0,
    totalReasoningTokens: metrics.totalReasoningTokens ?? 0,
    ...(metrics.totalCostInUsd == null ? {} : { totalCostInUsd: metrics.totalCostInUsd }),
  };
}

function actionRequiredFromUnknown(value: unknown): TurnStatePaused['actionRequiredOnEvents'] {
  if (!Array.isArray(value)) {
    return [];
  }
  const events: TurnStatePaused['actionRequiredOnEvents'] = [];
  for (const item of value) {
    if (item != null && typeof item === 'object' && 'id' in item && typeof item.id === 'string') {
      events.push({ id: item.id });
    }
  }
  return events;
}

/** SDK paused may omit the list (always empty on the wire); the UI type still requires it. */
function toUiPausedTurnState(state: { status: 'paused' }): TurnStatePaused {
  return {
    status: 'paused',
    actionRequiredOnEvents: actionRequiredFromUnknown(
      Reflect.get(state, 'actionRequiredOnEvents') ?? Reflect.get(state, 'action_required_on_events'),
    ),
  };
}

export function toUiTurnState(state: TrueForgeApi.TurnState | TrueForgeApi.TurnDoneEventState): TurnState {
  if (state.status === 'running') {
    return { status: 'running' };
  }
  if (state.status === 'paused') {
    return toUiPausedTurnState(state);
  }
  return toUiTerminalTurnState(state);
}

function toUiTurnUpdateState(state: TrueForgeApi.TurnUpdateEventState): NonTerminalTurnState {
  return state.status === 'running' ? { status: 'running' } : toUiPausedTurnState(state);
}

function toUiTerminalTurnState(
  state: TrueForgeApi.TurnDoneEventState,
): Exclude<TurnState, { status: 'running' | 'paused' }> {
  switch (state.status) {
    case 'cancelled':
      return {
        status: 'cancelled',
        reason: state.reason,
        completedAt: state.completedAt,
        ...(state.metrics == null ? {} : { metrics: toUiTurnDoneMetrics(state.metrics) }),
      };
    case 'error':
      return {
        status: 'error',
        message: state.message,
        completedAt: state.completedAt,
        ...(state.metrics == null ? {} : { metrics: toUiTurnDoneMetrics(state.metrics) }),
      };
    case 'done':
      return {
        status: 'done',
        completedAt: state.completedAt,
        requiredActions: state.requiredActions,
        ...(state.output == null ? {} : { output: state.output }),
        ...(state.metrics == null ? {} : { metrics: toUiTurnDoneMetrics(state.metrics) }),
      };
  }
}

export function toUiSessionEvent(event: TrueForgeApi.SessionEvent): SessionEventItem['event'] | undefined {
  if (event.type === 'turn.update') return { ...event, state: toUiTurnUpdateState(event.state) };
  if (event.type !== 'turn.done') return { ...event };
  return { ...event, state: toUiTerminalTurnState(event.state) };
}

export function toUiStreamingEvent(event: TrueForgeApi.TurnStreamingEvent): TurnStreamingEvent | undefined {
  if (event.type === 'turn.update') return { ...event, state: toUiTurnUpdateState(event.state) };
  if (event.type !== 'turn.done') return { ...event };
  return { ...event, state: toUiTerminalTurnState(event.state) };
}

export function toUiEventItem(item: TrueForgeApi.SessionEventItem): SessionEventItem | undefined {
  const event = toUiSessionEvent(item.event);
  return event === undefined ? undefined : { turnId: item.turnId, event };
}

export function toUiInboundEvent(event: TrueForgeApi.TurnUserEvent): TurnInboundEvent {
  return { ...event };
}
