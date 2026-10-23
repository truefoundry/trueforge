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
  isAbortShapedThreadError,
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
/** Events that open a human wait — may arrive seconds before turn.update paused. */
const PAUSE_CAUSE_EVENT_TYPES = new Set(['tool.approval_required', 'tool.response_required', 'mcp.auth_required']);

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
 * A sub-agent approval_required with no later per-call approval or matching
 * allow-session policy. The turn can already be `running` (a sibling resumed)
 * while this lane is still waiting, so the live clock must keep ticking.
 */
function turnHasOpenSubAgentApprovalWait(turn: SessionTurnView): boolean {
  const toolCallRequests = new Map<string, SubAgentToolCallRequest>();
  const open = new Set<string>();
  for (const raw of turn.events) {
    const event = asTimelineEvent(raw);
    if (event == null) continue;
    if (event.type === 'model.message') {
      const startedAtMs = parseTimestamp(eventCreatedAt(event)) ?? 0;
      for (const toolCall of toolCallsOf(event)) {
        if (typeof toolCall.id !== 'string') continue;
        toolCallRequests.set(toolCall.id, {
          startedAtMs,
          threadId: eventThreadId(event),
          modelEventId: eventId(event),
          toolCall,
        });
      }
      continue;
    }
    if (event.type === 'tool.approval_required') {
      if (eventThreadId(event) === MAIN_THREAD_ID) continue;
      for (const toolCall of toolCallsOf(event)) {
        if (typeof toolCall.id === 'string') open.add(toolCall.id);
      }
      continue;
    }
    if (event.type === 'user.tool_approval') {
      const toolCallId = readString(event, 'toolCallId', 'tool_call_id');
      if (toolCallId != null) open.delete(toolCallId);
      continue;
    }
    if (event.type === 'user.tool_approval_policy') {
      for (const toolCallId of policyCoveredToolCallIds({ event, candidates: open, toolCallRequests })) {
        open.delete(toolCallId);
      }
    }
  }
  return open.size > 0;
}

/**
 * True when a turn is still paused, or a sub-agent approval is still open,
 * so the UI can refresh `nowMs`. Completed turns are never open.
 */
