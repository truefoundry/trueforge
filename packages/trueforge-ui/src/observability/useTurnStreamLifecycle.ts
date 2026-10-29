import { STREAM_STALL_THRESHOLDS_MS, type TurnStreamLifecycleEvent } from '@truefoundry/trueforge-assistant-ui-runtime';
import { useCallback } from 'react';

import { useTrackAnalytics } from '../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../analytics/events.js';
import { withSessionProps } from '../analytics/sessionProps.js';
import type { AnalyticsEventProps } from '../analytics/types.js';
import { useObservability } from './ObservabilityProvider.js';

function analyticsFor(event: TurnStreamLifecycleEvent): { name: string; props: AnalyticsEventProps } {
  switch (event.type) {
    case 'started':
      return { name: AnalyticsEvents.TurnStream.STARTED, props: { mode: event.mode, attempt: event.attempt } };
    case 'first_event':
      return { name: AnalyticsEvents.TurnStream.FIRST_EVENT, props: { ms_to_first_event: event.msToFirstEvent } };
    case 'stalled':
      return {
        name: AnalyticsEvents.TurnStream.STALLED,
        props: {
          threshold_ms: event.thresholdMs,
          ms_since_last_event: event.msSinceLastEvent,
          last_sequence_number: event.lastSequenceNumber,
        },
      };
    case 'disconnected':
      return {
        name: AnalyticsEvents.TurnStream.DISCONNECTED,
        props: {
          reason: event.reason,
          attempt: event.attempt,
          http_status: event.httpStatus,
          last_sequence_number: event.lastSequenceNumber,
        },
      };
    case 'reconnected':
      return { name: AnalyticsEvents.TurnStream.RECONNECTED, props: { attempt: event.attempt, gap_ms: event.gapMs } };
    case 'failed':
      return {
        name: AnalyticsEvents.TurnStream.FAILED,
        props: {
          reason: event.reason,
          reconnect_count: event.reconnectCount,
          http_status: event.httpStatus,
          error_name: event.error instanceof Error ? event.error.name : undefined,
        },
      };
    case 'completed':
      return {
        name: AnalyticsEvents.TurnStream.COMPLETED,
        props: {
          status: event.status,
          duration_ms: event.durationMs,
          event_count: event.eventCount,
          reconnect_count: event.reconnectCount,
        },
      };
    case 'abandoned':
      return {
        name: AnalyticsEvents.TurnStream.ABANDONED,
        props: { ms_since_last_event: event.msSinceLastEvent, stalled: event.stalled },
      };
  }
}

class TurnStreamStalledError extends Error {
  constructor(thresholdMs: number) {
    super(`Turn stream received no events for ${String(thresholdMs / 1000)}s`);
    this.name = 'TurnStreamStalledError';
  }
}

/**
 * Fans one runtime stream-lifecycle event out to analytics (every step) and to the host's
 * error sink (breadcrumb per step; capture only for transport failures and stalls).
 */
export function useTurnStreamLifecycle(agentName?: string): (event: TurnStreamLifecycleEvent) => void {
  const track = useTrackAnalytics();
  const { captureError, addBreadcrumb } = useObservability();

  return useCallback(
    (event: TurnStreamLifecycleEvent) => {
      const { name, props } = analyticsFor(event);
      const context = withSessionProps({ ...props, turn_id: event.turnId }, { sessionId: event.sessionId, agentName });
      track(name, context);
      addBreadcrumb?.({ category: 'trueforge.turn_stream', message: event.type, data: context });

      if (event.type === 'stalled') {
        // Later thresholds of the same silent stretch stay breadcrumbs, not duplicate issues.
        if (event.thresholdMs === STREAM_STALL_THRESHOLDS_MS[0]) {
          captureError?.(new TurnStreamStalledError(event.thresholdMs), context);
        }
      } else if (event.type === 'failed' && event.reason !== 'turn_error') {
        // `turn_error` is the agent's own failure (model/tool), not a stream problem.
        captureError?.(event.error, context);
      }
    },
    [track, captureError, addBreadcrumb, agentName],
  );
}
