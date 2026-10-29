import { TurnFailedError, TurnStreamDisconnectedError } from './convertTurnMessages.js';

export type TurnStreamMode = 'create' | 'subscribe';

export type TurnStreamFailureReason = 'closed_without_done' | 'network_error' | 'http_error' | 'timeout' | 'turn_error';

interface TurnStreamLifecycleBase {
  sessionId: string;
  turnId: string;
}

/**
 * `attempt` is the zero-based stream attempt: 0 is the initial request, 1+ are
 * subscribe retries after a drop.
 */
export type TurnStreamLifecycleEvent = TurnStreamLifecycleBase &
  (
    | { type: 'started'; mode: TurnStreamMode; attempt: number }
    | { type: 'first_event'; msToFirstEvent: number }
    | { type: 'stalled'; thresholdMs: number; msSinceLastEvent: number; lastSequenceNumber?: number }
    | {
        type: 'disconnected';
        reason: TurnStreamFailureReason;
        attempt: number;
        httpStatus?: number;
        lastSequenceNumber?: number;
        error: unknown;
      }
    | { type: 'reconnected'; attempt: number; gapMs: number }
    | { type: 'failed'; reason: TurnStreamFailureReason; reconnectCount: number; httpStatus?: number; error: unknown }
    | {
        type: 'completed';
        status: 'done' | 'cancelled';
        durationMs: number;
        eventCount: number;
        reconnectCount: number;
      }
    | { type: 'abandoned'; msSinceLastEvent: number; stalled: boolean }
  );

/** Silence thresholds that report `stalled`; each fires once per silent stretch. */
export const STREAM_STALL_THRESHOLDS_MS = [30_000, 60_000, 120_000];

const STREAM_STALL_CHECK_INTERVAL_MS = 5_000;

function readHttpStatus(error: unknown): number | undefined {
  if (error == null || typeof error !== 'object') {
    return undefined;
  }
  const status: unknown = Reflect.get(error, 'statusCode');
  return typeof status === 'number' ? status : undefined;
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === 'TrueForgeTimeoutError' || /^"?timeout"?$/i.test(error.message.trim());
}

export function classifyStreamError(error: unknown): { reason: TurnStreamFailureReason; httpStatus?: number } {
  if (error instanceof TurnFailedError) {
    return { reason: 'turn_error' };
  }
  if (error instanceof TurnStreamDisconnectedError) {
    return { reason: 'closed_without_done' };
  }
  if (isTimeoutError(error)) {
    return { reason: 'timeout' };
  }
  const httpStatus = readHttpStatus(error);
  return httpStatus != null ? { reason: 'http_error', httpStatus } : { reason: 'network_error' };
}

export interface StreamLifecycleReporter {
  start(mode: TurnStreamMode): void;
  onEvent(sequenceNumber?: number): void;
  /** Transport drop that will be retried via subscribe. */
  disconnected(error: unknown): void;
  /** Terminal failure: retries exhausted, not retryable, or `turn.done` with an error. */
  failed(error: unknown): void;
  completed(status: 'done' | 'cancelled'): void;
  /** No-op after a terminal event; otherwise the client detached mid-turn. */
  abandon(): void;
  dispose(): void;
}

