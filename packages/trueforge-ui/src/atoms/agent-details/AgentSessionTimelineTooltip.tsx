'use client';

import { useThemeMode } from '../../theme/SlotsProvider.js';
import { formatCostUsd, formatReadableDurationMs, formatTokenCount } from '../../utils/sessionDisplayFormat.js';
import {
  formatTimelineDuration,
  getSessionEventColor,
  getSessionEventTooltipHeading,
  SESSION_EVENT_TOOLTIP_HIDE_DURATION,
  type SessionEventTimelineSegment,
} from '../../utils/sessionEventTimeline.js';
import type {
  TimelineMarkerGroup,
  TimelineSubAgentGroup,
  TimelineToolCallGroup,
} from '../../utils/sessionEventTimelineChart.js';
import type { SessionTurnView } from '../../utils/sessionTurnViews.js';

export function hasSessionEventTooltip(segment: SessionEventTimelineSegment): boolean {
  return segment.type !== 'system' || segment.description.trim().length > 0;
}

/**
 * Parse approval description lines into name + optional count.
 * Input line `linear/save_comment (3)` → { name, count: "3" }.
 */
function approvalTooltipRows(description: string): Array<{ name: string; count?: string }> {
  return description
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const counted = /^(.*) \((\d+)\)$/.exec(line);
      if (counted?.[1] != null && counted[2] != null) {
        return { name: counted[1], count: counted[2] };
      }
      return { name: line };
    });
}

