'use client';

import {
  BarController,
  BarElement,
  Chart as ChartJS,
  LinearScale,
  PointElement,
  ScatterController,
  Tooltip,
  type ChartData,
  type ChartDataset,
  type ChartOptions,
  type Plugin,
} from 'chart.js';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties } from 'react';
import { Chart } from 'react-chartjs-2';

import { useThemeMode } from '../../theme/SlotsProvider.js';
import { roundDurationMsToSecond } from '../../utils/sessionDisplayFormat.js';
import {
  getSessionEventColor,
  getSessionEventHoverColor,
  getSessionEventLabel,
  MAIN_THREAD_ID,
  type SessionEventTimelineSegment,
} from '../../utils/sessionEventTimeline.js';
import {
  buildTimelineAxisTicks,
  formatTimelineAxisDuration,
  getActiveTimelineMs,
  getSubAgentHoverGroups,
  getSubAgentLanes,
  getTimelineHoverTargetId,
  getTimelineLayout,
  getTimelineRange,
  groupCoincidentTimelineMarkers,
  groupOverlappingToolCalls,
  mergeOverlappingSubAgentSegments,
  TIMELINE_TYPE,
  type TimelineGap,
  type TimelineHoverTarget,
  type TimelineTurnBar,
} from '../../utils/sessionEventTimelineChart.js';
import { LightTooltip } from '../primitives/Tooltip.js';
import {
  hasSessionEventTooltip,
  SessionEventTooltip,
  SessionMarkerGroupTooltip,
  SessionSubAgentGroupTooltip,
  SessionToolCallGroupTooltip,
  SessionTurnTooltip,
} from './AgentSessionTimelineTooltip.js';
import type { AgentSessionEventTimelineChartProps } from './types.js';

ChartJS.register(BarController, BarElement, LinearScale, PointElement, ScatterController, Tooltip);

const MARKER_PX = 4;
const TURN_GAP_PX = 12;
const END_PAD_PX = 12;
const BAR_RADIUS_PX = 2;
const ROW_GAP_PX = 8;
const MARKER_EVENT_GAP_PX = 2;
const OVERHEAD_PX = 30;

type BarPoint = { x: [number, number]; y: number };
type MarkerPoint = { x: number; y: number };
type TimelineChartType = 'bar' | 'scatter';

function rowCenters({ heights, gaps }: { heights: number[]; gaps: number[] }): { centers: number[]; band: number } {
  const centers: number[] = [];
  let offset = 0;
  heights.forEach((height, index) => {
    centers.push(offset + height / 2);
    offset += height + (gaps[index] ?? 0);
  });
  return { centers, band: offset };
}

function eventOrder(type: SessionEventTimelineSegment['type']): number {
  if (type === 'sub_agent') return 0;
  if (type === 'model') return 2;
  return 1;
}

function turnBarLabelPoint(element: object): { x: number; y: number } | null {
  if (!('x' in element) || !('y' in element) || !('base' in element)) return null;
  const { x, y, base } = element;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof base !== 'number') return null;
  return { x: (x + base) / 2, y };
}

