import * as Sentry from '@sentry/react';

// OpenTelemetry span status code for ERROR.
const SPAN_STATUS_ERROR = 2;
const STALL_MS = 10_000;
const TURN_DONE_EVENT = 'turn.done';
const TURN_UPDATE_EVENT = 'turn.update';
// Tracing is limited to session/turn calls (where streaming failures happen) to keep Sentry cost down.
const SESSIONS_API_PATH = '/api/v1/sessions';

/** `completed` once `turn.done` arrived; the client cancels the body right after it, so that is not a failure. */
type EndReason = 'completed' | 'closed' | 'cancelled' | 'error';
type ReadEnd = 'closed' | 'cancelled' | 'error';

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** The turn streams carry the event type in the JSON payload, not in `event:` lines. */
function readPayload(data: string): { type?: string; status?: string; message?: string } {
  try {
    const parsed: unknown = JSON.parse(data);
    const state = field(parsed, 'state');
    const type = optionalString(field(parsed, 'type'));
    const status = optionalString(field(state, 'status'));
    const message = optionalString(field(state, 'message'));
    return {
      ...(type === undefined ? {} : { type }),
      ...(status === undefined ? {} : { status }),
      ...(message === undefined ? {} : { message }),
    };
  } catch {
    return {};
  }
}

// Sentry drops span events that are not measurements, so stream state is recorded as attributes.
function createSseTracker(span: Sentry.Span) {
  const decoder = new TextDecoder();
  const startedAt = performance.now();
  let lineBuffer = '';
  let pendingId: string | undefined;
  let pendingData: string | undefined;
  let lastChunkAt = startedAt;
  let maxGapMs = 0;
  let chunks = 0;
  let bytes = 0;
  let events = 0;
  let stalls = 0;
  let firstChunkMs: number | undefined;
  let lastEvent: string | undefined;
  let lastId: string | undefined;
  let turnStatus: string | undefined;
  let turnError: string | undefined;
  let turnDone = false;
  let ended = false;

  function dispatch() {
    if (pendingId === undefined && pendingData === undefined) {
      return;
    }
    const payload = pendingData === undefined ? {} : readPayload(pendingData);
    const type = payload.type ?? 'message';
    events += 1;
    lastEvent = type;
    lastId = pendingId ?? lastId;
    if (type === TURN_DONE_EVENT || type === TURN_UPDATE_EVENT) {
      turnDone ||= type === TURN_DONE_EVENT;
      turnStatus = payload.status ?? turnStatus;
      turnError = payload.message ?? turnError;
    }
    pendingId = undefined;
    pendingData = undefined;
  }

  function readLine(line: string) {
    if (line === '') {
      dispatch();
    } else if (line.startsWith('id:')) {
      pendingId = line.slice('id:'.length).trim();
    } else if (line.startsWith('data:')) {
      const data = line.slice('data:'.length).trim();
      pendingData = pendingData === undefined ? data : `${pendingData}\n${data}`;
    }
  }

  return {
    onChunk(value: Uint8Array) {
      const now = performance.now();
      const gap = now - lastChunkAt;
      if (chunks > 0 && gap > STALL_MS) {
        stalls += 1;
      }
      maxGapMs = Math.max(maxGapMs, gap);
      firstChunkMs ??= Math.round(now - startedAt);
      lastChunkAt = now;
      chunks += 1;
      bytes += value.byteLength;
      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() ?? '';
      lines.forEach(readLine);
    },
    end(readEnd: ReadEnd, error?: unknown) {
      if (ended) {
        return;
      }
      ended = true;
      const now = performance.now();
      const reason: EndReason = readEnd !== 'error' && turnDone ? 'completed' : readEnd;
      span.setAttributes({
        'sse.end_reason': reason,
        'sse.chunks': chunks,
        'sse.bytes': bytes,
        'sse.events': events,
        'sse.stalls': stalls,
        'sse.max_gap_ms': Math.round(maxGapMs),
        'sse.ms_since_last_chunk': Math.round(now - lastChunkAt),
        'sse.duration_ms': Math.round(now - startedAt),
        ...(firstChunkMs === undefined ? {} : { 'sse.first_chunk_ms': firstChunkMs }),
        ...(lastEvent === undefined ? {} : { 'sse.last_event': lastEvent }),
        ...(lastId === undefined ? {} : { 'sse.last_id': lastId }),
        ...(turnStatus === undefined ? {} : { 'sse.turn_status': turnStatus }),
        ...(turnError === undefined ? {} : { 'sse.turn_error': turnError }),
      });
      if (reason === 'error') {
        span.setStatus({ code: SPAN_STATUS_ERROR, message: 'stream_error' });
        span.setAttribute('sse.error', error instanceof Error ? error.message : String(error));
      } else if (turnStatus === 'error') {
        span.setStatus({ code: SPAN_STATUS_ERROR, message: 'turn_error' });
      }
      span.end();
    },
  };
}

function traceSseBody(body: ReadableStream<Uint8Array>, span: Sentry.Span): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const tracker = createSseTracker(span);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          tracker.end('closed');
          controller.close();
          return;
        }
        tracker.onChunk(value);
        controller.enqueue(value);
      } catch (err) {
        tracker.end('error', err);
        controller.error(err);
      }
    },
    cancel(reason) {
      tracker.end('cancelled');
      return reader.cancel(reason);
    },
  });
}

/**
 * Only session API calls are traced, each as the root of its own trace. For SSE responses
 * the span stays open until the stream ends, recording stream timing, stalls and how the
 * stream finished.
 */
export function withSentryRootSpan(baseFetch: typeof fetch): typeof fetch {
  return (input, init) => {
    // Read from `input` directly: constructing a Request would consume its body.
    const isRequest = input instanceof Request;
    const url = isRequest ? input.url : String(input);
    const { pathname } = new URL(url, window.location.origin);
    if (!pathname.includes(SESSIONS_API_PATH)) {
      // A session span stays active while its request is in flight; keep unrelated calls out of it.
      return Sentry.withActiveSpan(null, () => baseFetch(input, init));
    }
    const method = init?.method ?? (isRequest ? input.method : 'GET');
    // Without page-load/navigation spans the trace id never rotates, so start one per call.
    return Sentry.startNewTrace(() =>
      Sentry.startSpanManual({ name: `${method} ${pathname}`, op: 'ui.api' }, async span => {
        try {
          const response = await baseFetch(input, init);
          span.setAttribute('http.response.status_code', response.status);
          const isEventStream = response.headers.get('content-type')?.includes('text/event-stream') === true;
          if (!isEventStream || response.body === null) {
            span.end();
            return response;
          }
          return new Response(traceSseBody(response.body, span), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        } catch (err) {
          span.setStatus({ code: SPAN_STATUS_ERROR, message: 'fetch_failed' });
          span.end();
          throw err;
        }
      }),
    );
  };
}
