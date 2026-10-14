import { MAIN_THREAD_ID, type SessionEventTimelineSegment } from './sessionEventTimeline.js';
import { compressInterTurnGaps, compressIntraTurnPauses } from './sessionEventTimelineChart.js';
import {
  asTimelineEvent,
  eventCreatedAt,
  eventId,
  eventThreadId,
  extractText,
  getSubAgentDescription,
  getTurnInputSummary,
  getTurnInputType,
  isRecord,
  mcpToolSlashLabel,
  parentToolCallId,
  parseTimestamp,
  readString,
  summarizeApprovalRequiredTools,
  summarizeToolApproval,
  summarizeToolApprovalPolicy,
  terminalCompletedAt,
  terminalMessage,
  terminalStatus,
  toolCallDescription,
  toolCallsOf,
  type TimelineEvent,
} from './sessionTimelineEvents.js';
import type { SessionTurnView } from './sessionTurnViews.js';

type SubAgentToolCallRequest = {
  startedAtMs: number;
  threadId: string;
  modelEventId: string;
  toolCall: Record<string, unknown>;
};

/** Wall-clock range while the turn was paused waiting on a human. */
type PauseWindow = {
  startMs: number;
  endMs: number;
  eventId: string;
};

/** Events that mean “a person had to act” — used to decide if a pause gets a chip. */
const PAUSE_CHIP_HUMAN_EVENT_TYPES = new Set([
  'tool.approval_required',
  'tool.response_required',
  'mcp.auth_required',
  'user.tool_approval',
  'user.tool_approval_policy',
  'user.tool_response',
  'user.mcp_auth_continue',
]);

/** Ignore tiny pauses (noise); only show chips for waits ≥ 1s. */
const MIN_PAUSE_CHIP_WALL_MS = 1_000;
/**
 * Gateway often emits approval_required a few ms *before* turn.update paused.
 * Treat those as inside the pause so they don’t leave a gap before the chip.
 */
const PAUSE_EVENT_LEAD_MS = 50;

function turnUpdateStatus(event: TimelineEvent): string | undefined {
  const state = isRecord(event.state) ? event.state : undefined;
  return typeof state?.status === 'string' ? state.status : undefined;
}

/**
 * Walk turn.update events and build paused→running windows.
 * Still-open pauses end at turn done (or “now” while the turn is waiting).
 */
function collectPauseWindows({
  events,
  turnDoneMs,
  nowMs,
}: {
  events: TimelineEvent[];
  turnDoneMs: number | null;
  nowMs: number;
}): PauseWindow[] {
  const windows: PauseWindow[] = [];
  let open: { startMs: number; eventId: string } | undefined;

  for (const event of events) {
    if (event.type !== 'turn.update') continue;
    const eventMs = parseTimestamp(eventCreatedAt(event));
    if (eventMs == null) continue;
    const status = turnUpdateStatus(event);
    if (status === 'paused') {
      if (open == null) open = { startMs: eventMs, eventId: eventId(event) };
      continue;
    }
    if (status === 'running' && open != null) {
      windows.push({
        startMs: open.startMs,
        endMs: Math.max(open.startMs, eventMs),
        eventId: open.eventId,
      });
      open = undefined;
    }
  }

  if (open != null) {
    const endMs = turnDoneMs ?? nowMs;
    windows.push({
      startMs: open.startMs,
      endMs: Math.max(open.startMs, endMs),
      eventId: open.eventId,
    });
  }

  return windows;
}

/** True if something in this pause window needed a human (approval, ask-user, MCP auth). */
function pauseHasHumanAction({ events, window }: { events: TimelineEvent[]; window: PauseWindow }): boolean {
  return events.some(event => {
    if (!PAUSE_CHIP_HUMAN_EVENT_TYPES.has(event.type)) return false;
    const eventMs = parseTimestamp(eventCreatedAt(event));
    return eventMs != null && pauseWindowForMs([window], eventMs) != null;
  });
}

/** Which pause (if any) contains this timestamp, allowing a small lead before paused. */
function pauseWindowForMs(windows: PauseWindow[], eventMs: number): PauseWindow | undefined {
  return windows.find(window => eventMs >= window.startMs - PAUSE_EVENT_LEAD_MS && eventMs <= window.endMs);
}

/**
 * Place a marker on its pause chip and remember how far into the wait it was.
 *
 * Example: pause 10:00–10:02; user approves at 10:01:30 →
 * diamond anchors to chip start, pauseOffsetMs = 90s (drawn mid-chip later).
 */
