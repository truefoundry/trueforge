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
  getSubAgentHoverGroups,
  getSubAgentLanes,
  getTimelineAxisTickTarget,
  getTimelineHoverTargetId,
  getTimelineLayout,
  getTimelineRange,
  getTimelineTurnStretch,
  groupCoincidentTimelineMarkers,
  groupOverlappingToolCalls,
  mergeOverlappingSubAgentSegments,
  TIMELINE_TYPE,
  timelineChartMs,
  type TimelineGap,
  type TimelineHoverTarget,
  type TimelineTurnBar,
  type TimelineTurnRange,
  type TimelineTurnStretch,
} from '../../utils/sessionEventTimelineChart.js';
import { aggregateSessionTurnBand } from '../../utils/sessionTurnViews.js';
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
/** Wide enough for a T999 label in the 10px turn font. */
const MIN_TURN_BAR_PX = 32;
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

function chartMsForTurn({
  realMs,
  turn,
  stretch,
  msPerPx,
}: {
  realMs: number;
  turn: TimelineTurnRange;
  stretch: TimelineTurnStretch;
  msPerPx: number;
}): number {
  return timelineChartMs({
    realMs,
    turnStartMs: turn.startMs,
    turnEndMs: turn.endMs,
    ordinal: turn.ordinal,
    stretch,
    msPerPx,
    turnGapPx: TURN_GAP_PX,
  });
}

function turnBarEndMs({
  turn,
  stretch,
  msPerPx,
}: {
  turn: TimelineTurnRange;
  stretch: TimelineTurnStretch;
  msPerPx: number;
}): number {
  // Covers zero-length turns too, whose stretch cannot come from scaling.
  const extraPx = stretch.extraPx[turn.ordinal] ?? 0;
  return (
    chartMsForTurn({ realMs: turn.startMs, turn, stretch, msPerPx }) +
    (turn.endMs - turn.startMs) +
    (extraPx + MARKER_PX) * msPerPx
  );
}