export function sessionHasOpenPause(turns: readonly SessionTurnView[]): boolean {
  for (const turn of turns) {
    if (turn.done != null) continue;
    let open = false;
    for (const raw of turn.events) {
      const event = asTimelineEvent(raw);
      if (event == null || event.type !== 'turn.update') continue;
      const status = turnUpdateStatus(event);
      if (status === 'paused') open = true;
      else if (status === 'running') open = false;
    }
    if (open || turnHasOpenSubAgentApprovalWait(turn)) return true;
  }
  return false;
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

/** Tool-call ids the user already answered before `beforeMs`. */
function resolvedToolCallIdsBefore({ events, beforeMs }: { events: TimelineEvent[]; beforeMs: number }): Set<string> {
  const ids = new Set<string>();
  for (const event of events) {
    if (
      event.type !== 'user.tool_approval' &&
      event.type !== 'user.tool_response' &&
      event.type !== 'user.mcp_auth_continue'
    ) {
      continue;
    }
    const eventMs = parseTimestamp(eventCreatedAt(event));
    if (eventMs == null || eventMs >= beforeMs) continue;
    const toolCallId = readString(event, 'toolCallId', 'tool_call_id');
    if (toolCallId != null) ids.add(toolCallId);
  }
  return ids;
}

/**
 * Pull pause start left to the earliest still-pending *main-thread* human cause
 * (ask-user / MCP auth / root approval). Sub-agent `approval_required` stays
 * out of the shared window so later agents keep their model time and per-lane
 * wait spans can start at each thread's own approval.
 */
function expandPauseWindows({ events, windows }: { events: TimelineEvent[]; windows: PauseWindow[] }): PauseWindow[] {
  return windows.map((window, index) => {
    const previousEndMs =
      index > 0 ? (windows[index - 1]?.endMs ?? Number.NEGATIVE_INFINITY) : Number.NEGATIVE_INFINITY;
    const resolvedBeforePause = resolvedToolCallIdsBefore({ events, beforeMs: window.startMs });
    let earliestMs = window.startMs;
    for (const event of events) {
      if (!PAUSE_CAUSE_EVENT_TYPES.has(event.type)) continue;
      if (eventThreadId(event) !== MAIN_THREAD_ID) continue;
      const eventMs = parseTimestamp(eventCreatedAt(event));
      if (eventMs == null || eventMs <= previousEndMs || eventMs > window.endMs) continue;
      const callIds = toolCallsOf(event)
        .map(toolCall => (typeof toolCall.id === 'string' ? toolCall.id : undefined))
        .filter((id): id is string => id != null);
      if (callIds.length > 0 && callIds.every(id => resolvedBeforePause.has(id))) continue;
      earliestMs = Math.min(earliestMs, eventMs);
    }
    return earliestMs < window.startMs ? { ...window, startMs: earliestMs } : window;
  });
}

/** True if something in this pause window needed a human (approval, ask-user, MCP auth). */
function pauseHasHumanAction({ events, window }: { events: TimelineEvent[]; window: PauseWindow }): boolean {
  return events.some(event => {
    if (!PAUSE_CHIP_HUMAN_EVENT_TYPES.has(event.type)) return false;
    const eventMs = parseTimestamp(eventCreatedAt(event));
    return eventMs != null && pauseWindowForMs([window], eventMs) != null;
  });
}

/**
 * Threads that should get a pause chip for this window.
 * `turn.update` is always on the root turn (null thread), so we look at human-action
 * events inside the window. Prefer sub-agent threads when present (one chip per lane);
 * otherwise main (ask-user / root approval / auth).
 * Skip sub-agents that already finished before this pause — completed lanes stay done, not paused.
 */
function pauseChipThreadIds({
  events,
  window,
  threadDoneMsById,
}: {
  events: TimelineEvent[];
  window: PauseWindow;
  threadDoneMsById: Map<string, number>;
}): string[] {
  const threadIds = new Set<string>();
  for (const event of events) {
    if (!PAUSE_CHIP_HUMAN_EVENT_TYPES.has(event.type)) continue;
    const eventMs = parseTimestamp(eventCreatedAt(event));
    if (eventMs == null || pauseWindowForMs([window], eventMs) == null) continue;
    threadIds.add(eventThreadId(event));
  }
  const subAgentThreadIds = [...threadIds].filter(threadId => {
    if (threadId === MAIN_THREAD_ID) return false;
    const doneMs = threadDoneMsById.get(threadId);
    return doneMs == null || doneMs > window.startMs;
  });
  if (subAgentThreadIds.length > 0) return subAgentThreadIds;
  return [MAIN_THREAD_ID];
}

/** Which pause (if any) contains this timestamp, allowing a small lead before paused. */
function pauseWindowForMs(windows: PauseWindow[], eventMs: number): PauseWindow | undefined {
  return windows.find(window => eventMs >= window.startMs - PAUSE_EVENT_LEAD_MS && eventMs <= window.endMs);
}

type SubAgentApprovalWait = {
  threadId: string;
  startMs: number;
  endMs: number;
  eventId: string;
};

/** True when some of the wait sits outside turn-pause windows (survives compression as bar width). */
function waitHasVisibleCompressedDuration({
  wait,
  pauseWindows,
}: {
  wait: SubAgentApprovalWait;
  pauseWindows: PauseWindow[];
}): boolean {
  if (wait.endMs - wait.startMs < MIN_PAUSE_CHIP_WALL_MS) return false;
  if (pauseWindows.length === 0) return true;
  return pauseWindows.some(window => wait.startMs < window.startMs || wait.endMs > window.endMs);
}

/**
 * Pending tool-call ids that a `user.tool_approval_policy` (allow_session /
 * allow for N min) covers. Matches on the `server/tool` label, so one policy
 * resolves every sibling waiting on that same tool.
 */
function policyCoveredToolCallIds({
  event,
  candidates,
  toolCallRequests,
}: {
  event: TimelineEvent;
  candidates: Iterable<string>;
  toolCallRequests: Map<string, SubAgentToolCallRequest> | undefined;
}): string[] {
  const policies = Array.isArray(event.policies) ? event.policies.filter(isRecord) : [];
  const labels = new Set(
    policies
      .map(policy => {
        const server = readString(policy, 'serverName', 'server_name') ?? '';
        const name = typeof policy.name === 'string' ? policy.name : '';
        return [server, name].filter(part => part.length > 0).join('/');
      })
      .filter(label => label.length > 0),
  );
  if (labels.size === 0) return [];
  const covered: string[] = [];
  for (const toolCallId of candidates) {
    const label = mcpToolSlashLabel(toolCallRequests?.get(toolCallId)?.toolCall);
    if (label.length > 0 && labels.has(label)) covered.push(toolCallId);
  }
  return covered;
}

/**
 * Per-sub-agent approval waits (approval_required → user.tool_approval, or a
 * matching user.tool_approval_policy). Independent of turn.update: approving
 * one sibling resumes the turn but other sub-agents stay waiting — those waits
 * must still render as paused.
 */
function collectSubAgentApprovalWaits({
  events,
  turnDoneMs,
  nowMs,
  threadDoneMsById,
  toolCallRequests,
}: {
  events: TimelineEvent[];
  turnDoneMs: number | null;
  nowMs: number;
  threadDoneMsById: Map<string, number>;
  toolCallRequests: Map<string, SubAgentToolCallRequest> | undefined;
}): SubAgentApprovalWait[] {
  const openByToolCallId = new Map<string, { threadId: string; startMs: number; eventId: string }>();
  const waits: SubAgentApprovalWait[] = [];
  const ordered = [...events].sort(
    (left, right) => (parseTimestamp(eventCreatedAt(left)) ?? 0) - (parseTimestamp(eventCreatedAt(right)) ?? 0),
  );

  const clipWait = (wait: SubAgentApprovalWait): SubAgentApprovalWait | undefined => {
    const doneMs = threadDoneMsById.get(wait.threadId);
    if (doneMs != null && doneMs <= wait.startMs) return undefined;
    const endMs = doneMs != null ? Math.min(wait.endMs, doneMs) : wait.endMs;
    if (endMs <= wait.startMs) return undefined;
    return { ...wait, endMs };
  };
  const closeWait = (toolCallId: string, atMs: number): void => {
    const open = openByToolCallId.get(toolCallId);
    if (open == null) return;
    openByToolCallId.delete(toolCallId);
    const clipped = clipWait({
      threadId: open.threadId,
      startMs: open.startMs,
      endMs: Math.max(open.startMs, atMs),
      eventId: open.eventId,
    });
    if (clipped != null) waits.push(clipped);
  };

  for (const event of ordered) {
    const eventMs = parseTimestamp(eventCreatedAt(event));
    if (eventMs == null) continue;
    if (event.type === 'tool.approval_required') {
      const threadId = eventThreadId(event);
      if (threadId === MAIN_THREAD_ID) continue;
      for (const toolCall of toolCallsOf(event)) {
        if (typeof toolCall.id !== 'string') continue;
        if (openByToolCallId.has(toolCall.id)) continue;
        openByToolCallId.set(toolCall.id, { threadId, startMs: eventMs, eventId: eventId(event) });
      }
      continue;
    }
    if (event.type === 'user.tool_approval_policy') {
      for (const toolCallId of policyCoveredToolCallIds({
        event,
        candidates: [...openByToolCallId.keys()],
        toolCallRequests,
      })) {
        closeWait(toolCallId, eventMs);
      }
      continue;
    }
    if (event.type !== 'user.tool_approval') continue;
    const toolCallId = readString(event, 'toolCallId', 'tool_call_id');
    if (toolCallId != null) closeWait(toolCallId, eventMs);
  }

  const openEndMs = turnDoneMs ?? nowMs;
  for (const open of openByToolCallId.values()) {
    const threadDoneMs = threadDoneMsById.get(open.threadId);
    const clipped = clipWait({
      threadId: open.threadId,
      startMs: open.startMs,
      endMs: Math.max(open.startMs, threadDoneMs ?? openEndMs),
      eventId: open.eventId,
    });
    if (clipped != null) waits.push(clipped);
  }
  return waits;
}

/**
 * Pin approval diamonds to the wait span they open or close.
 * Packing then draws approval_required on the left edge and user.tool_approval
 * on the right edge — not mid-span via the turn-pause offset clock.
 * Must run before compression (span end still equals the approval timestamp).
 */
function bindApprovalMarkersToWaitSpans(segments: SessionEventTimelineSegment[]): void {
  const spans = segments.filter(segment => segment.isPauseSpan);
  for (const marker of segments) {
    if (!marker.isMarker || marker.threadId === MAIN_THREAD_ID) continue;
    if (marker.title === 'tool.approval_required') {
      const span = spans.find(candidate => candidate.id === `${marker.id}-wait-span-${marker.threadId}`);
      if (span == null) continue;
      marker.pauseSpanId = span.id;
      marker.pauseSpanEdge = 'start';
      continue;
    }
    if (marker.title !== 'user.tool_approval') continue;
    const span = spans.find(
      candidate =>
        candidate.threadId === marker.threadId &&
        candidate.turnIndex === marker.turnIndex &&
        Math.abs(candidate.endMs - marker.startMs) <= 1,
    );
    if (span == null) continue;
    marker.pauseSpanId = span.id;
    marker.pauseSpanEdge = 'end';
  }
}

/**
 * Split/clip activity so it never occupies a pause interval on the same thread.
 * Pre ends at pause.start; post (if any) starts at pause.end — hatch owns the middle.
 * Compression-only chips are layout anchors only — do not clip lane activity to them.
 */
function splitActivityAroundPauseIntervals(segments: SessionEventTimelineSegment[]): void {
  const pauses = segments.filter(segment => {
    if (segment.isCompressionOnly) return false;
    if (segment.isPauseChip) return true;
    return segment.isPauseSpan === true;
  });
  if (pauses.length === 0) return;

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment == null) continue;
    if (segment.isPauseChip || segment.isPauseSpan || segment.isMarker) continue;
    if (segment.type === 'sub_agent') continue;

    let parts: SessionEventTimelineSegment[] = [segment];
    for (const pause of pauses) {
      if (pause.threadId !== segment.threadId || pause.turnIndex !== segment.turnIndex) continue;
      const pauseEndMs = Math.max(pause.endMs, pause.startMs);
      parts = parts.flatMap(part => {
        if (part.endMs <= pause.startMs || part.startMs >= pauseEndMs) return [part];
        const next: SessionEventTimelineSegment[] = [];
        if (part.startMs < pause.startMs) {
          next.push({ ...part, endMs: pause.startMs, id: `${part.id}@pre:${pause.startMs}` });
        }
        if (part.endMs > pauseEndMs) {
          next.push({
            ...part,
            startMs: pauseEndMs,
            id: `${part.id}@post:${pauseEndMs}`,
          });
        }
        return next;
      });
    }
    const kept = parts.filter(part => part.endMs > part.startMs);
    if (kept.length === 1 && kept[0]?.id === segment.id && kept[0]?.endMs === segment.endMs) continue;
    segments.splice(index, 1, ...kept);
  }
}

