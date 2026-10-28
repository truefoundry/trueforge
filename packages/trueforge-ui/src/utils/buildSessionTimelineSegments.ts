import { MAIN_THREAD_ID, type SessionEventTimelineSegment } from './sessionEventTimeline.js';
import { compressInterTurnGaps } from './sessionEventTimelineChart.js';
import {
  asTimelineEvent,
  eventCreatedAt,
  eventId,
  eventThreadId,
  extractText,
  getSubAgentDescription,
  getTurnInputSummary,
  getTurnInputType,
  isAbortShapedThreadError,
  isRecord,
  parentToolCallId,
  parseTimestamp,
  readString,
  terminalCompletedAt,
  terminalMessage,
  terminalReason,
  terminalStatus,
  terminalThreadError,
  toolCallDescription,
  toolCallsOf,
  type TimelineEvent,
} from './sessionTimelineEvents.js';
import type { SessionTurnView } from './sessionTurnViews.js';

type SubAgentToolCallRequest = {
  startedAtMs: number;
  threadId: string;
  modelEventId: string;
};

/**
 * Convert server turns and events into the transport-independent intervals
 * consumed by the Sessions timeline.
 *
 * The conversion runs in two passes because several bars need a later event
 * to determine their end:
 * - tool calls span from the model event that requested them to `tool.response`,
 *   or to `tool.response_required` / turn end when still waiting on a human;
 * - sub-agent tracks span from `thread.created` to `thread.done`, or to
 *   `turn.done` when the child never emitted done (e.g. client cancel);
 * - approval-gated and sub-agent parent calls are excluded from ordinary tool
 *   bars because they have dedicated visual representations.
 *
 * The second pass emits one user marker per renderable turn, then chronological
 * event segments for each thread. Finally, real idle gaps between turns are
 * removed so old sessions remain readable without changing durations inside a turn.
 */