function turnBarLabelPoint(element: object): { x: number; y: number; width: number } | null {
  if (!('x' in element) || !('y' in element) || !('base' in element)) return null;
  const { x, y, base } = element;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof base !== 'number') return null;
  return { x: (x + base) / 2, y, width: Math.abs(x - base) };
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
  // Layout uses the real end so the content exactly fills the pane; rounding only applies to axis labels.
  const activeTotalMs = Math.max(1, segmentTotalMs);
  const axisTotalMs = Math.max(1, roundDurationMsToSecond(segmentTotalMs));
  const { turnRanges } = useMemo(() => getTimelineLayout(segments), [segments]);
  const gapCount = Math.max(0, turnRanges.length - 1);
  // Long turns keep the pane's time scale. Short turns stretch on top of it and widen the chart.
  const unclampedScaleWidthPx = widthPx - TURN_GAP_PX * gapCount - END_PAD_PX;
  const fitScaleWidthPx = Math.max(widthPx / 2, unclampedScaleWidthPx);
  const msPerPx = activeTotalMs / Math.max(1, fitScaleWidthPx);
  const orderedRanges = useMemo(
    () => [...turnRanges].sort((left, right) => left.ordinal - right.ordinal),
    [turnRanges],
  );
  const stretch = useMemo(
    () =>
      widthPx > 0
        ? getTimelineTurnStretch({
            durationsMs: orderedRanges.map(range => Math.max(0, range.endMs - range.startMs)),
            msPerPx,
            minTurnBarPx: MIN_TURN_BAR_PX,
            markerPx: MARKER_PX,
          })
        : {
            extraPx: orderedRanges.map(() => 0),
            scale: orderedRanges.map(() => 1),
            leadingExtraPx: orderedRanges.map(() => 0),
          },
    [msPerPx, orderedRanges, widthPx],
  );
  const turnsByIndex = useMemo(() => new Map(orderedRanges.map(range => [range.turnIndex, range])), [orderedRanges]);

  const visibleSegments = useMemo(
    () =>
      segments.flatMap(segment => {
        if (hiddenTypes.has(segment.type)) return [];
        const turn = turnsByIndex.get(segment.turnIndex);
        if (turn == null) return [{ ...segment }];
        return [
          {
            ...segment,
            startMs: chartMsForTurn({ realMs: segment.startMs, turn, stretch, msPerPx }),
            endMs: chartMsForTurn({ realMs: segment.endMs, turn, stretch, msPerPx }),
          },
        ];
      }),
    [hiddenTypes, msPerPx, segments, stretch, turnsByIndex],
  );
  const markerGroups = useMemo(
    () => groupCoincidentTimelineMarkers(visibleSegments, { toleranceMs: MARKER_PX * msPerPx }),
    [msPerPx, visibleSegments],
  );
  const durationSegments = useMemo(() => visibleSegments.filter(segment => !segment.isMarker), [visibleSegments]);
  const turnBars = useMemo<TimelineTurnBar[]>(
    () =>
      orderedRanges.length < 2
        ? []
        : orderedRanges.map(range => ({
            ...range,
            id: `turn-${range.turnIndex}`,
            durationMs: range.endMs - range.startMs,
            startMs: chartMsForTurn({ realMs: range.startMs, turn: range, stretch, msPerPx }),
            endMs: turnBarEndMs({ turn: range, stretch, msPerPx }),
          })),
    [msPerPx, orderedRanges, stretch],
  );
  // Unstretched content fills the pane exactly, unless the half-pane floor above clamped the
  // scale wider than the pane allows for this many gaps; that shortfall must widen the chart
  // too, or the last turns draw past the axis and clip even though the pane says it scrolls.
  const floorDeficitPx = widthPx > 0 ? Math.max(0, fitScaleWidthPx - unclampedScaleWidthPx) : 0;
  const totalExtraPx = stretch.extraPx.reduce((sum, px) => sum + px, 0) + floorDeficitPx;
  const scrolls = totalExtraPx > 0;
  const chartWidthPx = widthPx + Math.ceil(totalExtraPx);
  const timelineMaxMs = Math.max(1, chartWidthPx) * msPerPx;
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
  const subAgentToolCallGroups = useMemo(
    () =>
      subAgentLanes.flatMap(lane =>
        groupOverlappingToolCalls(lane.segments.filter(segment => segment.type === 'tool_call'))
          .filter(group => group.segments.length > 1)
          .map(group => ({ group, lane: lane.lane, subAgentLabel: lane.track.description })),
      ),
    [subAgentLanes],
  );
  const groupedSubAgentToolCallIds = useMemo(
    () => new Set(subAgentToolCallGroups.flatMap(({ group }) => group.segments.map(segment => segment.id))),
    [subAgentToolCallGroups],
  );
  const subAgentEventSegments = useMemo(
    () =>
      subAgentLanes.flatMap(lane =>
        lane.segments
          .filter(segment => !groupedSubAgentToolCallIds.has(segment.id))
          .map(segment => ({ segment, lane: lane.lane })),
      ),
    [groupedSubAgentToolCallIds, subAgentLanes],
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
      ...subAgentEventSegments.map(({ segment }): TimelineHoverTarget => ({ type: TIMELINE_TYPE.event, segment })),
      ...subAgentToolCallGroups.map(({ group, subAgentLabel }): TimelineHoverTarget => ({
        type: TIMELINE_TYPE.toolCallGroup,
        group,
        subAgentLabel,
      })),
      ...mainEventSegments.map((segment): TimelineHoverTarget | null => {
        if (segment.type !== 'sub_agent') return { type: TIMELINE_TYPE.event, segment };
        const group = subAgentGroups.find(candidate => candidate.barId === segment.id);
        return group == null ? { type: TIMELINE_TYPE.event, segment } : { type: TIMELINE_TYPE.subAgentGroup, group };
      }),
      ...toolCallGroups.map((group): TimelineHoverTarget => ({ type: TIMELINE_TYPE.toolCallGroup, group })),
    ],
    [
      mainEventSegments,
      markerGroups,
      subAgentEventSegments,
      subAgentGroups,
      subAgentToolCallGroups,
      toolCallGroups,
      turnBars,
    ],
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
        ...subAgentEventSegments.map(({ segment, lane }) =>
          barDataset({
            label: `${getSessionEventLabel(segment.type)}: ${segment.title}`,
            range: segment,
            y: centers[eventRow + 1 + lane] ?? 0,
            color: getSessionEventColor(segment.type, isDark),
            hover: getSessionEventHoverColor(segment.type, isDark),
            thickness: 12,
            order: eventOrder(segment.type),
            inflateAmount: 0.5,
          }),
        ),
        ...subAgentToolCallGroups.map(({ group, lane }) =>
          barDataset({
            label: 'Parallel tool calls',
            range: group,
            y: centers[eventRow + 1 + lane] ?? 0,
            color: getSessionEventColor('tool_call', isDark),
            hover: getSessionEventHoverColor('tool_call', isDark),
            thickness: 12,
            order: eventOrder('tool_call'),
            inflateAmount: 0.5,
          }),
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
      subAgentEventSegments,
      subAgentToolCallGroups,
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
          if (point == null) return;
          const label = `T${bar.ordinal + 1}`;
          if (ctx.measureText(label).width > point.width) return;
          ctx.fillText(label, point.x, point.y);
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

  const chartOptions = useMemo<ChartOptions<TimelineChartType>>(() => {
    const tickLabels = new Map<number, string>();
    return {
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
            tickLabels.clear();
            const realTicks = buildTimelineAxisTicks({
              activeTotalMs: axisTotalMs,
              turnStartsMs: [],
              turnGapMs: 0,
              ...(chartWidthPx > 0 ? { chartWidthPx } : {}),
            });
            scale.ticks = realTicks.map(tick => {
              // A rounded-up end label still sits on the real end.
              const realMs = Math.min(tick.value, activeTotalMs);
              let turn = orderedRanges[0];
              if (turn != null) {
                for (const range of orderedRanges) {
                  if (range.startMs <= realMs) turn = range;
                }
              }
              const value = turn == null ? realMs : chartMsForTurn({ realMs, turn, stretch, msPerPx });
              tickLabels.set(value, formatTimelineAxisDuration(tick.value));
              return { value };
            });
          },
          ticks: {
            color: axis,
            align: 'inner',
            autoSkip: false,
            includeBounds: false,
            maxTicksLimit: Math.max(9, getTimelineAxisTickTarget(chartWidthPx)),
            callback: value => tickLabels.get(Number(value)) ?? '',
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
    };
  }, [
    activeTotalMs,
    axis,
    axisTotalMs,
    band,
    chartWidthPx,
    chartTargets,
    grid,
    msPerPx,
    onSelectTurn,
    orderedRanges,
    refreshTooltipAnchor,
    stretch,
    timelineMaxMs,
  ]);

  const tooltipTurnNumber = tooltipTarget?.type === TIMELINE_TYPE.turn ? tooltipTarget.bar.ordinal + 1 : undefined;
  const tooltipTurn = tooltipTurnNumber == null ? undefined : aggregateSessionTurnBand(turns, tooltipTurnNumber);
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
      <SessionToolCallGroupTooltip
        group={tooltipTarget.group}
        {...(tooltipTarget.subAgentLabel == null ? {} : { subAgentLabel: tooltipTarget.subAgentLabel })}
      />
    ) : tooltipTarget?.type === TIMELINE_TYPE.markerGroup ? (
      <SessionMarkerGroupTooltip group={tooltipTarget.group} />
    ) : tooltipTarget?.type === TIMELINE_TYPE.subAgentGroup ? (
      <SessionSubAgentGroupTooltip group={tooltipTarget.group} />
    ) : null;

  return (
    <div ref={wrapperRef} className="w-full overflow-x-auto" data-slot="agent-session-event-timeline-chart">
      <div style={{ width: scrolls ? chartWidthPx : '100%' }}>
        <LightTooltip
          title={tooltipContent}
          side="bottom"
          triggerClassName="block w-full"
          followCursor
          interactive={false}
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
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentSessionEventTimelineChart: ComponentType<AgentSessionEventTimelineChartProps>;
  }
}
