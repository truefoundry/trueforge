'use client';

import { formatCostUsd, formatDurationMs, formatTokenCount } from '../../utils/sessionDisplayFormat.js';
import {
  formatTimelineDuration,
  getSessionEventColor,
  getSessionEventTooltipHeading,
  SESSION_EVENT_TOOLTIP_HIDE_DURATION,
  type SessionEventTimelineSegment,
} from '../../utils/sessionEventTimeline.js';
import type { TimelineToolCallGroup } from '../../utils/sessionEventTimelineChart.js';
import type { SessionTurnView } from '../../utils/sessionTurnViews.js';

export function hasSessionEventTooltip(segment: SessionEventTimelineSegment): boolean {
  return segment.type !== 'system' || segment.description.trim().length > 0;
}

export function SessionEventTooltip({
  segment,
  subAgentLabel,
}: {
  segment: SessionEventTimelineSegment;
  subAgentLabel?: string;
}) {
  const showDuration = !segment.isMarker && !SESSION_EVENT_TOOLTIP_HIDE_DURATION.has(segment.type);
  const content = segment.description.trim();
  if (segment.type === 'system') {
    if (content.length === 0) return null;
    return (
      <p className="max-w-[25rem] whitespace-normal break-words text-xs font-medium text-text-primary">{content}</p>
    );
  }

  return (
    <div className="max-h-72 max-w-[25rem] overflow-auto whitespace-normal break-words text-xs">
      {subAgentLabel != null ? (
        <div className="border-b border-border py-1.5 text-text-secondary">{`Sub-Agent: ${subAgentLabel}`}</div>
      ) : null}
      <div className="flex items-center justify-between gap-3 pt-1">
        <span className={segment.type === 'error' ? 'font-medium text-failure-bg' : 'font-medium text-text-secondary'}>
          {getSessionEventTooltipHeading(segment.type)}
        </span>
        {showDuration ? (
          <span className="tabular-nums text-text-secondary">
            {formatTimelineDuration(segment.endMs - segment.startMs)}
          </span>
        ) : null}
      </div>
      {content.length > 0 ? <p className="mt-1.5 line-clamp-6 font-medium text-text-primary">{content}</p> : null}
    </div>
  );
}

export function SessionTurnTooltip({
  turn,
  turnNumber,
  durationMs,
  segments,
}: {
  turn: SessionTurnView;
  turnNumber: number;
  durationMs: number;
  segments: SessionEventTimelineSegment[];
}) {
  return (
    <div className="max-h-72 w-72 max-w-full overflow-auto text-xs text-text-primary">
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold">{`Turn ${turnNumber}`}</span>
        <span className="tabular-nums text-text-secondary">{formatDurationMs(durationMs)}</span>
      </div>
      <div className="mt-1 flex flex-col text-text-secondary">
        {turn.totalCostInUsd != null ? <span>{`Cost: ${formatCostUsd(turn.totalCostInUsd)}`}</span> : null}
        {turn.totalTokens != null ? <span>{`Tokens: ${formatTokenCount(turn.totalTokens)}`}</span> : null}
      </div>
      <div className="mt-2 border-t border-border pt-2">
        {segments.map(segment => {
          const label =
            segment.type === 'tool_call' || segment.type === 'sub_agent' ? segment.description : segment.title;
          return (
            <div key={segment.id} className="flex min-w-0 items-center gap-1.5">
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: getSessionEventColor(segment.type) }}
              />
              <span className="min-w-0 flex-1 truncate">{label}</span>
              {segment.isMarker ? null : (
                <span className="ml-auto shrink-0 tabular-nums text-text-secondary">
                  {formatTimelineDuration(segment.endMs - segment.startMs)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SessionToolCallGroupTooltip({ group }: { group: TimelineToolCallGroup }) {
  return (
    <div className="max-h-72 w-80 max-w-full overflow-auto text-xs">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-text-secondary">Tool calls</span>
        <span className="tabular-nums text-text-secondary">{formatTimelineDuration(group.endMs - group.startMs)}</span>
      </div>
      <div className="mt-1.5 border-t border-border pt-1.5">
        {group.segments.map(segment => (
          <div key={segment.id} className="flex items-center justify-between gap-2 py-0.5">
            <span className="min-w-0 truncate font-medium text-text-primary">
              {segment.description || segment.title}
            </span>
            <span className="shrink-0 tabular-nums text-text-secondary">
              {formatTimelineDuration(segment.endMs - segment.startMs)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
