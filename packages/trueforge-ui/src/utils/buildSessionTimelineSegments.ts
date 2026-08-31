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
  parentToolCallId,
  parseTimestamp,
  readString,
  terminalCompletedAt,
  terminalMessage,
  terminalStatus,
  toolCallDescription,
  toolCallsOf,
  type TimelineEvent,
} from './sessionTimelineEvents.js';
import type { SessionTurnView } from './sessionTurnViews.js';

/**
 * Convert server turns and events into the transport-independent intervals
 * consumed by the Sessions timeline.
 *
 * The conversion runs in two passes because several bars need a later event
 * to determine their end:
 * - tool calls span from the model event that requested them to `tool.response`;
 * - sub-agent tracks span from `thread.created` to `thread.done`;
 * - approval-gated and sub-agent parent calls are excluded from ordinary tool
 *   bars because they have dedicated visual representations.
 *
 * The second pass emits one user marker per turn, then chronological event
 * segments for each thread. Finally, real idle gaps between turns are removed
 * so old sessions remain readable without changing durations inside a turn.
 */
export function buildSessionTimelineSegments(turns: SessionTurnView[]): SessionEventTimelineSegment[] {
  const originMs = parseTimestamp(turns[0]?.created.createdAt);
  if (originMs == null) return [];

  // Correlation indexes built up front let the emission pass calculate complete
  // intervals without depending on the source event order.
  const toolResponsesByTurnId = new Map<string, Map<string, TimelineEvent>>();
  const approvalRequiredIdsByTurnId = new Map<string, Set<string>>();
  const threadDoneEvents = new Map<string, TimelineEvent>();
  const subAgentToolCallIds = new Set<string>();
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
      }
    }
  }

  const segments: SessionEventTimelineSegment[] = [];

  for (const turn of turns) {
    const createdMs = parseTimestamp(turn.created.createdAt);
    if (createdMs == null) continue;
    const turnIndex = turn.turnNumber - 1;

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

    // Model intervals are independent per thread. Using one global previous
    // timestamp would make concurrent sub-agent bars consume each other's time.
    const lastTimestampByThreadId = new Map<string, number>();
    const events = [...turn.events]
      .map(asTimelineEvent)
      .filter((event): event is TimelineEvent => event != null)
      .sort(
        (left, right) => (parseTimestamp(eventCreatedAt(left)) ?? 0) - (parseTimestamp(eventCreatedAt(right)) ?? 0),
      );

    for (const event of events) {
      const eventMs = parseTimestamp(eventCreatedAt(event));
      if (eventMs == null) continue;
      const threadId = eventThreadId(event);
      appendEventSegments({
        event,
        eventMs,
        createdMs,
        originMs,
        turn,
        turnIndex,
        threadId,
        lastTimestampByThreadId,
        toolResponsesByTurnId,
        approvalRequiredIdsByTurnId,
        subAgentToolCallIds,
        threadDoneEvents,
        segments,
      });
      lastTimestampByThreadId.set(threadId, eventMs);
    }

    appendTerminalSegment({ turn, turnIndex, originMs, latestMs, segments });
  }

  return compressInterTurnGaps(
    segments.map(segment => ({
      ...segment,
      startMs: Math.max(0, segment.startMs),
      endMs: Math.max(0, segment.endMs),
    })),
  ).sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
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
  approvalRequiredIdsByTurnId,
  subAgentToolCallIds,
  threadDoneEvents,
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
  approvalRequiredIdsByTurnId: Map<string, Set<string>>;
  subAgentToolCallIds: Set<string>;
  threadDoneEvents: Map<string, TimelineEvent>;
  segments: SessionEventTimelineSegment[];
}): void {
  switch (event.type) {
    case 'model.message': {
      const previousMs = lastTimestampByThreadId.get(threadId) ?? createdMs;
      const modelContent = extractText(event.content);
      const responses = toolResponsesByTurnId.get(turn.turnId);
      const approvalIds = approvalRequiredIdsByTurnId.get(turn.turnId);

      // A model event can request several tools at once. Each tool gets its own
      // response-bounded interval; overlapping intervals are grouped later by
      // the chart-layout utility into one parallel-tool-call bar.
      for (const toolCall of toolCallsOf(event)) {
        const toolCallId = typeof toolCall.id === 'string' ? toolCall.id : undefined;
        // Skip parent create_sub_agent calls and approval-gated calls; they have their own segments.
        if (toolCallId == null || subAgentToolCallIds.has(toolCallId) || approvalIds?.has(toolCallId)) continue;
        const response = responses?.get(toolCallId);
        const responseMs = response == null ? null : parseTimestamp(eventCreatedAt(response));
        if (responseMs == null || responseMs < eventMs) continue;
        segments.push({
          id: `${eventId(event)}-${toolCallId}`,
          type: 'tool_call',
          title: 'tool.call',
          description: toolCallDescription(toolCall),
          startMs: eventMs - originMs,
          endMs: responseMs - originMs,
          turnIndex,
          threadId,
        });
      }

      // The model bar covers processing since the previous event on this thread.
      // Keep an empty root model segment because it may still contain tool calls
      // and therefore represents real model time.
      if (modelContent.length > 0 || threadId === MAIN_THREAD_ID) {
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
      const doneEvent = threadDoneEvents.get(threadId);
      const doneMs = doneEvent == null ? null : parseTimestamp(eventCreatedAt(doneEvent));
      segments.push({
        id: eventId(event),
        type: 'sub_agent',
        title: event.type,
        description: getSubAgentDescription(event),
        startMs: eventMs - originMs,
        endMs: doneMs != null && doneMs >= eventMs ? doneMs - originMs : eventMs - originMs,
        turnIndex,
        threadId,
        isMarker: doneMs == null || doneMs < eventMs,
      });
      return;
    }
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
 */
function appendTerminalSegment({
  turn,
  turnIndex,
  originMs,
  latestMs,
  segments,
}: {
  turn: SessionTurnView;
  turnIndex: number;
  originMs: number;
  latestMs: number;
  segments: SessionEventTimelineSegment[];
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
  if (status !== 'done') return;
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