export function buildSessionTimelineSegments(turns: SessionTurnView[]): SessionEventTimelineSegment[] {
  const originMs = parseTimestamp(turns[0]?.created.createdAt);
  if (originMs == null) return [];

  // Correlation indexes built up front let the emission pass calculate complete
  // intervals without depending on the source event order.
  const toolResponsesByTurnId = new Map<string, Map<string, TimelineEvent>>();
  const toolResponseRequiredByTurnId = new Map<string, Map<string, TimelineEvent>>();
  const approvalRequiredIdsByTurnId = new Map<string, Set<string>>();
  const threadDoneEvents = new Map<string, TimelineEvent>();
  const subAgentToolCallIds = new Set<string>();
  const toolCallRequestsByTurnId = new Map<string, Map<string, SubAgentToolCallRequest>>();
  let latestMs = originMs;

  for (const turn of turns) {
    latestMs = Math.max(latestMs, parseTimestamp(turn.created.createdAt) ?? latestMs);
    latestMs = Math.max(latestMs, parseTimestamp(terminalCompletedAt(turn.done?.state)) ?? latestMs);
    for (const raw of turn.events) {
      const event = asTimelineEvent(raw);
      if (event == null) continue;
      latestMs = Math.max(latestMs, parseTimestamp(eventCreatedAt(event)) ?? latestMs);
      if (event.type === 'tool.response') {
        const toolCallId = readString(event, 'toolCallId', 'tool_call_id');
        if (toolCallId == null) continue;
        const responses = toolResponsesByTurnId.get(turn.turnId) ?? new Map();
        responses.set(toolCallId, event);
        toolResponsesByTurnId.set(turn.turnId, responses);
      } else if (event.type === 'tool.response_required') {
        const pending = toolResponseRequiredByTurnId.get(turn.turnId) ?? new Map();
        for (const toolCall of toolCallsOf(event)) {
          if (typeof toolCall.id === 'string') pending.set(toolCall.id, event);
        }
        toolResponseRequiredByTurnId.set(turn.turnId, pending);
      } else if (event.type === 'tool.approval_required') {
        const ids = approvalRequiredIdsByTurnId.get(turn.turnId) ?? new Set<string>();
        for (const toolCall of toolCallsOf(event)) {
          if (typeof toolCall.id === 'string') ids.add(toolCall.id);
        }
        approvalRequiredIdsByTurnId.set(turn.turnId, ids);
      } else if (event.type === 'thread.created') {
        const toolCallId = parentToolCallId(event);
        if (toolCallId != null) subAgentToolCallIds.add(toolCallId);
      } else if (event.type === 'thread.done') {
        threadDoneEvents.set(eventThreadId(event), event);
      } else if (event.type === 'model.message') {
        const startedAtMs = parseTimestamp(eventCreatedAt(event));
        if (startedAtMs == null) continue;
        const requests = toolCallRequestsByTurnId.get(turn.turnId) ?? new Map();
        for (const toolCall of toolCallsOf(event)) {
          if (typeof toolCall.id === 'string') {
            requests.set(toolCall.id, {
              startedAtMs,
              threadId: eventThreadId(event),
              modelEventId: eventId(event),
            });
          }
        }
        toolCallRequestsByTurnId.set(turn.turnId, requests);
      }
    }
  }

  const segments: SessionEventTimelineSegment[] = [];
  const emittedWaitingRequestIds = new Set<string>();
  // Only the last event-turn in a display band gets a "Turn completed" marker so
  // MCP-auth resumes don't plant a mid-band diamond on top of the next model bar.
  const lastTurnIdByNumber = new Map<number, string>();
  const displayTurnIndexByEventIndex = new Map<number, number>();
  for (const turn of turns) {
    lastTurnIdByNumber.set(turn.turnNumber, turn.turnId);
    displayTurnIndexByEventIndex.set(turn.eventTurnNumber - 1, turn.turnNumber - 1);
  }

  for (const turn of turns) {
    const createdMs = parseTimestamp(turn.created.createdAt);
    if (createdMs == null) continue;
    // Compress with unique event-turn indexes so MCP-auth idle between auth and
    // resume is removed; remap to the display band afterward.
    const turnIndex = turn.eventTurnNumber - 1;

    // Resume/MCP-auth turns have no user input; don't invent a user.message marker.
    if (turn.renderable) {
      segments.push({
        id: `${turn.turnId}-user`,
        type: 'user',
        title: getTurnInputType(turn),
        description: getTurnInputSummary(turn),
        startMs: createdMs - originMs,
        endMs: createdMs - originMs,
        turnIndex,
        threadId: MAIN_THREAD_ID,
        isMarker: true,
      });
    }

    // Model intervals are independent per thread. Using one global previous
    // timestamp would make concurrent sub-agent bars consume each other's time.
    const lastTimestampByThreadId = new Map<string, number>();
    const events = [...turn.events]
      .map(asTimelineEvent)
      .filter((event): event is TimelineEvent => event != null)
      .sort(
        (left, right) => (parseTimestamp(eventCreatedAt(left)) ?? 0) - (parseTimestamp(eventCreatedAt(right)) ?? 0),
      );

    const compactionEndMsByStartedId = compactionEndTimes(events);

    for (const event of events) {
      const eventMs = parseTimestamp(eventCreatedAt(event));
      if (eventMs == null) continue;
      const threadId = eventThreadId(event);
      appendEventSegments({
        compactionEndMsByStartedId,
        event,
        eventMs,
        createdMs,
        originMs,
        turn,
        turnIndex,
        threadId,
        lastTimestampByThreadId,
        toolResponsesByTurnId,
        toolResponseRequiredByTurnId,
        approvalRequiredIdsByTurnId,
        subAgentToolCallIds,
        toolCallRequestsByTurnId,
        threadDoneEvents,
        emittedWaitingRequestIds,
        segments,
      });
      lastTimestampByThreadId.set(threadId, eventMs);
    }

    appendTerminalSegment({
      turn,
      turnIndex,
      originMs,
      latestMs,
      segments,
      emitDoneMarker: lastTurnIdByNumber.get(turn.turnNumber) === turn.turnId,
    });
  }

  return compressInterTurnGaps(
    segments.map(segment => ({
      ...segment,
      startMs: Math.max(0, segment.startMs),
      endMs: Math.max(0, segment.endMs),
    })),
  )
    .map(segment => ({
      ...segment,
      turnIndex: displayTurnIndexByEventIndex.get(segment.turnIndex) ?? segment.turnIndex,
    }))
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
}