export function createStreamLifecycleReporter({
  sessionId,
  getTurnId,
  emit,
  now = Date.now,
}: {
  sessionId: string;
  /** Read per event: the optimistic id is replaced by the gateway id after `turn.created`. */
  getTurnId: () => string;
  emit: (event: TurnStreamLifecycleEvent) => void;
  now?: () => number;
}): StreamLifecycleReporter {
  const startedAt = now();
  let attempts = -1;
  let lastActivityAt = startedAt;
  let lastSequenceNumber: number | undefined;
  let eventCount = 0;
  let sawFirstEvent = false;
  let disconnectedAt: number | null = null;
  let terminal = false;
  let stalled = false;
  let firedThresholds = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let heldStart: DistributiveOmit<TurnStreamLifecycleEvent> | null = null;

  const emitSafely = (event: DistributiveOmit<TurnStreamLifecycleEvent>): void => {
    // Analytics must never break the stream.
    try {
      emit({ sessionId, turnId: getTurnId(), ...event });
    } catch {
      /* swallow */
    }
  };

  const send = (event: DistributiveOmit<TurnStreamLifecycleEvent>): void => {
    if (heldStart != null) {
      const started = heldStart;
      heldStart = null;
      emitSafely(started);
    }
    emitSafely(event);
  };

  const resetSilence = (): void => {
    lastActivityAt = now();
    firedThresholds = 0;
    stalled = false;
  };

  const checkStall = (): void => {
    const silentMs = now() - lastActivityAt;
    while (
      firedThresholds < STREAM_STALL_THRESHOLDS_MS.length &&
      silentMs >= (STREAM_STALL_THRESHOLDS_MS[firedThresholds] ?? Infinity)
    ) {
      stalled = true;
      send({
        type: 'stalled',
        thresholdMs: STREAM_STALL_THRESHOLDS_MS[firedThresholds] ?? 0,
        msSinceLastEvent: silentMs,
        ...(lastSequenceNumber != null ? { lastSequenceNumber } : {}),
      });
      firedThresholds += 1;
    }
  };

  const stopTimer = (): void => {
    if (timer != null) {
      clearInterval(timer);
      timer = null;
    }
  };

  return {
    start(mode) {
      attempts += 1;
      resetSilence();
      const started: DistributiveOmit<TurnStreamLifecycleEvent> = { type: 'started', mode, attempt: attempts };
      // A create stream learns its gateway turn id from `turn.created`; hold `started`
      // until the next event so it carries the same id as the outcome.
      if (mode === 'create') {
        heldStart = started;
      } else {
        send(started);
      }
      timer ??= setInterval(checkStall, STREAM_STALL_CHECK_INTERVAL_MS);
    },
    onEvent(sequenceNumber) {
      const at = now();
      if (!sawFirstEvent) {
        sawFirstEvent = true;
        send({ type: 'first_event', msToFirstEvent: at - startedAt });
      }
      if (disconnectedAt != null) {
        send({ type: 'reconnected', attempt: attempts, gapMs: at - disconnectedAt });
        disconnectedAt = null;
      }
      if (sequenceNumber != null) {
        lastSequenceNumber = sequenceNumber;
      }
      eventCount += 1;
      resetSilence();
    },
    disconnected(error) {
      disconnectedAt = now();
      resetSilence();
      const { reason, httpStatus } = classifyStreamError(error);
      send({
        type: 'disconnected',
        reason,
        attempt: attempts,
        error,
        ...(httpStatus != null ? { httpStatus } : {}),
        ...(lastSequenceNumber != null ? { lastSequenceNumber } : {}),
      });
    },
    failed(error) {
      if (terminal) {
        return;
      }
      terminal = true;
      stopTimer();
      const { reason, httpStatus } = classifyStreamError(error);
      send({
        type: 'failed',
        reason,
        reconnectCount: Math.max(attempts, 0),
        error,
        ...(httpStatus != null ? { httpStatus } : {}),
      });
    },
    completed(status) {
      if (terminal) {
        return;
      }
      terminal = true;
      stopTimer();
      send({
        type: 'completed',
        status,
        durationMs: now() - startedAt,
        eventCount,
        reconnectCount: Math.max(attempts, 0),
      });
    },
    abandon() {
      if (terminal) {
        return;
      }
      terminal = true;
      stopTimer();
      send({ type: 'abandoned', msSinceLastEvent: now() - lastActivityAt, stalled });
    },
    dispose: stopTimer,
  };
}

type DistributiveOmit<T> = T extends unknown ? Omit<T, 'sessionId' | 'turnId'> : never;