function pauseAnchorFields({
  windows,
  eventMs,
  originMs,
}: {
  windows: PauseWindow[];
  eventMs: number;
  originMs: number;
}): { startMs: number; endMs: number; pauseOffsetMs?: number } {
  const window = pauseWindowForMs(windows, eventMs);
  if (window == null) {
    return { startMs: eventMs - originMs, endMs: eventMs - originMs };
  }
  const anchoredMs = Math.max(eventMs, window.startMs);
  return {
    startMs: anchoredMs - originMs,
    endMs: anchoredMs - originMs,
    pauseOffsetMs: Math.max(0, eventMs - window.startMs),
  };
}

/**
 * When an approval-gated tool may resume after the pause.
 * The tool_call bar starts here (not at the original model request) so the
 * hatched pause chip owns the wait and the bar shows real tool execution.
 */
function collectApprovalToolResumeMs({
  events,
  pauseWindows,
}: {
  events: TimelineEvent[];
  pauseWindows: PauseWindow[];
}): Map<string, number> {
  const resumeByToolCallId = new Map<string, number>();
  for (const event of events) {
    if (event.type !== 'tool.approval_required') continue;
    const eventMs = parseTimestamp(eventCreatedAt(event));
    if (eventMs == null) continue;
    const window = pauseWindowForMs(pauseWindows, eventMs);
    if (window == null) continue;
    for (const toolCall of toolCallsOf(event)) {
      if (typeof toolCall.id === 'string') resumeByToolCallId.set(toolCall.id, window.endMs);
    }
  }
  for (const event of events) {
    if (event.type !== 'user.tool_approval') continue;
    const toolCallId = readString(event, 'toolCallId', 'tool_call_id');
    const eventMs = parseTimestamp(eventCreatedAt(event));
    if (toolCallId == null || eventMs == null) continue;
    const window = pauseWindowForMs(pauseWindows, eventMs);
    // Prefer pause end so the post-approval tool bar starts immediately after the chip.
    const resumeMs = window != null ? Math.max(window.endMs, eventMs) : eventMs;
    const existing = resumeByToolCallId.get(toolCallId);
    resumeByToolCallId.set(toolCallId, existing != null ? Math.max(existing, resumeMs) : resumeMs);
  }
  return resumeByToolCallId;
}

/**
 * Convert server turns/events into timeline segments for the chart.
 *
 * Pass 1 — index later-needed ends (tool.response, thread.done, approvals).
 * Pass 2 — emit bars/markers in time order, then pause chips.
 * Finally — compress pauses + idle between turns so the chart stays readable.
 *
 * Rough mapping:
 * - model.message → model bar (+ tool_call bars per tool)
 * - thread.created → sub_agent track until thread.done
 * - turn.update paused (with human action) → hatched pause chip
 * - approval / ask-user / auth → diamonds, often on that chip
 */