function readNonNegativeInt({
  record,
  camel,
  snake,
}: {
  record: Record<string, unknown>;
  camel: string;
  snake: string;
}): number | undefined {
  const camelValue = record[camel];
  if (typeof camelValue === 'number' && Number.isFinite(camelValue) && camelValue >= 0) return Math.floor(camelValue);
  const snakeValue = record[snake];
  if (typeof snakeValue === 'number' && Number.isFinite(snakeValue) && snakeValue >= 0) return Math.floor(snakeValue);
  return undefined;
}

/** Compact trigger copy for timeline tooltips when trigger carries token counts. */
function compactionTriggerDescription(event: TimelineEvent): string | undefined {
  const trigger = isRecord(event.trigger) ? event.trigger : undefined;
  if (trigger == null || trigger.type !== 'context_threshold_exceeded') return undefined;
  const contextTokens = readNonNegativeInt({ record: trigger, camel: 'contextTokens', snake: 'context_tokens' });
  const thresholdTokens = readNonNegativeInt({
    record: trigger,
    camel: 'thresholdTokens',
    snake: 'threshold_tokens',
  });
  if (contextTokens == null || thresholdTokens == null || thresholdTokens <= 0) return undefined;
  return `Context ${String(contextTokens)} / threshold ${String(thresholdTokens)} tokens`;
}

/** Maps each compaction-started id to the next finished time on the same thread. */
function compactionEndTimes(events: TimelineEvent[]): Map<string, number> {
  const openByThread = new Map<string, string>();
  const ends = new Map<string, number>();
  for (const event of events) {
    const threadId = eventThreadId(event);
    if (event.type === 'thread.context_compaction_started') {
      openByThread.set(threadId, eventId(event));
    } else if (event.type === 'thread.context_compaction_finished') {
      const startedId = openByThread.get(threadId);
      const endMs = parseTimestamp(eventCreatedAt(event));
      if (startedId != null && endMs != null) {
        ends.set(startedId, endMs);
        openByThread.delete(threadId);
      }
    }
  }
  return ends;
}

/**
 * Map one supported server event to zero or more visual segments.
 *
 * New event types should be added here
 * when they have a clear visual category and useful timing semantics.
 */
