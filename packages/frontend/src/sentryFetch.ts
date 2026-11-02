import * as Sentry from '@sentry/react';

// OpenTelemetry span status code for ERROR.
const SPAN_STATUS_ERROR = 2;
const STALL_MS = 10_000;
// Bounds span size on long turns; deltas are only counted, never recorded individually.
const MAX_EVENT_MARKS = 200;
const DELTA_EVENT = 'model.message.delta';
const TURN_DONE_EVENT = 'turn.done';
const TURN_UPDATE_EVENT = 'turn.update';

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

function createSseTracker(span: Sentry.Span) {
  const decoder = new TextDecoder();
  const startedAt = performance.now();
  let lineBuffer = '';
  let pendingEvent: string | undefined;
  let pendingId: string | undefined;
  let pendingData: string | undefined;
  let lastChunkAt = startedAt;
  let maxGapMs = 0;
  let chunks = 0;
  let bytes = 0;
  let events = 0;
  let marks = 0;
  let lastEvent: string | undefined;
  let lastId: string | undefined;
  let turnStatus: string | undefined;
  let turnError: string | undefined;
  let turnDone = false;
  let ended = false;

  function dispatch() {
    if (pendingEvent === undefined && pendingId === undefined && pendingData === undefined) {
      return;
    }
    const payload = pendingData === undefined ? {} : readPayload(pendingData);
    const type = pendingEvent ?? payload.type ?? 'message';
    events += 1;
    lastEvent = type;
    lastId = pendingId ?? lastId;
    if (type === TURN_DONE_EVENT || type === TURN_UPDATE_EVENT) {
      turnDone ||= type === TURN_DONE_EVENT;
      turnStatus = payload.status ?? turnStatus;
      turnError = payload.message ?? turnError;
    }
    if (type !== DELTA_EVENT && marks < MAX_EVENT_MARKS) {
      marks += 1;
      span.addEvent(`sse.${type}`, {
        'sse.id': pendingId ?? '',
        'sse.elapsed_ms': Math.round(performance.now() - startedAt),
        ...(payload.status === undefined ? {} : { 'sse.turn_status': payload.status }),
      });
    }
    pendingEvent = undefined;
    pendingId = undefined;
    pendingData = undefined;
  }

  function readLine(line: string) {
    if (line === '') {
      dispatch();
    } else if (line.startsWith('event:')) {
      pendingEvent = line.slice('event:'.length).trim();
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
        span.addEvent('sse.stall', {
          'sse.gap_ms': Math.round(gap),
          ...(lastEvent ? { 'sse.after_event': lastEvent } : {}),
        });
      }
      maxGapMs = Math.max(maxGapMs, gap);
      if (chunks === 0) {
        span.addEvent('sse.first_chunk', { 'sse.elapsed_ms': Math.round(now - startedAt) });
      }
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
        'sse.max_gap_ms': Math.round(maxGapMs),
        'sse.ms_since_last_chunk': Math.round(now - lastChunkAt),
        'sse.duration_ms': Math.round(now - startedAt),
        ...(lastEvent === undefined ? {} : { 'sse.last_event': lastEvent }),
        ...(lastId === undefined ? {} : { 'sse.last_id': lastId }),
        ...(turnStatus === undefined ? {} : { 'sse.turn_status': turnStatus }),
        ...(turnError === undefined ? {} : { 'sse.turn_error': turnError }),
      });
      if (reason === 'error') {
        span.setStatus({ code: SPAN_STATUS_ERROR, message: 'stream_error' });
        span.addEvent('sse.error', { message: error instanceof Error ? error.message : String(error) });
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
 * Sentry only records fetch spans under an active parent, and the pageload span ends
 * shortly after load. Opening a root span for user-triggered calls keeps them traced;
 * for SSE responses it stays open until the stream ends, recording event arrival,
 * stalls and how the stream finished.
 *
 * Stream requests always get their own root span: nested under the pageload idle span
 * they would be cut off at its final timeout and lose the stream data.
 */
export function withSentryRootSpan(baseFetch: typeof fetch): typeof fetch {
  return (input, init) => {
    // Read from `input` directly: constructing a Request would consume its body.
    const isRequest = input instanceof Request;
    const headers = new Headers(init?.headers ?? (isRequest ? input.headers : undefined));
    const expectsStream = headers.get('accept')?.includes('text/event-stream') === true;
    if (!expectsStream && Sentry.getActiveSpan()) {
      return baseFetch(input, init);
    }
    const url = isRequest ? input.url : String(input);
    const method = init?.method ?? (isRequest ? input.method : 'GET');
    const { pathname } = new URL(url, window.location.origin);
    const spanOptions = { name: `${method} ${pathname}`, op: 'ui.api', ...(expectsStream ? { parentSpan: null } : {}) };
    return Sentry.startSpanManual(spanOptions, async span => {
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
    });
  };
}
