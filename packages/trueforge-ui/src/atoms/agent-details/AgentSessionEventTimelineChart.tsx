'use client';

import {
  BarElement,
  Chart as ChartJS,
  LinearScale,
  Tooltip,
  type ChartData,
  type ChartOptions,
  type Plugin,
} from 'chart.js';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties } from 'react';
import { Bar } from 'react-chartjs-2';

import { useThemeMode } from '../../theme/SlotsProvider.js';
import {
  formatTimelineDuration,
  getSessionEventColor,
  getSessionEventHoverColor,
  getSessionEventLabel,
  MAIN_THREAD_ID,
  type SessionEventTimelineSegment,
} from '../../utils/sessionEventTimeline.js';
import {
  buildTimelineAxisTicks,
  getActiveTimelineMs,
  getSubAgentHoverGroups,
  getSubAgentLanes,
  getTimelineHoverTargetId,
  getTimelineLayout,
  getTimelineRange,
  groupOverlappingToolCalls,
  pickLongestNonOverlappingSegments,
  TIMELINE_TYPE,
  type TimelineGap,
  type TimelineHoverTarget,
  type TimelineTurnBar,
} from '../../utils/sessionEventTimelineChart.js';
import { LightTooltip } from '../primitives/Tooltip.js';
import {
  hasSessionEventTooltip,
  SessionEventTooltip,
  SessionSubAgentGroupTooltip,
  SessionToolCallGroupTooltip,
  SessionTurnTooltip,
} from './AgentSessionTimelineTooltip.js';
import type { AgentSessionEventTimelineChartProps } from './types.js';

ChartJS.register(LinearScale, BarElement, Tooltip);

const MARKER_PX = 4;
const TURN_GAP_PX = 12;
const END_PAD_PX = 12;
const BAR_RADIUS_PX = 2;
const ROW_GAP_PX = 8;
const OVERHEAD_PX = 30;

type BarPoint = { x: [number, number]; y: number };

function rowCenters(heights: number[], gap: number): { centers: number[]; band: number } {
  const centers: number[] = [];
  let offset = 0;
  for (const height of heights) {
    centers.push(offset + height / 2);
    offset += height + gap;
  }
  return { centers, band: Math.max(0, offset - gap) };
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
  const turnFill = isDark ? '#3f3f46' : '#e4e4e7';
  const turnHover = isDark ? '#52525b' : '#d4d4d8';
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

  const activeTotalMs = Math.max(1, ...segments.map(segment => segment.endMs));
  const { turnStartsMs, turnOrdinals, turnRanges } = useMemo(() => getTimelineLayout(segments), [segments]);
  const gapCount = Math.max(0, turnStartsMs.length - 1);
  const scaleWidthPx = Math.max(widthPx / 2, widthPx - TURN_GAP_PX * gapCount - END_PAD_PX);
  const msPerPx = activeTotalMs / Math.max(1, scaleWidthPx);
  const turnGapMs = TURN_GAP_PX * msPerPx;
  const totalMs = activeTotalMs + gapCount * turnGapMs;
  const timelineMaxMs = totalMs + END_PAD_PX * msPerPx;
  const timelineGaps = useMemo<TimelineGap[]>(
    () =>
      turnStartsMs
        .slice(1)
        .map((startMs, index) => ({ startMs: startMs + index * turnGapMs, endMs: startMs + (index + 1) * turnGapMs })),
    [turnGapMs, turnStartsMs],
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
    () => visibleSegments.filter(segment => segment.type === 'sub_agent'),
    [visibleSegments],
  );
  const mainSubAgents = useMemo(() => pickLongestNonOverlappingSegments(subAgentSegments), [subAgentSegments]);
  const subAgentGroups = useMemo(
    () => getSubAgentHoverGroups({ bars: mainSubAgents, subAgentSegments }),
    [mainSubAgents, subAgentSegments],
  );
  const subAgentLanes = useMemo(
    () => getSubAgentLanes({ subAgentSegments, threadSegments: visibleSegments, minWidthMs: MARKER_PX * msPerPx }),
    [msPerPx, subAgentSegments, visibleSegments],
  );
  const mainCandidates = useMemo(() => {
    const kept = new Set(mainSubAgents.map(segment => segment.id));
    return visibleSegments.filter(
      segment => segment.threadId === MAIN_THREAD_ID || (segment.type === 'sub_agent' && kept.has(segment.id)),
    );
  }, [mainSubAgents, visibleSegments]);
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
  const eventRow = hasTurnRow ? 1 : 0;
  const { centers, band } = useMemo(
    () => rowCenters([...(hasTurnRow ? [16] : []), 28, ...Array.from({ length: laneCount }, () => 12)], ROW_GAP_PX),
    [hasTurnRow, laneCount],
  );

  const chartTargets = useMemo<Array<TimelineHoverTarget | null>>(
    () => [
      ...turnBars.map((bar): TimelineHoverTarget => ({ type: TIMELINE_TYPE.turn, bar })),
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
    [mainEventSegments, subAgentGroups, subAgentLanes, toolCallGroups, turnBars],
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

  const chartData = useMemo<ChartData<'bar', BarPoint[], string>>(
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
        ...subAgentLanes.flatMap(lane =>
          lane.segments.map(segment =>
            barDataset({
              label: `${getSessionEventLabel(segment.type)}: ${segment.title}`,
              range: segment,
              y: centers[eventRow + 1 + lane.lane] ?? 0,
              color: getSessionEventColor(segment.type),
              hover: getSessionEventHoverColor(segment.type),
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
            color: getSessionEventColor(segment.type),
            hover: getSessionEventHoverColor(segment.type),
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
            color: getSessionEventColor('tool_call'),
            hover: getSessionEventHoverColor('tool_call'),
            thickness: 28,
            order: eventOrder('tool_call'),
            inflateAmount: 0.5,
          }),
        ),
      ],
    }),
    [centers, eventRow, mainEventSegments, subAgentLanes, toolCallGroups, turnBars, turnFill, turnHover],
  );

  const turnLabelPlugin = useMemo<Plugin<'bar'>>(
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
  const overheadPlugin = useMemo<Plugin<'bar'>>(
    () => ({
      id: 'timelineOverhead',
      afterLayout(chart) {
        const next = Math.round(chart.height - chart.chartArea.height);
        setOverheadPx(previous => (previous === next ? previous : next));
      },
    }),
    [],
  );

  const chartOptions = useMemo<ChartOptions<'bar'>>(
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
            scale.ticks = buildTimelineAxisTicks({
              ticks: scale.ticks,
              totalMs,
              timelineMaxMs,
            });
          },
          ticks: {
            color: axis,
            autoSkip: false,
            includeBounds: true,
            maxTicksLimit: 9,
            stepSize: timelineMaxMs / 8,
            callback: value => {
              const timelineMs = Number(value);
              return timelineMs <= totalMs ? formatTimelineDuration(getActiveTimelineMs(timelineMs, timelineGaps)) : '';
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
    [axis, band, chartTargets, grid, onSelectTurn, refreshTooltipAnchor, timelineGaps, timelineMaxMs, totalMs],
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
          <Bar data={chartData} options={chartOptions} plugins={[turnLabelPlugin, overheadPlugin]} />
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