function appendEventSegments({
  event,
  eventMs,
  createdMs,
  originMs,
  turn,
  turnIndex,
  threadId,
  lastTimestampByThreadId,
  toolResponsesByTurnId,
  toolResponseRequiredByTurnId,
  approvalRequiredIdsByTurnId,
  subAgentToolCallIds,
  toolCallRequestsByTurnId,
  threadDoneEvents,
  emittedWaitingRequestIds,
  compactionEndMsByStartedId,
  segments,
}: {
  event: TimelineEvent;
  eventMs: number;
  createdMs: number;
  originMs: number;
  turn: SessionTurnView;
  turnIndex: number;
  threadId: string;
  lastTimestampByThreadId: Map<string, number>;
  toolResponsesByTurnId: Map<string, Map<string, TimelineEvent>>;
  toolResponseRequiredByTurnId: Map<string, Map<string, TimelineEvent>>;
  approvalRequiredIdsByTurnId: Map<string, Set<string>>;
  subAgentToolCallIds: Set<string>;
  toolCallRequestsByTurnId: Map<string, Map<string, SubAgentToolCallRequest>>;
  threadDoneEvents: Map<string, TimelineEvent>;
  emittedWaitingRequestIds: Set<string>;
  compactionEndMsByStartedId: Map<string, number>;
  segments: SessionEventTimelineSegment[];
}): void {
  switch (event.type) {
    case 'model.message': {
      const previousMs = lastTimestampByThreadId.get(threadId) ?? createdMs;
      const modelContent = extractText(event.content);
      const responses = toolResponsesByTurnId.get(turn.turnId);
      const pendingRequired = toolResponseRequiredByTurnId.get(turn.turnId);
      const approvalIds = approvalRequiredIdsByTurnId.get(turn.turnId);
      const turnDoneMs = parseTimestamp(terminalCompletedAt(turn.done?.state));

      // A model event can request several tools at once. Each tool gets its own
      // response-bounded interval; overlapping intervals are grouped later by
      // the chart-layout utility into one parallel-tool-call bar.
      // Pending human-wait tools (ask-user) still emit a bar so strip Tool calls
      // matches Agent steps even before tool.response arrives.
      const requestedToolCalls = toolCallsOf(event);
      for (const toolCall of requestedToolCalls) {
        const toolCallId = typeof toolCall.id === 'string' ? toolCall.id : undefined;
        // Skip parent create_sub_agent calls and approval-gated calls; they have their own segments.
        if (toolCallId == null || subAgentToolCallIds.has(toolCallId) || approvalIds?.has(toolCallId)) continue;
        const response = responses?.get(toolCallId);
        const responseMs = response == null ? null : parseTimestamp(eventCreatedAt(response));
        const required = pendingRequired?.get(toolCallId);
        const requiredMs = required == null ? null : parseTimestamp(eventCreatedAt(required));
        const endMs = responseMs ?? requiredMs ?? turnDoneMs ?? eventMs;
        if (endMs < eventMs) continue;
        segments.push({
          id: `${eventId(event)}-${toolCallId}`,
          type: 'tool_call',
          title: 'tool.call',
          description: toolCallDescription(toolCall),
          startMs: eventMs - originMs,
          endMs: endMs - originMs,
          turnIndex,
          threadId,
          ...(responseMs == null && endMs <= eventMs ? { isMarker: true } : {}),
        });
      }

      // Duration since the previous event on this thread is model time.
      // Tool-only replies have no text; still draw them on a sub-agent so the
      // wait between consecutive tool calls is visible. Root keeps a bar even
      // when the reply has neither text nor tool calls.
      if (modelContent.length > 0 || requestedToolCalls.length > 0 || threadId === MAIN_THREAD_ID) {
        segments.push({
          id: eventId(event),
          type: 'model',
          title: event.type,
          description: modelContent,
          startMs: Math.max(0, previousMs - originMs),
          endMs: Math.max(0, eventMs - originMs),
          turnIndex,
          threadId,
          isMarker: eventMs <= previousMs,
        });
      }
      return;
    }
    case 'thread.created': {
      // The parent call is represented by this track, while child events are
      // assigned to the same thread id and rendered on the track's lane.
      const parentCallId = parentToolCallId(event);
      const request = parentCallId == null ? undefined : toolCallRequestsByTurnId.get(turn.turnId)?.get(parentCallId);
      if (request != null) {
        const waitingRequestId = `${turn.turnId}:${request.modelEventId}`;
        if (!emittedWaitingRequestIds.has(waitingRequestId)) {
          emittedWaitingRequestIds.add(waitingRequestId);
          if (request.startedAtMs < eventMs) {
            segments.push({
              id: `${eventId(event)}-waiting`,
              type: 'system',
              title: 'system.waiting_for_sub_agent',
              description: 'System waiting for sub-agent to start executing',
              startMs: request.startedAtMs - originMs,
              endMs: eventMs - originMs,
              turnIndex,
              threadId: request.threadId,
            });
          }
        }
      }
      const doneEvent = threadDoneEvents.get(threadId);
      const doneMs = doneEvent == null ? null : parseTimestamp(eventCreatedAt(doneEvent));
      // Cancelled unfinished children omit public thread.done; close the bar at turn end
      // so the chart still allocates a lane for child model/tool segments.
      const turnEndMs = parseTimestamp(terminalCompletedAt(turn.done?.state)) ?? parseTimestamp(turn.done?.createdAt);
      const closeMs =
        doneMs != null && doneMs >= eventMs ? doneMs : turnEndMs != null && turnEndMs >= eventMs ? turnEndMs : eventMs;
      segments.push({
        id: eventId(event),
        type: 'sub_agent',
        title: event.type,
        description: getSubAgentDescription(event),
        startMs: eventMs - originMs,
        endMs: closeMs - originMs,
        turnIndex,
        threadId,
        isMarker: closeMs <= eventMs,
      });
      const doneState = doneEvent != null && isRecord(doneEvent.state) ? doneEvent.state : undefined;
      if (doneState != null && terminalStatus(doneState) === 'error') {
        const errorText = terminalThreadError(doneState);
        const turnCancelled = terminalStatus(turn.done?.state) === 'cancelled';
        // Cancel mid-stream can leave abort-shaped thread.done error; do not chart as failure.
        if (!(turnCancelled && isAbortShapedThreadError(errorText))) {
          const errorMs = doneMs ?? eventMs;
          segments.push({
            id: `${eventId(event)}-error`,
            type: 'error',
            title: 'thread.error',
            description: errorText,
            startMs: errorMs - originMs,
            endMs: errorMs - originMs,
            turnIndex,
            threadId,
            isMarker: true,
          });
        }
      }
      return;
    }
    case 'thread.context_compaction_started': {
      // Drawn as one bar from start to finish; unfinished compaction stays a marker.
      const endMs = compactionEndMsByStartedId.get(eventId(event)) ?? eventMs;
      segments.push({
        id: eventId(event),
        type: 'summary',
        title: event.type,
        description: compactionTriggerDescription(event) ?? 'Summarizing context',
        startMs: eventMs - originMs,
        endMs: endMs - originMs,
        turnIndex,
        threadId,
        ...(endMs <= eventMs ? { isMarker: true } : {}),
      });
      return;
    }
    case 'thread.context_compaction_finished':
      // Covered by the bar emitted for its started event.
      return;
    case 'tool.approval_required':
    case 'tool.response_required':
    case 'mcp.auth_required':
    case 'mcp.initialize':
    case 'sandbox.created':
      // These are point-in-time state transitions, so start and end are equal
      // and Chart.js renders them with the configured minimum marker width.
      segments.push({
        id: eventId(event),
        type:
          event.type === 'tool.approval_required'
            ? 'approval'
            : event.type === 'tool.response_required' || event.type === 'mcp.auth_required'
              ? 'waiting_on_human'
              : 'system',
        title: event.type,
        description:
          event.type === 'tool.approval_required'
            ? 'Approval required'
            : event.type === 'tool.response_required'
              ? 'Waiting for user response'
              : event.type === 'mcp.auth_required'
                ? 'MCP authentication required'
                : event.type === 'mcp.initialize'
                  ? 'MCP initialized'
                  : 'Sandbox created',
        startMs: eventMs - originMs,
        endMs: eventMs - originMs,
        turnIndex,
        threadId,
        isMarker: true,
      });
      return;
    default:
      return;
  }
}