/** Single bar/chip/diamond: heading, optional duration, description. */
export function SessionEventTooltip({
  segment,
  subAgentLabel,
}: {
  segment: SessionEventTimelineSegment;
  subAgentLabel?: string;
}) {
  // Pause chips show real wall wait, not the compressed/expanded chart width.
  const pauseWallMs = segment.isPauseChip ? (segment.wallDurationMs ?? 0) : undefined;
  const showDuration =
    pauseWallMs != null
      ? pauseWallMs > 0
      : !segment.isMarker && !SESSION_EVENT_TOOLTIP_HIDE_DURATION.has(segment.type);
  const durationMs = pauseWallMs ?? segment.endMs - segment.startMs;
  const content = segment.description.trim();
  if (segment.type === 'system') {
    if (content.length === 0) return null;
    return (
      <p className="max-w-[25rem] whitespace-normal break-words text-xs font-medium text-text-primary">{content}</p>
    );
  }

  const heading = segment.isPauseChip ? 'Paused' : getSessionEventTooltipHeading(segment.type);

  // Wider list layout (like tool-call groups) when many MCP tools need approval.
  if (segment.type === 'approval' && !segment.isPauseChip) {
    const rows = approvalTooltipRows(content);
    return (
      <div className="max-h-72 w-80 max-w-full overflow-auto text-xs">
        {subAgentLabel != null ? (
          <div className="border-b border-border py-1.5 text-text-secondary">{`Sub-Agent: ${subAgentLabel}`}</div>
        ) : null}
        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="font-medium text-text-secondary">{heading}</span>
        </div>
        {rows.length > 0 ? (
          <div className="mt-1.5 border-t border-border pt-1.5">
            {rows.map(row => (
              <div key={`${row.name}-${row.count ?? ''}`} className="flex items-center justify-between gap-2 py-0.5">
                <span className="min-w-0 truncate font-medium text-text-primary">{row.name}</span>
                {row.count != null ? (
                  <span className="shrink-0 tabular-nums text-text-secondary">{row.count}</span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="max-h-72 max-w-[25rem] overflow-auto whitespace-normal break-words text-xs">
      {subAgentLabel != null ? (
        <div className="border-b border-border py-1.5 text-text-secondary">{`Sub-Agent: ${subAgentLabel}`}</div>
      ) : null}
      <div className="flex items-center justify-between gap-3 pt-1">
        <span className={segment.type === 'error' ? 'font-medium text-failure-bg' : 'font-medium text-text-secondary'}>
          {heading}
        </span>
        {showDuration ? (
          <span className="tabular-nums text-text-secondary">{formatTimelineDuration(durationMs)}</span>
        ) : null}
      </div>
      {content.length > 0 && !segment.isPauseChip ? (
        <p className="mt-1.5 line-clamp-6 whitespace-pre-line font-medium text-text-primary">{content}</p>
      ) : null}
    </div>
  );
}

/** Turn background band: cost/tokens plus a short list of that turn’s segments. */
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
  const isDark = useThemeMode() === 'dark';
  return (
    <div className="max-h-72 w-72 max-w-full overflow-auto text-xs text-text-primary">
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold">{`Turn ${turnNumber}`}</span>
        <span className="tabular-nums text-text-secondary">{formatReadableDurationMs(durationMs)}</span>
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
                style={{ backgroundColor: getSessionEventColor(segment.type, isDark) }}
              />
              <span className="min-w-0 flex-1 truncate">{label}</span>
              {segment.isMarker && !segment.isPauseChip ? null : (
                <span className="ml-auto shrink-0 tabular-nums text-text-secondary">
                  {formatTimelineDuration(segment.wallDurationMs ?? segment.endMs - segment.startMs)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Overlapping parallel tool calls merged into one bar — list each tool + duration. */
export function SessionToolCallGroupTooltip({
  group,
  subAgentLabel,
}: {
  group: TimelineToolCallGroup;
  subAgentLabel?: string;
}) {
  return (
    <div className="max-h-72 w-80 max-w-full overflow-auto text-xs">
      {subAgentLabel != null ? (
        <div className="border-b border-border py-1.5 text-text-secondary">{`Sub-Agent: ${subAgentLabel}`}</div>
      ) : null}
      <div className="flex items-center justify-between gap-3 pt-1">
        <span className="font-medium text-text-secondary">Tool calls</span>
        <span className="tabular-nums text-text-secondary">{formatTimelineDuration(group.endMs - group.startMs)}</span>
      </div>
      <div className={subAgentLabel == null ? 'mt-1.5 border-t border-border pt-1.5' : 'mt-1.5'}>
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

/** Several diamonds at the same x — one tooltip lists them all. */
export function SessionMarkerGroupTooltip({ group }: { group: TimelineMarkerGroup }) {
  const isDark = useThemeMode() === 'dark';
  const singleSegment = group.segments.length === 1 ? group.segments[0] : undefined;
  if (singleSegment != null) return <SessionEventTooltip segment={singleSegment} />;

  return (
    <div className="max-h-72 w-80 max-w-full overflow-auto text-xs">
      <span className="font-medium text-text-secondary">Events</span>
      <div className="mt-1.5 border-t border-border pt-1.5">
        {group.segments.map(segment => (
          <div key={segment.id} className="flex min-w-0 items-start gap-1.5 py-0.5">
            <span
              className="mt-1 size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: getSessionEventColor(segment.type, isDark) }}
            />
            <div className="min-w-0">
              <div className="font-medium text-text-secondary">{getSessionEventTooltipHeading(segment.type)}</div>
              <div className="wrap-break-word whitespace-pre-line font-medium text-text-primary">
                {segment.description.trim() || segment.title}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Merged overlapping sub-agent tracks on the main row. */
export function SessionSubAgentGroupTooltip({ group }: { group: TimelineSubAgentGroup }) {
  return (
    <div className="max-h-72 w-80 max-w-full overflow-auto text-xs">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-text-secondary">Sub-agents</span>
        <span className="tabular-nums text-text-secondary">{formatTimelineDuration(group.endMs - group.startMs)}</span>
      </div>
      <div className="mt-1.5 border-t border-border pt-1.5">
        {group.segments.map((segment, index) => (
          <div key={segment.id} className="flex items-center justify-between gap-2 py-0.5">
            <span className="min-w-0 truncate font-medium text-text-primary">
              {group.segments.length === 1
                ? segment.description || segment.title
                : `Sub-agent ${index + 1}: ${segment.description || segment.title}`}
            </span>
            {group.segments.length === 1 ? null : (
              <span className="shrink-0 tabular-nums text-text-secondary">
                {formatTimelineDuration(segment.endMs - segment.startMs)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
