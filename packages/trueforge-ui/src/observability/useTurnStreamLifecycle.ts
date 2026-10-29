import { STREAM_STALL_THRESHOLDS_MS, type TurnStreamLifecycleEvent } from '@truefoundry/trueforge-assistant-ui-runtime';
import { useCallback } from 'react';

import { withSessionProps } from '../analytics/sessionProps.js';
import type { AnalyticsEventProps } from '../analytics/types.js';
import { useObservability } from './ObservabilityProvider.js';

function contextFor(event: TurnStreamLifecycleEvent): AnalyticsEventProps {
  switch (event.type) {
    case 'started':
      return { mode: event.mode, attempt: event.attempt };
    case 'first_event':
      return { ms_to_first_event: event.msToFirstEvent };
    case 'stalled':
      return {
        threshold_ms: event.thresholdMs,
        ms_since_last_event: event.msSinceLastEvent,
        last_sequence_number: event.lastSequenceNumber,
      };
    case 'disconnected':
      return {
        reason: event.reason,
        attempt: event.attempt,
        http_status: event.httpStatus,
        last_sequence_number: event.lastSequenceNumber,
      };
    case 'reconnected':
      return { attempt: event.attempt, gap_ms: event.gapMs };
    case 'failed':
      return {
        reason: event.reason,
        reconnect_count: event.reconnectCount,
        http_status: event.httpStatus,
        error_name: event.error instanceof Error ? event.error.name : undefined,
      };
    case 'completed':
      return {
        status: event.status,
        duration_ms: event.durationMs,
        event_count: event.eventCount,
        reconnect_count: event.reconnectCount,
      };
    case 'abandoned':
      return { ms_since_last_event: event.msSinceLastEvent, stalled: event.stalled };
  }
}

class TurnStreamStalledError extends Error {
  constructor(thresholdMs: number) {
    super(`Turn stream received no events for ${String(thresholdMs / 1000)}s`);
    this.name = 'TurnStreamStalledError';
  }
}

/**
 * Forwards runtime stream-lifecycle events to the host's error sink: a breadcrumb per step,
 * and a captured error only for transport failures and stalls.
 */
export function useTurnStreamLifecycle(agentName?: string): (event: TurnStreamLifecycleEvent) => void {
  const { captureError, addBreadcrumb } = useObservability();

  return useCallback(
    (event: TurnStreamLifecycleEvent) => {
      const context = withSessionProps(
        { ...contextFor(event), turn_id: event.turnId },
        { sessionId: event.sessionId, agentName },
      );
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
    [captureError, addBreadcrumb, agentName],
  );
}
