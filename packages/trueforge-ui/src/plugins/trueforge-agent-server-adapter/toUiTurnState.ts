import type { TrueForgeApi } from '@truefoundry/trueforge-sdk';
import type { SessionEventItem, TurnDoneMetrics, TurnState, TurnStreamingEvent } from '../../server/types.js';

/** SDK token fields are optional; the UI contract requires numbers. Keep cost for session tiles. */
export function toUiTurnDoneMetrics(metrics: TrueForgeApi.TurnMetrics): TurnDoneMetrics & { totalCostInUsd?: number } {
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

export function toUiTurnState(state: TrueForgeApi.TurnState | TrueForgeApi.TurnDoneEventState): TurnState {
  return state.status === 'running' ? { status: 'running' } : toUiTerminalTurnState(state);
}

function toUiTerminalTurnState(state: TrueForgeApi.TurnDoneEventState): Exclude<TurnState, { status: 'running' }> {
  switch (state.status) {
    case 'cancelled':
      return { status: 'cancelled', reason: state.reason, completedAt: state.completedAt };
    case 'error':
      return { status: 'error', message: state.message, completedAt: state.completedAt };
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
  // TODO: map turn.update when the runtime event union includes it
  if (event.type === 'turn.update') return undefined;
  if (event.type !== 'turn.done') return { ...event };
  return { ...event, state: toUiTerminalTurnState(event.state) };
}

export function toUiStreamingEvent(event: TrueForgeApi.TurnStreamingEvent): TurnStreamingEvent | undefined {
  // TODO: map turn.update when the runtime event union includes it
  if (event.type === 'turn.update') return undefined;
  if (event.type !== 'turn.done') return { ...event };
  return { ...event, state: toUiTerminalTurnState(event.state) };
}

export function toUiEventItem(item: TrueForgeApi.SessionEventItem): SessionEventItem | undefined {
  const event = toUiSessionEvent(item.event);
  return event === undefined ? undefined : { turnId: item.turnId, event };
}