export function AgentSessionEventTimelineChart({
  turns,
  segments,
  hiddenTypes,
  onSelectTurn,
}: AgentSessionEventTimelineChartProps) {
  const mode = useThemeMode();
  const isDark = mode === 'dark';
  const axis = isDark ? '#8c8c92' : '#71717a';
  const grid = isDark ? '#27272a' : '#e4e4e7';
  const turnFill = isDark ? '#3f3f46' : '#E0ECFD';
  const turnHover = isDark ? '#52525b' : '#E0ECFD';
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [widthPx, setWidthPx] = useState(0);
  const [overheadPx, setOverheadPx] = useState(OVERHEAD_PX);
  const [tooltipTarget, setTooltipTarget] = useState<TimelineHoverTarget | null>(null);
  const [tooltipAnchor, setTooltipAnchor] = useState<{ left: number; top: number } | null>(null);
  const tooltipIdRef = useRef('');
  const tooltipCursorXRef = useRef<number | null>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (wrapper == null) return undefined;
    const update = () => setWidthPx(wrapper.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  const refreshTooltipAnchor = useCallback(() => {
    const wrapper = wrapperRef.current;
    const left = tooltipCursorXRef.current;
    if (wrapper == null || left == null) return;
    setTooltipAnchor({ left, top: wrapper.getBoundingClientRect().bottom });
  }, []);

  const clearTooltip = useCallback(() => {
    tooltipIdRef.current = '';
    tooltipCursorXRef.current = null;
    setTooltipTarget(null);
    setTooltipAnchor(null);
  }, []);

  useEffect(() => {
    if (tooltipTarget == null) return undefined;
    // Anchors use viewport coordinates, so remeasure the chart whenever any
    // scroll ancestor or the viewport moves it.
    refreshTooltipAnchor();
    window.addEventListener('scroll', refreshTooltipAnchor, true);
    window.addEventListener('resize', refreshTooltipAnchor);
    return () => {
      window.removeEventListener('scroll', refreshTooltipAnchor, true);
      window.removeEventListener('resize', refreshTooltipAnchor);
    };
  }, [refreshTooltipAnchor, tooltipTarget]);

  const segmentTotalMs = Math.max(0, ...segments.map(segment => segment.endMs));
  const activeTotalMs = Math.max(1, roundDurationMsToSecond(segmentTotalMs));
  const { turnStartsMs, turnOrdinals, turnRanges } = useMemo(() => getTimelineLayout(segments), [segments]);
  const activeTurnStartsMs = useMemo(
    () => turnStartsMs.filter((startMs, index) => index === 0 || startMs <= activeTotalMs),
    [activeTotalMs, turnStartsMs],
  );
  const gapCount = Math.max(0, activeTurnStartsMs.length - 1);
  const scaleWidthPx = Math.max(widthPx / 2, widthPx - TURN_GAP_PX * gapCount - END_PAD_PX);
  const msPerPx = activeTotalMs / Math.max(1, scaleWidthPx);
  const turnGapMs = TURN_GAP_PX * msPerPx;
  const totalMs = activeTotalMs + gapCount * turnGapMs;
  const timelineMaxMs = totalMs + END_PAD_PX * msPerPx;
  const timelineGaps = useMemo<TimelineGap[]>(
    () =>
      activeTurnStartsMs
        .slice(1)
        .map((startMs, index) => ({ startMs: startMs + index * turnGapMs, endMs: startMs + (index + 1) * turnGapMs })),
    [activeTurnStartsMs, turnGapMs],
  );

  const visibleSegments = useMemo(
    () =>
      segments.flatMap(segment => {
        if (hiddenTypes.has(segment.type)) return [];
        const shiftMs = (turnOrdinals.get(segment.turnIndex) ?? 0) * turnGapMs;
        return [{ ...segment, startMs: segment.startMs + shiftMs, endMs: segment.endMs + shiftMs }];
      }),
    [hiddenTypes, segments, turnGapMs, turnOrdinals],
  );
  const markerGroups = useMemo(() => groupCoincidentTimelineMarkers(visibleSegments), [visibleSegments]);
  const durationSegments = useMemo(() => visibleSegments.filter(segment => !segment.isMarker), [visibleSegments]);
  const turnBars = useMemo<TimelineTurnBar[]>(
    () =>
      turnRanges.length < 2
        ? []
        : turnRanges.map(range => ({
            ...range,
            id: `turn-${range.turnIndex}`,
            durationMs: range.endMs - range.startMs,
            startMs: range.startMs + range.ordinal * turnGapMs,
            endMs: range.endMs + range.ordinal * turnGapMs + MARKER_PX * msPerPx,
          })),
    [msPerPx, turnGapMs, turnRanges],
  );
  const subAgentSegments = useMemo(
    () => durationSegments.filter(segment => segment.type === 'sub_agent'),
    [durationSegments],
  );
  const mainSubAgents = useMemo(() => mergeOverlappingSubAgentSegments(subAgentSegments), [subAgentSegments]);
  const subAgentGroups = useMemo(
    () => getSubAgentHoverGroups({ bars: mainSubAgents, subAgentSegments }),
    [mainSubAgents, subAgentSegments],
  );
  const subAgentLanes = useMemo(
    () => getSubAgentLanes({ subAgentSegments, threadSegments: durationSegments, minWidthMs: MARKER_PX * msPerPx }),
    [durationSegments, msPerPx, subAgentSegments],
  );
  const mainCandidates = useMemo(() => {
    return [...durationSegments.filter(segment => segment.threadId === MAIN_THREAD_ID), ...mainSubAgents].sort(
      (left, right) => left.startMs - right.startMs || left.endMs - right.endMs,
    );
  }, [durationSegments, mainSubAgents]);
  const toolCallGroups = useMemo(
    () =>
      groupOverlappingToolCalls(mainCandidates.filter(segment => segment.type === 'tool_call')).filter(
        group => group.segments.length > 1,
      ),
    [mainCandidates],
  );
  const groupedIds = useMemo(
    () => new Set(toolCallGroups.flatMap(group => group.segments.map(segment => segment.id))),
    [toolCallGroups],
  );
  const mainEventSegments = useMemo(
    () => mainCandidates.filter(segment => !groupedIds.has(segment.id)),
    [groupedIds, mainCandidates],
  );
  const laneCount = subAgentLanes.reduce((count, lane) => Math.max(count, lane.lane + 1), 0);
  const hasTurnRow = turnBars.length > 0;
  const markerRow = hasTurnRow ? 1 : 0;
  const eventRow = markerRow + 1;
  const { centers, band } = useMemo(() => {
    const heights = [...(hasTurnRow ? [16] : []), 10, 28, ...Array.from({ length: laneCount }, () => 12)];
    const gaps = heights.map((_, index) => {
      if (index === heights.length - 1) return 0;
      return index === markerRow ? MARKER_EVENT_GAP_PX : ROW_GAP_PX;
    });
    return rowCenters({ heights, gaps });
  }, [hasTurnRow, laneCount, markerRow]);

  const chartTargets = useMemo<Array<TimelineHoverTarget | null>>(
    () => [
      ...turnBars.map((bar): TimelineHoverTarget => ({ type: TIMELINE_TYPE.turn, bar })),
      ...markerGroups.map((group): TimelineHoverTarget => ({ type: TIMELINE_TYPE.markerGroup, group })),
      ...subAgentLanes.flatMap(lane =>
        lane.segments.map((segment): TimelineHoverTarget => ({ type: TIMELINE_TYPE.event, segment })),
      ),
      ...mainEventSegments.map((segment): TimelineHoverTarget | null => {
        if (segment.type !== 'sub_agent') return { type: TIMELINE_TYPE.event, segment };
        const group = subAgentGroups.find(candidate => candidate.barId === segment.id);
        return group == null ? { type: TIMELINE_TYPE.event, segment } : { type: TIMELINE_TYPE.subAgentGroup, group };
      }),
      ...toolCallGroups.map((group): TimelineHoverTarget => ({ type: TIMELINE_TYPE.toolCallGroup, group })),
    ],
    [mainEventSegments, markerGroups, subAgentGroups, subAgentLanes, toolCallGroups, turnBars],
  );

  const barDataset = ({
    label,
    range,
    y,
    color,
    hover,
    thickness,
    order = 1,
    inflateAmount,
  }: {
    label: string;
    range: TimelineGap;
    y: number;
    color: string;
    hover: string;
    thickness: number;
    order?: number;
    inflateAmount?: number;
  }) => ({
    label,
    data: [{ x: getTimelineRange(range), y }] satisfies BarPoint[],
    backgroundColor: color,
    hoverBackgroundColor: hover,
    hoverBorderColor: hover,
    borderWidth: 0,
    borderSkipped: false,
    borderRadius: BAR_RADIUS_PX,
    minBarLength: MARKER_PX,
    barThickness: thickness,
    grouped: false,
    order,
    ...(inflateAmount == null ? {} : { inflateAmount }),
  });

  const chartData = useMemo<ChartData<TimelineChartType, Array<BarPoint | MarkerPoint>, string>>(
    () => ({
      datasets: [
        ...turnBars.map(bar =>
          barDataset({
            label: `Turn ${bar.ordinal + 1}`,
            range: bar,
            y: centers[0] ?? 0,
            color: turnFill,
            hover: turnHover,
            thickness: 16,
          }),
        ),
        ...markerGroups.map(group => {
          const type = group.segments.length === 1 ? group.segments[0]?.type : 'system';
          const color = getSessionEventColor(type ?? 'system', isDark);
          return {
            type: 'scatter' as const,
            label: group.segments.map(segment => getSessionEventLabel(segment.type)).join(', '),
            data: [{ x: group.startMs, y: centers[markerRow] ?? 0 }] satisfies MarkerPoint[],
            pointStyle: 'rectRot' as const,
            pointRadius: 5,
            pointHoverRadius: 6,
            clip: false,
            backgroundColor: color,
            hoverBackgroundColor: getSessionEventHoverColor(type ?? 'system', isDark),
            borderWidth: 0,
            order: 0,
          } satisfies ChartDataset<'scatter', MarkerPoint[]>;
        }),
        ...subAgentLanes.flatMap(lane =>
          lane.segments.map(segment =>
            barDataset({
              label: `${getSessionEventLabel(segment.type)}: ${segment.title}`,
              range: segment,
              y: centers[eventRow + 1 + lane.lane] ?? 0,
              color: getSessionEventColor(segment.type, isDark),
              hover: getSessionEventHoverColor(segment.type, isDark),
              thickness: 12,
              order: eventOrder(segment.type),
              inflateAmount: 0.5,
            }),
          ),
        ),
        ...mainEventSegments.map(segment =>
          barDataset({
            label: `${getSessionEventLabel(segment.type)}: ${segment.title}`,
            range: segment,
            y: centers[eventRow] ?? 0,
            color: getSessionEventColor(segment.type, isDark),
            hover: getSessionEventHoverColor(segment.type, isDark),
            thickness: 28,
            order: eventOrder(segment.type),
            inflateAmount: 0.5,
          }),
        ),
        ...toolCallGroups.map(group =>
          barDataset({
            label: 'Parallel tool calls',
            range: group,
            y: centers[eventRow] ?? 0,
            color: getSessionEventColor('tool_call', isDark),
            hover: getSessionEventHoverColor('tool_call', isDark),
            thickness: 28,
            order: eventOrder('tool_call'),
            inflateAmount: 0.5,
          }),
        ),
      ],
    }),
    [
      centers,
      eventRow,
      isDark,
      mainEventSegments,
      markerGroups,
      markerRow,
      subAgentLanes,
      toolCallGroups,
      turnBars,
      turnFill,
      turnHover,
    ],
  );

  const turnLabelPlugin = useMemo<Plugin<TimelineChartType>>(
    () => ({
      id: 'turnLabels',
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        ctx.save();
        ctx.fillStyle = axis;
        ctx.font = '500 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        turnBars.forEach((bar, index) => {
          const element = chart.getDatasetMeta(index).data[0];
          if (element == null) return;
          const point = turnBarLabelPoint(element);
          if (point) ctx.fillText(`T${bar.ordinal + 1}`, point.x, point.y);
        });
        ctx.restore();
      },
    }),
    [axis, turnBars],
  );
  const overheadPlugin = useMemo<Plugin<TimelineChartType>>(
    () => ({
      id: 'timelineOverhead',
      afterLayout(chart) {
        const next = Math.round(chart.height - chart.chartArea.height);
        setOverheadPx(previous => (previous === next ? previous : next));
      },
    }),
    [],
  );

  const chartOptions = useMemo<ChartOptions<TimelineChartType>>(
    () => ({
      indexAxis: 'y',
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      onClick: (_event, elements) => {
        const target = chartTargets[elements[0]?.datasetIndex ?? -1];
        if (target?.type === TIMELINE_TYPE.turn) onSelectTurn?.(target.bar.turnIndex);
      },
      onHover: (event, elements) => {
        const hoveredDatasetIndex = elements[0]?.datasetIndex;
        const next = hoveredDatasetIndex == null ? null : (chartTargets[hoveredDatasetIndex] ?? null);
        const native = event.native;
        if (native?.target instanceof HTMLElement) {
          native.target.style.cursor = next?.type === TIMELINE_TYPE.turn ? 'pointer' : 'default';
        }
        if (native instanceof MouseEvent) {
          tooltipCursorXRef.current = native.clientX;
          refreshTooltipAnchor();
        }
        // Pointer between bars keeps the current tooltip; a bar without a tooltip dismisses it.
        if (hoveredDatasetIndex == null) return;
        const nextId = getTimelineHoverTargetId(next);
        if (tooltipIdRef.current === nextId) return;
        tooltipIdRef.current = nextId;
        setTooltipTarget(next);
        if (next == null) {
          setTooltipAnchor(null);
          return;
        }
        refreshTooltipAnchor();
      },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: {
          type: 'linear',
          position: 'top',
          min: 0,
          max: timelineMaxMs,
          grid: { color: grid },
          border: { color: grid },
          afterBuildTicks: scale => {
            scale.ticks = buildTimelineAxisTicks({ activeTotalMs, turnStartsMs: activeTurnStartsMs, turnGapMs });
          },
          ticks: {
            color: axis,
            align: 'inner',
            autoSkip: false,
            includeBounds: false,
            maxTicksLimit: 9,
            callback: value => {
              const timelineMs = Number(value);
              return timelineMs <= totalMs
                ? formatTimelineAxisDuration(getActiveTimelineMs(timelineMs, timelineGaps))
                : '';
            },
          },
        },
        y: {
          type: 'linear',
          display: false,
          reverse: true,
          offset: false,
          min: 0,
          max: band,
          grid: { display: false },
        },
      },
    }),
    [
      activeTotalMs,
      activeTurnStartsMs,
      axis,
      band,
      chartTargets,
      grid,
      onSelectTurn,
      refreshTooltipAnchor,
      timelineGaps,
      timelineMaxMs,
      totalMs,
      turnGapMs,
    ],
  );

  const tooltipTurn = tooltipTarget?.type === TIMELINE_TYPE.turn ? turns[tooltipTarget.bar.turnIndex] : undefined;
  const containerStyle = useMemo<CSSProperties>(() => ({ height: band + overheadPx }), [band, overheadPx]);
  const tooltipContent =
    tooltipTarget?.type === TIMELINE_TYPE.turn && tooltipTurn != null ? (
      <SessionTurnTooltip
        turn={tooltipTurn}
        turnNumber={tooltipTarget.bar.ordinal + 1}
        durationMs={tooltipTarget.bar.durationMs}
        segments={segments.filter(segment => segment.turnIndex === tooltipTarget.bar.turnIndex)}
      />
    ) : tooltipTarget?.type === TIMELINE_TYPE.event && hasSessionEventTooltip(tooltipTarget.segment) ? (
      <SessionEventTooltip
        segment={tooltipTarget.segment}
        subAgentLabel={
          tooltipTarget.segment.type === 'sub_agent'
            ? undefined
            : subAgentLanes.find(lane => lane.threadId === tooltipTarget.segment.threadId)?.track.description
        }
      />
    ) : tooltipTarget?.type === TIMELINE_TYPE.toolCallGroup ? (
      <SessionToolCallGroupTooltip group={tooltipTarget.group} />
    ) : tooltipTarget?.type === TIMELINE_TYPE.markerGroup ? (
      <SessionMarkerGroupTooltip group={tooltipTarget.group} />
    ) : tooltipTarget?.type === TIMELINE_TYPE.subAgentGroup ? (
      <SessionSubAgentGroupTooltip group={tooltipTarget.group} />
    ) : null;

  return (
    <div ref={wrapperRef} className="w-full" data-slot="agent-session-event-timeline-chart">
      <LightTooltip
        title={tooltipContent}
        side="bottom"
        triggerClassName="block w-full"
        followCursor
        open={tooltipTarget != null && tooltipContent != null}
        className="max-w-[min(25rem,calc(100vw-1rem))] whitespace-normal"
        anchor={tooltipAnchor}
      >
        <div className="w-full" style={containerStyle} onMouseLeave={clearTooltip}>
          <Chart<TimelineChartType, Array<BarPoint | MarkerPoint>, string>
            type="bar"
            data={chartData}
            options={chartOptions}
            plugins={[turnLabelPlugin, overheadPlugin]}
          />
        </div>
      </LightTooltip>
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentSessionEventTimelineChart: ComponentType<AgentSessionEventTimelineChartProps>;
  }
}