/**
 * Add the terminal marker that closes a turn.
 *
 * Errors use the latest observed timestamp when the backend omitted
 * `completed_at`, ensuring failures remain visible instead of being dropped.
 * Running/paused turns have no terminal marker because they have not ended.
 * Intermediate `turn.done` markers are skipped when a later event-turn shares
 * the same display band (MCP-auth resume), so the diamond does not cover the
 * next model/tool bars.
 */
function appendTerminalSegment({
  turn,
  turnIndex,
  originMs,
  latestMs,
  segments,
  emitDoneMarker,
}: {
  turn: SessionTurnView;
  turnIndex: number;
  originMs: number;
  latestMs: number;
  segments: SessionEventTimelineSegment[];
  emitDoneMarker: boolean;
}): void {
  const status = terminalStatus(turn.done?.state);
  if (status === 'error') {
    const errorMs = parseTimestamp(terminalCompletedAt(turn.done?.state)) ?? latestMs;
    segments.push({
      id: `${turn.turnId}-error`,
      type: 'error',
      title: 'turn.error',
      description: terminalMessage(turn.done?.state),
      startMs: errorMs - originMs,
      endMs: errorMs - originMs,
      turnIndex,
      threadId: MAIN_THREAD_ID,
      isMarker: true,
    });
    return;
  }
  if (status === 'cancelled') {
    const cancelledMs = parseTimestamp(terminalCompletedAt(turn.done?.state)) ?? latestMs;
    const reason = terminalReason(turn.done?.state);
    segments.push({
      id: `${turn.turnId}-turn.cancelled`,
      type: 'system',
      title: 'turn.cancelled',
      description: reason.length > 0 ? reason : 'cancelled',
      startMs: cancelledMs - originMs,
      endMs: cancelledMs - originMs,
      turnIndex,
      threadId: MAIN_THREAD_ID,
      isMarker: true,
    });
    return;
  }
  if (status !== 'done' || !emitDoneMarker) return;
  const doneMs = parseTimestamp(terminalCompletedAt(turn.done?.state));
  if (doneMs == null) return;
  segments.push({
    id: `${turn.turnId}-turn.done`,
    type: 'system',
    title: 'turn.done',
    description: 'Turn completed',
    startMs: doneMs - originMs,
    endMs: doneMs - originMs,
    turnIndex,
    threadId: MAIN_THREAD_ID,
    isMarker: true,
  });
}