/**
 * Close empty gaps between a thread's last activity bar and its pause hatch.
 * Only abut to painted hatch (skip compression-only chips — those can start at
 * the shared earliest approval while this lane's wait span starts later).
 *
 * Do not stretch across an earlier hatch to reach a later one — that recreates
 * model/tool bars through the pause (sibling wait spans after a shared chip).
 */
function abutThreadActivityToPauses(segments: SessionEventTimelineSegment[]): void {
  // Earliest hatch first so a long bar meets the first pause, then later ones.
  const pauses = segments
    .filter(segment => !segment.isCompressionOnly && (segment.isPauseChip || segment.isPauseSpan))
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);

  for (const pause of pauses) {
    let latest: SessionEventTimelineSegment | undefined;
    for (const segment of segments) {
      if (segment.threadId !== pause.threadId || segment.turnIndex !== pause.turnIndex) continue;
      if (segment.isPauseChip || segment.isPauseSpan || segment.isMarker) continue;
      if (segment.type === 'sub_agent') continue;
      if (segment.startMs >= pause.startMs) continue;
      if (latest == null || segment.endMs > latest.endMs) latest = segment;
    }
    if (latest == null || latest.endMs === pause.startMs) continue;
    const activityEndMs = latest.endMs;
    // Another hatch already sits between this bar and the target — leave the gap.
    const blocked = pauses.some(
      other =>
        other !== pause &&
        other.threadId === pause.threadId &&
        other.turnIndex === pause.turnIndex &&
        other.startMs >= activityEndMs &&
        other.startMs < pause.startMs,
    );
    if (blocked) continue;
    latest.endMs = pause.startMs;
  }
}