export function buildSessionTimelineSegments(
  turns: SessionTurnView[],
  { nowMs = Date.now() }: { nowMs?: number } = {},
): SessionEventTimelineSegment[] {
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
        const ids = approvalRequiredIdsByTurnId.get(turn.turnId) ?? new Set();
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
              toolCall,
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

    const turnDoneMs = parseTimestamp(terminalCompletedAt(turn.done?.state));
    // Build pause chips first so later markers can attach via pauseAnchorFields.
    const pauseWindows = collectPauseWindows({ events, turnDoneMs, nowMs });
    for (const window of pauseWindows) {
      const wallDurationMs = Math.max(0, window.endMs - window.startMs);
      // Skip tiny auto-pauses unless a human-action event sat inside the window.
      const emitChip = wallDurationMs >= MIN_PAUSE_CHIP_WALL_MS || pauseHasHumanAction({ events, window });
      if (!emitChip) continue;
      segments.push({
        id: `${window.eventId}-pause`,
        type: 'waiting_on_human',
        title: 'turn.paused',
        description: 'Paused',
        startMs: window.startMs - originMs,
        endMs: window.endMs - originMs,
        turnIndex,
        threadId: MAIN_THREAD_ID,
        isPauseChip: true,
        wallDurationMs,
      });
    }
    const approvalToolResumeMs = collectApprovalToolResumeMs({ events, pauseWindows });

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
        toolResponseRequiredByTurnId,
        approvalRequiredIdsByTurnId,
        approvalToolResumeMs,
        pauseWindows,
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

  // Collapse long waits so active bars stay wide; chart re-expands pause chips.
  return compressInterTurnGaps(
    compressIntraTurnPauses(
      segments.map(segment => ({
        ...segment,
        startMs: Math.max(0, segment.startMs),
        endMs: Math.max(0, segment.endMs),
      })),
    ),
  )
    .map(segment => ({
      ...segment,
      turnIndex: displayTurnIndexByEventIndex.get(segment.turnIndex) ?? segment.turnIndex,
    }))
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
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
  approvalToolResumeMs,
  pauseWindows,
  subAgentToolCallIds,
  toolCallRequestsByTurnId,
  threadDoneEvents,
  emittedWaitingRequestIds,
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
  approvalToolResumeMs: Map<string, number>;
  pauseWindows: PauseWindow[];
  subAgentToolCallIds: Set<string>;
  toolCallRequestsByTurnId: Map<string, Map<string, SubAgentToolCallRequest>>;
  threadDoneEvents: Map<string, TimelineEvent>;
  emittedWaitingRequestIds: Set<string>;
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
      // Approval-gated tools emit only the post-resume → response interval so the
      // pause chip owns the wait and tool execution still fills active time.
      for (const toolCall of toolCallsOf(event)) {
        const toolCallId = typeof toolCall.id === 'string' ? toolCall.id : undefined;
        if (toolCallId == null || subAgentToolCallIds.has(toolCallId)) continue;
        const response = responses?.get(toolCallId);
        const responseMs = response == null ? null : parseTimestamp(eventCreatedAt(response));
        const required = pendingRequired?.get(toolCallId);
        const requiredMs = required == null ? null : parseTimestamp(eventCreatedAt(required));
        if (approvalIds?.has(toolCallId)) {
          const resumeMs = approvalToolResumeMs.get(toolCallId);
          if (resumeMs == null) continue;
          const endMs = responseMs ?? requiredMs ?? turnDoneMs;
          if (endMs == null || endMs < resumeMs) continue;
          segments.push({
            id: `${eventId(event)}-${toolCallId}`,
            type: 'tool_call',
            title: 'tool.call',
            description: toolCallDescription(toolCall),
            startMs: resumeMs - originMs,
            endMs: endMs - originMs,
            turnIndex,
            threadId,
            ...(responseMs == null && endMs <= resumeMs ? { isMarker: true } : {}),
          });
          continue;
        }
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
    case 'user.tool_approval': {
      const toolCallId = readString(event, 'toolCallId', 'tool_call_id');
      const request = toolCallId == null ? undefined : toolCallRequestsByTurnId.get(turn.turnId)?.get(toolCallId);
      const toolLabel =
        mcpToolSlashLabel(request?.toolCall) ||
        (toolCallId != null && toolCallId.length > 0 ? toolCallId.slice(0, 12) : undefined);
      segments.push({
        id: eventId(event),
        type: 'approval',
        title: event.type,
        description: summarizeToolApproval(event.approval, { toolLabel }),
        turnIndex,
        threadId,
        isMarker: true,
        ...pauseAnchorFields({ windows: pauseWindows, eventMs, originMs }),
      });
      return;
    }
    case 'user.tool_approval_policy':
      segments.push({
        id: eventId(event),
        type: 'approval',
        title: event.type,
        description: summarizeToolApprovalPolicy(event),
        turnIndex,
        threadId: MAIN_THREAD_ID,
        isMarker: true,
        ...pauseAnchorFields({ windows: pauseWindows, eventMs, originMs }),
      });
      return;
    case 'user.tool_response':
      segments.push({
        id: eventId(event),
        type: 'user',
        title: event.type,
        description: extractText(event.content) || 'Tool response',
        turnIndex,
        threadId,
        isMarker: true,
        ...pauseAnchorFields({ windows: pauseWindows, eventMs, originMs }),
      });
      return;
    case 'user.mcp_auth_continue':
      segments.push({
        id: eventId(event),
        type: 'user',
        title: event.type,
        description: 'MCP authorization completed',
        turnIndex,
        threadId,
        isMarker: true,
        ...pauseAnchorFields({ windows: pauseWindows, eventMs, originMs }),
      });
      return;
    case 'tool.approval_required':
    case 'tool.response_required':
    case 'mcp.auth_required':
    case 'mcp.initialize':
    case 'sandbox.created': {
      // These are point-in-time state transitions, so start and end are equal
      // and Chart.js renders them with the configured minimum marker width.
      const approvalToolLabels =
        event.type === 'tool.approval_required'
          ? toolCallsOf(event).flatMap(toolCall => {
              const id = typeof toolCall.id === 'string' ? toolCall.id : undefined;
              const request = id == null ? undefined : toolCallRequestsByTurnId.get(turn.turnId)?.get(id);
              const label = mcpToolSlashLabel(request?.toolCall);
              return label.length > 0 ? [label] : [];
            })
          : [];
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
            ? summarizeApprovalRequiredTools(approvalToolLabels)
            : event.type === 'tool.response_required'
              ? 'Waiting for user response'
              : event.type === 'mcp.auth_required'
                ? 'MCP authentication required'
                : event.type === 'mcp.initialize'
                  ? 'MCP initialized'
                  : 'Sandbox created',
        turnIndex,
        threadId,
        isMarker: true,
        ...pauseAnchorFields({ windows: pauseWindows, eventMs, originMs }),
      });
      return;
    }
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