function threadHasPostPauseActivity({
  segments,
  threadId,
  turnIndex,
  afterMs,
}: {
  segments: SessionEventTimelineSegment[];
  threadId: string;
  turnIndex: number;
  afterMs: number;
}): boolean {
  return segments.some(segment => {
    if (segment.threadId !== threadId || segment.turnIndex !== turnIndex) return false;
    if (segment.isPauseChip || segment.isPauseSpan || segment.isMarker) return false;
    if (segment.type === 'sub_agent') return false;
    return segment.startMs >= afterMs;
  });
}

/**
 * Hide pause hatch on *completed* sub-agent lanes that would end on “Paused”
 * (done, not still waiting). Still-waiting lanes keep hatch. Chips stay as
 * compression-only so shared active-time layout is unchanged.
 */
function hideTerminalPauseChipsOnCompletedSubAgents(segments: SessionEventTimelineSegment[]): void {
  // thread.created→done emits a non-marker sub_agent bar; open threads are markers.
  const completedThreadIds = new Set(
    segments.filter(segment => segment.type === 'sub_agent' && !segment.isMarker).map(segment => segment.threadId),
  );
  for (const pause of segments) {
    if ((!pause.isPauseChip && !pause.isPauseSpan) || pause.threadId === MAIN_THREAD_ID) continue;
    if (!completedThreadIds.has(pause.threadId)) continue;
    if (
      !threadHasPostPauseActivity({
        segments,
        threadId: pause.threadId,
        turnIndex: pause.turnIndex,
        afterMs: pause.endMs,
      })
    ) {
      pause.isCompressionOnly = true;
    }
  }
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
  toolCallRequests,
}: {
  events: TimelineEvent[];
  pauseWindows: PauseWindow[];
  toolCallRequests: Map<string, SubAgentToolCallRequest> | undefined;
}): Map<string, number> {
  const resumeByToolCallId = new Map<string, number>();
  const pendingToolCallIds = new Set<string>();
  for (const event of events) {
    if (event.type !== 'tool.approval_required') continue;
    const eventMs = parseTimestamp(eventCreatedAt(event));
    if (eventMs == null) continue;
    for (const toolCall of toolCallsOf(event)) {
      if (typeof toolCall.id === 'string') pendingToolCallIds.add(toolCall.id);
    }
    const window = pauseWindowForMs(pauseWindows, eventMs);
    if (window == null) continue;
    for (const toolCall of toolCallsOf(event)) {
      if (typeof toolCall.id === 'string') resumeByToolCallId.set(toolCall.id, window.endMs);
    }
  }
  const markResume = (toolCallId: string, eventMs: number): void => {
    const window = pauseWindowForMs(pauseWindows, eventMs);
    // Prefer pause end so the post-approval tool bar starts immediately after the chip.
    const resumeMs = window != null ? Math.max(window.endMs, eventMs) : eventMs;
    const existing = resumeByToolCallId.get(toolCallId);
    resumeByToolCallId.set(toolCallId, existing != null ? Math.max(existing, resumeMs) : resumeMs);
  };
  for (const event of events) {
    const eventMs = parseTimestamp(eventCreatedAt(event));
    if (eventMs == null) continue;
    if (event.type === 'user.tool_approval_policy') {
      for (const toolCallId of policyCoveredToolCallIds({
        event,
        candidates: pendingToolCallIds,
        toolCallRequests,
      })) {
        markResume(toolCallId, eventMs);
      }
      continue;
    }
    if (event.type !== 'user.tool_approval') continue;
    const toolCallId = readString(event, 'toolCallId', 'tool_call_id');
    if (toolCallId != null) markResume(toolCallId, eventMs);
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
    const threadDoneMsById = new Map<string, number>();
    for (const [threadId, doneEvent] of threadDoneEvents) {
      const doneMs = parseTimestamp(eventCreatedAt(doneEvent));
      if (doneMs != null) threadDoneMsById.set(threadId, doneMs);
    }

    // Build pause chips first so later markers can attach via pauseAnchorFields.
    // Expand start to pending approval_required/etc. that arrived before turn.update paused.
    const pauseWindows = expandPauseWindows({
      events,
      windows: collectPauseWindows({ events, turnDoneMs, nowMs }),
    });
    // Per-thread approval waits drive visible hatch (start = that thread's
    // approval_required). Collect before chips so overlapping sub-agent chips
    // can stay compression-only and avoid chip→gap→span holes.
    const subAgentWaits = collectSubAgentApprovalWaits({
      events,
      turnDoneMs,
      nowMs,
      threadDoneMsById,
      toolCallRequests: toolCallRequestsByTurnId.get(turn.turnId),
    });
    // Chip stays compression-only only when the wait span keeps visible width after
    // pause compression (pre-pause and/or post-resume). Pure in-pause waits keep a painted chip.
    const hatchViaWaitSpanThreadIds = new Set(
      subAgentWaits.filter(wait => waitHasVisibleCompressedDuration({ wait, pauseWindows })).map(wait => wait.threadId),
    );

    for (const window of pauseWindows) {
      const wallDurationMs = Math.max(0, window.endMs - window.startMs);
      // Skip tiny auto-pauses unless a human-action event sat inside the window.
      const emitChip = wallDurationMs >= MIN_PAUSE_CHIP_WALL_MS || pauseHasHumanAction({ events, window });
      if (!emitChip) continue;
      for (const threadId of pauseChipThreadIds({ events, window, threadDoneMsById })) {
        // Finished during this pause → keep chip for compression, never paint hatch.
        const doneMs = threadDoneMsById.get(threadId);
        const completedDuringPause = threadId !== MAIN_THREAD_ID && doneMs != null && doneMs <= window.endMs;
        // Wait span paints continuous hatch from this thread's approval_required;
        // chip only reserves the shared compressed gap.
        const hatchViaWaitSpan = threadId !== MAIN_THREAD_ID && hatchViaWaitSpanThreadIds.has(threadId);
        segments.push({
          id: `${window.eventId}-pause-${threadId}`,
          type: 'waiting_on_human',
          title: 'turn.paused',
          description: 'Paused',
          startMs: window.startMs - originMs,
          endMs: window.endMs - originMs,
          turnIndex,
          threadId,
          isPauseChip: true,
          wallDurationMs,
          pauseWallStartMs: window.startMs - originMs,
          pauseWallEndMs: window.endMs - originMs,
          ...(completedDuringPause || hatchViaWaitSpan ? { isCompressionOnly: true } : {}),
        });
      }
    }

    // One continuous hatch per sub-agent: approval_required → approve (or done).
    // Covers turn-paused and turn-running time so sibling lanes don’t get gaps.
    for (const wait of subAgentWaits) {
      const waitWallMs = Math.max(0, wait.endMs - wait.startMs);
      if (waitWallMs < MIN_PAUSE_CHIP_WALL_MS) continue;
      segments.push({
        id: `${wait.eventId}-wait-span-${wait.threadId}`,
        type: 'waiting_on_human',
        title: 'thread.paused',
        description: 'Paused',
        startMs: wait.startMs - originMs,
        endMs: wait.endMs - originMs,
        turnIndex,
        threadId: wait.threadId,
        isPauseSpan: true,
        wallDurationMs: waitWallMs,
        pauseWallStartMs: wait.startMs - originMs,
        pauseWallEndMs: wait.endMs - originMs,
      });
    }

    const approvalToolResumeMs = collectApprovalToolResumeMs({
      events,
      pauseWindows,
      toolCallRequests: toolCallRequestsByTurnId.get(turn.turnId),
    });

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

    // Hide terminal hatch on completed lanes first so split/abut see final flags.
    hideTerminalPauseChipsOnCompletedSubAgents(segments);
    splitActivityAroundPauseIntervals(segments);
    abutThreadActivityToPauses(segments);

    appendTerminalSegment({
      turn,
      turnIndex,
      originMs,
      latestMs,
      segments,
      emitDoneMarker: lastTurnIdByNumber.get(turn.turnNumber) === turn.turnId,
    });
  }

  // Pin diamonds while span end still equals the approval timestamp.
  bindApprovalMarkersToWaitSpans(segments);

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
      const toolCalls = toolCallsOf(event);
      for (const toolCall of toolCalls) {
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

      // Model bar = processing since the previous event on this thread.
      // Sub-agents often emit tool-only messages (no text); still draw that bar so
      // the lane meets the pause chip instead of leaving a gap after the last tool.
      if (modelContent.length > 0 || threadId === MAIN_THREAD_ID || toolCalls.length > 0) {
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
