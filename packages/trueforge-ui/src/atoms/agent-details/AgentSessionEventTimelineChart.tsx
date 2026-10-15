'use client';

import {
  BarController,
  BarElement,
  Chart as ChartJS,
  LinearScale,
  PointElement,
  ScatterController,
  Tooltip,
  type ActiveElement,
  type ChartData,
  type ChartDataset,
  type ChartEvent,
  type Chart as ChartJsInstance,
  type ChartOptions,
  type Plugin,
} from 'chart.js';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties } from 'react';
import { Chart } from 'react-chartjs-2';

import { useThemeMode } from '../../theme/SlotsProvider.js';
import { formatReadableDurationMs, roundDurationMsToSecond } from '../../utils/sessionDisplayFormat.js';
import {
  getSessionEventColor,
  getSessionEventHoverColor,
  getSessionEventLabel,
  MAIN_THREAD_ID,
  mergedPauseWallMs,
  segmentsForTurnTooltip,
  type SessionEventTimelineSegment,
} from '../../utils/sessionEventTimeline.js';
import {
  applyPauseChipLayout,
  buildTimelineAxisTicks,
  getSubAgentHoverGroups,
  getSubAgentLanes,
  getTimelineHoverTargetId,
  getTimelineLayout,
  getTimelineRange,
  getTurnGapAnchorMs,
  getTurnGapShiftsMs,
  getWallTimelineMs,
  groupCoincidentTimelineMarkers,
  groupOverlappingToolCalls,
  mergeOverlappingSubAgentSegments,
  packTimelineMarkers,
  TIMELINE_TYPE,
  type TimelineGap,
  type TimelineHoverTarget,
  type TimelinePauseChipRange,
  type TimelineTurnBar,
  type TimelineVisualGap,
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

/** Diamond / min bar width in px. */
const MARKER_PX = 4;
/** Empty space drawn between turns (not real idle time). */
const TURN_GAP_PX = 12;
/** Fixed width of each hatched “Paused” chip. */
const PAUSE_CHIP_PX = 32;
const END_PAD_PX = 12;
const BAR_RADIUS_PX = 2;
const ROW_GAP_PX = 8;
const MARKER_EVENT_GAP_PX = 2;
const OVERHEAD_PX = 30;

const hatchPatternCache = new Map<string, CanvasPattern | string>();

/**
 * Diagonal stripe fill for pause chips.
 * Gray tokens invert under `.dark`, so resolve against a root that matches `isDark`
 * and keep mode-correct fallbacks (light cyan wash / dark surface).
 */
function pauseHatchFill(color: string, isDark: boolean): CanvasPattern | string {
  const strokeVar = isDark ? '--color-gray-400' : '--color-gray-600';
  const fillVar = isDark ? '--secondary-bg' : '--color-gray-100';
  const fillFallback = isDark ? '#27272a' : '#ecfeff';
  const strokeFallback = isDark ? '#52525b' : '#52525b';
  const key = `${color}:${fillVar}:${strokeVar}:${isDark ? 'd' : 'l'}:v2`;
  const cached = hatchPatternCache.get(key);
  if (cached != null) return cached;
  if (typeof document === 'undefined') return color;
  try {
    const themedRoot =
      document.querySelector(isDark ? '.aui-theme-root.dark' : '.aui-theme-root:not(.dark)') ??
      document.querySelector('.aui-theme-root') ??
      document.documentElement;
    const styles = getComputedStyle(themedRoot);
    const stroke = styles.getPropertyValue(strokeVar).trim() || strokeFallback;
    // Light: soft cyan wash (waiting). Dark: secondary surface from theme (fallback #27272a).
    const fillColor = isDark ? styles.getPropertyValue(fillVar).trim() || fillFallback : fillFallback;
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const ctx = canvas.getContext('2d');
    if (ctx == null) return color;
    ctx.fillStyle = fillColor;
    ctx.fillRect(0, 0, 8, 8);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-2, 6);
    ctx.lineTo(6, -2);
    ctx.moveTo(2, 10);
    ctx.lineTo(10, 2);
    ctx.stroke();
    const pattern = ctx.createPattern(canvas, 'repeat');
    const fill = pattern ?? color;
    hatchPatternCache.set(key, fill);
    return fill;
  } catch {
    return color;
  }
}

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

/**
 * Horizontal bars share x; Chart.js often returns every lane at that time.
 * Prefer the element whose y is closest to the pointer; on a tie, higher order
 * (pause hatch over model/tool).
 */
function pickTimelineHoverElement({
  chart,
  event,
  elements,
}: {
  chart: ChartJsInstance;
  event: ChartEvent;
  elements: ActiveElement[];
}): ActiveElement | undefined {
  if (elements.length === 0) return undefined;
  if (elements.length === 1) return elements[0];

  const native = event.native;
  const pointerY = native instanceof MouseEvent ? native.clientY - chart.canvas.getBoundingClientRect().top : null;

  let best = elements[0];
  let bestYDist = Number.POSITIVE_INFINITY;
  let bestOrder = Number.NEGATIVE_INFINITY;
  for (const element of elements) {
    const meta = chart.getDatasetMeta(element.datasetIndex);
    const point = meta.data[element.index ?? 0];
    const y = point != null && 'y' in point && typeof point.y === 'number' ? point.y : Number.NaN;
    const yDist = pointerY != null && Number.isFinite(y) ? Math.abs(y - pointerY) : 0;
    const dataset = chart.data.datasets[element.datasetIndex];
    const order = dataset != null && 'order' in dataset && typeof dataset.order === 'number' ? dataset.order : 0;
    if (yDist < bestYDist - 0.5 || (Math.abs(yDist - bestYDist) <= 0.5 && order > bestOrder)) {
      best = element;
      bestYDist = yDist;
      bestOrder = order;
    }
  }
  return best;
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

  // Compressed “active work” length (pauses already collapsed to points).
  const segmentTotalMs = Math.max(0, ...segments.map(segment => segment.endMs));
  const activeTotalMs = Math.max(1, roundDurationMsToSecond(segmentTotalMs));
  const { turnStartsMs, turnRanges } = useMemo(() => getTimelineLayout(segments), [segments]);
  const activeTurnStartsMs = useMemo(
    () => turnStartsMs.filter((startMs, index) => index === 0 || startMs <= activeTotalMs),
    [activeTotalMs, turnStartsMs],
  );
  const hideSubAgentThreads = hiddenTypes.has('sub_agent');
  // Unique starts for scale/gaps — concurrent sub-agent pause chips share one slot.
  const pauseChipStartsMs = useMemo(() => {
    // Include compression-only chips so scale width still reserves PAUSE_CHIP_PX.
    const starts = segments
      .filter(segment => {
        if (!segment.isPauseChip) return false;
        if (hiddenTypes.has(segment.type)) return false;
        // Hidden sub-agent lanes are dropped from layout, so their chips must not
        // reserve an axis slot the remaining bars never shift through.
        if (hideSubAgentThreads && segment.threadId !== MAIN_THREAD_ID) return false;
        return true;
      })
      .map(segment => segment.startMs);
    return [...new Set(starts)].sort((left, right) => left - right);
  }, [hiddenTypes, hideSubAgentThreads, segments]);
  const turnGapAnchorMs = useMemo(
    () =>
      getTurnGapAnchorMs({ turnRanges, pauseChipStartsMs }).filter(
        startMs => startMs <= activeTotalMs || activeTurnStartsMs.includes(startMs),
      ),
    [activeTotalMs, activeTurnStartsMs, pauseChipStartsMs, turnRanges],
  );
  const gapCount = turnGapAnchorMs.length;
  const pauseChipCount = pauseChipStartsMs.length;
  // Reserve fixed px for turn gaps + pause chips, then map remaining width → ms.
  const scaleWidthPx = Math.max(
    widthPx / 2,
    widthPx - TURN_GAP_PX * gapCount - PAUSE_CHIP_PX * pauseChipCount - END_PAD_PX,
  );
  const msPerPx = activeTotalMs / Math.max(1, scaleWidthPx);
  const turnGapMs = TURN_GAP_PX * msPerPx;
  const pauseChipMs = PAUSE_CHIP_PX * msPerPx;
  const turnGapShiftsMs = useMemo(
    () => getTurnGapShiftsMs({ turnRanges, pauseChipStartsMs, turnGapMs }),
    [pauseChipStartsMs, turnGapMs, turnRanges],
  );
  // Visual gaps drive both chart spacing and wall-time axis labels.
  const visualGaps = useMemo<TimelineVisualGap[]>(() => {
    const turnGaps = turnGapAnchorMs.map(atActiveMs => ({ atActiveMs, gapMs: turnGapMs }));
    const pauseGapsByStart = new Map<number, TimelineVisualGap>();
    for (const segment of segments) {
      if (!segment.isPauseChip || hiddenTypes.has(segment.type)) continue;
      if (hideSubAgentThreads && segment.threadId !== MAIN_THREAD_ID) continue;
      if (pauseGapsByStart.has(segment.startMs)) continue;
      pauseGapsByStart.set(segment.startMs, {
        atActiveMs: segment.startMs,
        gapMs: pauseChipMs,
        containsAnchor: true,
        wallDurationMs: segment.wallDurationMs ?? 0,
      });
    }
    return [...turnGaps, ...pauseGapsByStart.values()].sort((left, right) => left.atActiveMs - right.atActiveMs);
  }, [hiddenTypes, hideSubAgentThreads, pauseChipMs, segments, turnGapAnchorMs, turnGapMs]);
  const totalMs = activeTotalMs + visualGaps.reduce((sum, gap) => sum + gap.gapMs, 0);
  const timelineMaxMs = totalMs + END_PAD_PX * msPerPx;

  // Shift later turns for separators, then expand each pause chip to pauseChipMs.
  // Hiding "Sub-agent" drops that type and every non-main thread (markers/pauses stay off main).
  const visibleSegments = useMemo(() => {
    const turnShifted = segments.flatMap(segment => {
      if (hiddenTypes.has(segment.type)) return [];
      if (hideSubAgentThreads && segment.threadId !== MAIN_THREAD_ID) return [];
      const shiftMs = turnGapShiftsMs.get(segment.turnIndex) ?? 0;
      return [{ ...segment, startMs: segment.startMs + shiftMs, endMs: segment.endMs + shiftMs }];
    });
    return applyPauseChipLayout({ segments: turnShifted, pauseChipMs });
  }, [hiddenTypes, hideSubAgentThreads, pauseChipMs, segments, turnGapShiftsMs]);
  const pauseChipSegments = useMemo(
    () => visibleSegments.filter(segment => segment.isPauseChip && !segment.isCompressionOnly),
    [visibleSegments],
  );
  const pauseSpanSegments = useMemo(
    () => visibleSegments.filter(segment => segment.isPauseSpan && !segment.isCompressionOnly),
    [visibleSegments],
  );
  const pauseHatchSegments = useMemo(
    () => [...pauseChipSegments, ...pauseSpanSegments],
    [pauseChipSegments, pauseSpanSegments],
  );
  const pauseChipRanges = useMemo<TimelinePauseChipRange[]>(
    () =>
      pauseHatchSegments.map(segment => ({
        id: segment.id,
        startMs: segment.startMs,
        endMs: segment.endMs,
        wallDurationMs: segment.wallDurationMs ?? Math.max(0, segment.endMs - segment.startMs),
        threadId: segment.threadId,
      })),
    [pauseHatchSegments],
  );
  // Merge near-identical x diamonds, then spread pause ones across each chip.
  const markerGroups = useMemo(
    () =>
      groupCoincidentTimelineMarkers(
        visibleSegments.filter(segment => !segment.isPauseChip && !segment.isPauseSpan),
        { toleranceMs: MARKER_PX * msPerPx },
      ),
    [msPerPx, visibleSegments],
  );
  const packedMarkers = useMemo(
    () => packTimelineMarkers({ groups: markerGroups, pauseChips: pauseChipRanges }),
    [markerGroups, pauseChipRanges],
  );
  const durationSegments = useMemo(
    () => visibleSegments.filter(segment => !segment.isMarker && !segment.isPauseChip && !segment.isPauseSpan),
    [visibleSegments],
  );
  const turnBars = useMemo<TimelineTurnBar[]>(() => {
    if (turnRanges.length < 2) return [];
    return turnRanges.map(range => {
      const inTurn = visibleSegments.filter(segment => segment.turnIndex === range.turnIndex);
      const fallbackStart = range.startMs + (turnGapShiftsMs.get(range.turnIndex) ?? 0);
      const startMs = inTurn.reduce((min, segment) => Math.min(min, segment.startMs), fallbackStart);
      const endMs = inTurn.reduce((max, segment) => Math.max(max, segment.endMs), startMs) + MARKER_PX * msPerPx;
      // Compressed range omits pause waits. Merge chips with spans so a sibling
      // that is still waiting after resume is included once.
      const pauseWallMs = mergedPauseWallMs(segments.filter(segment => segment.turnIndex === range.turnIndex));
      return {
        ...range,
        id: `turn-${range.turnIndex}`,
        durationMs: range.endMs - range.startMs + pauseWallMs,
        startMs,
        endMs,
      };
    });
  }, [msPerPx, segments, turnGapShiftsMs, turnRanges, visibleSegments]);
  const subAgentSegments = useMemo(
    () => durationSegments.filter(segment => segment.type === 'sub_agent'),
    [durationSegments],
  );
  const mainSubAgents = useMemo(() => mergeOverlappingSubAgentSegments(subAgentSegments), [subAgentSegments]);
  const subAgentGroups = useMemo(() => {
    const groups = getSubAgentHoverGroups({ bars: mainSubAgents, subAgentSegments });
    // Chart span is compressed (pause chips are points); add wall waits for tooltip duration.
    return groups.map(group => {
      const threadIds = new Set(group.segments.map(segment => segment.threadId));
      const compressed = segments.filter(segment => segment.type === 'sub_agent' && threadIds.has(segment.threadId));
      const activeStartMs = compressed.reduce(
        (min, segment) => Math.min(min, segment.startMs),
        Number.POSITIVE_INFINITY,
      );
      const activeEndMs = compressed.reduce((max, segment) => Math.max(max, segment.endMs), 0);
      const activeMs =
        Number.isFinite(activeStartMs) && activeEndMs >= activeStartMs
          ? activeEndMs - activeStartMs
          : group.endMs - group.startMs;
      const turnIndex = group.segments[0]?.turnIndex;
      const pauseWallMs = mergedPauseWallMs(
        segments.filter(segment => segment.turnIndex === turnIndex && threadIds.has(segment.threadId)),
      );
      return { ...group, durationMs: activeMs + pauseWallMs };
    });
  }, [mainSubAgents, segments, subAgentSegments]);
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
  const laneByThreadId = useMemo(() => {
    const map = new Map<string, number>();
    for (const lane of subAgentLanes) map.set(lane.threadId, lane.lane);
    return map;
  }, [subAgentLanes]);
  const hasTurnRow = turnBars.length > 0;
  const markerRow = hasTurnRow ? 1 : 0;
  const eventRow = markerRow + 1;
  // Sub-agent diamonds sit on a dedicated row above their lane bar (like main markers).
  const lanesWithMarkers = useMemo(() => {
    const lanes = new Set<number>();
    for (const marker of packedMarkers) {
      const threadIds = new Set(marker.segments.map(segment => segment.threadId));
      if (threadIds.size !== 1) continue;
      const threadId = [...threadIds][0];
      if (threadId == null || threadId === MAIN_THREAD_ID) continue;
      const lane = laneByThreadId.get(threadId);
      if (lane != null) lanes.add(lane);
    }
    return lanes;
  }, [laneByThreadId, packedMarkers]);
  const subAgentRowIndex = useMemo(() => {
    const markerRows = new Map<number, number>();
    const barRows = new Map<number, number>();
    let row = eventRow + 1;
    for (let lane = 0; lane < laneCount; lane += 1) {
      if (lanesWithMarkers.has(lane)) {
        markerRows.set(lane, row);
        row += 1;
      }
      barRows.set(lane, row);
      row += 1;
    }
    return { markerRows, barRows };
  }, [eventRow, laneCount, lanesWithMarkers]);
  const { centers, band } = useMemo(() => {
    const heights = [
      ...(hasTurnRow ? [16] : []),
      10,
      28,
      ...Array.from({ length: laneCount }, (_, lane) =>
        lanesWithMarkers.has(lane) ? ([10, 12] as const) : ([12] as const),
      ).flat(),
    ];
    const gaps = heights.map((_, index) => {
      if (index === heights.length - 1) return 0;
      // Tight gap between a lane's marker row and its bar.
      if (index > eventRow && heights[index] === 10 && heights[index + 1] === 12) return MARKER_EVENT_GAP_PX;
      return index === markerRow ? MARKER_EVENT_GAP_PX : ROW_GAP_PX;
    });
    return rowCenters({ heights, gaps });
  }, [eventRow, hasTurnRow, laneCount, lanesWithMarkers, markerRow]);

  const yForSubAgentBar = useCallback(
    (lane: number) => centers[subAgentRowIndex.barRows.get(lane) ?? eventRow + 1 + lane] ?? 0,
    [centers, eventRow, subAgentRowIndex.barRows],
  );
  const yForSubAgentMarker = useCallback(
    (lane: number) => {
      const markerRowIndex = subAgentRowIndex.markerRows.get(lane);
      if (markerRowIndex != null) return centers[markerRowIndex] ?? yForSubAgentBar(lane);
      return yForSubAgentBar(lane);
    },
    [centers, subAgentRowIndex.markerRows, yForSubAgentBar],
  );

  /** Main event/marker row, or the matching sub-agent bar/marker row. No main fallback for orphan threads. */
  const yForThread = useCallback(
    (threadId: string, mainY: number, { forMarker = false }: { forMarker?: boolean } = {}) => {
      if (threadId === MAIN_THREAD_ID) return mainY;
      const lane = laneByThreadId.get(threadId);
      if (lane == null) return null;
      return forMarker ? yForSubAgentMarker(lane) : yForSubAgentBar(lane);
    },
    [laneByThreadId, yForSubAgentBar, yForSubAgentMarker],
  );
  const hasThreadLane = useCallback(
    (threadId: string) => threadId === MAIN_THREAD_ID || laneByThreadId.has(threadId),
    [laneByThreadId],
  );
  // Drop sub-thread markers/pauses that have no lane (never fall back onto the main bar).
  const displayMarkers = useMemo(
    () =>
      packedMarkers.filter(marker => {
        const threadIds = new Set(marker.segments.map(segment => segment.threadId));
        const threadId = threadIds.size === 1 ? ([...threadIds][0] ?? MAIN_THREAD_ID) : MAIN_THREAD_ID;
        return hasThreadLane(threadId);
      }),
    [hasThreadLane, packedMarkers],
  );
  const displayPauseChips = useMemo(
    () => pauseHatchSegments.filter(segment => hasThreadLane(segment.threadId)),
    [hasThreadLane, pauseHatchSegments],
  );

  // Dataset paint order: bars → pause hatch (above tools) → markers (top).
  const chartTargets = useMemo<Array<TimelineHoverTarget | null>>(
    () => [
      ...turnBars.map((bar): TimelineHoverTarget => ({ type: TIMELINE_TYPE.turn, bar })),
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
      ...displayPauseChips.map((segment): TimelineHoverTarget => ({ type: TIMELINE_TYPE.event, segment })),
      ...displayMarkers.map((marker): TimelineHoverTarget => ({
        type: TIMELINE_TYPE.markerGroup,
        group: {
          id: marker.id,
          startMs: marker.x,
          endMs: marker.x,
          segments: marker.segments,
        },
      })),
    ],
    [
      displayMarkers,
      displayPauseChips,
      mainEventSegments,
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
  }: {
    label: string;
    range: TimelineGap;
    y: number;
    color: string;
    hover: string;
    thickness: number;
    order?: number;
  }) => ({
    label,
    data: [{ x: getTimelineRange(range), y }] satisfies BarPoint[],
    backgroundColor: color,
    hoverBackgroundColor: hover,
    hoverBorderColor: hover,
    borderWidth: 0,
    borderSkipped: false,
    borderRadius: BAR_RADIUS_PX,
    // No min width on duration bars — expanding into the pause hatch causes overlap.
    minBarLength: 0,
    barThickness: thickness,
    grouped: false,
    order,
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
        ...subAgentEventSegments.map(({ segment, lane }) =>
          barDataset({
            label: `${getSessionEventLabel(segment.type)}: ${segment.title}`,
            range: segment,
            y: yForSubAgentBar(lane),
            color: getSessionEventColor(segment.type, isDark),
            hover: getSessionEventHoverColor(segment.type, isDark),
            thickness: 12,
            order: eventOrder(segment.type),
          }),
        ),
        ...subAgentToolCallGroups.map(({ group, lane }) =>
          barDataset({
            label: 'Parallel tool calls',
            range: group,
            y: yForSubAgentBar(lane),
            color: getSessionEventColor('tool_call', isDark),
            hover: getSessionEventHoverColor('tool_call', isDark),
            thickness: 12,
            order: eventOrder('tool_call'),
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
          }),
        ),
        // After tool bars so the hatch isn’t covered; markers stay last (on top).
        ...displayPauseChips.map(segment => {
          const color = getSessionEventColor('waiting_on_human', isDark);
          const onSubAgent = segment.threadId !== MAIN_THREAD_ID && laneByThreadId.has(segment.threadId);
          return {
            ...barDataset({
              label: 'Paused',
              range: segment,
              y: yForThread(segment.threadId, centers[eventRow] ?? 0) ?? 0,
              color,
              hover: getSessionEventHoverColor('waiting_on_human', isDark),
              thickness: onSubAgent ? 12 : 28,
              order: 4,
            }),
            backgroundColor: pauseHatchFill(color, isDark),
            hoverBackgroundColor: pauseHatchFill(color, isDark),
            minBarLength: 0,
          };
        }),
        ...displayMarkers.map(marker => {
          const type = marker.segments.length === 1 ? marker.segments[0]?.type : 'system';
          const color = getSessionEventColor(type ?? 'system', isDark);
          const threadIds = new Set(marker.segments.map(segment => segment.threadId));
          const threadId = threadIds.size === 1 ? ([...threadIds][0] ?? MAIN_THREAD_ID) : MAIN_THREAD_ID;
          return {
            type: 'scatter' as const,
            label: marker.segments.map(segment => getSessionEventLabel(segment.type)).join(', '),
            data: [
              {
                x: marker.x,
                y: yForThread(threadId, centers[markerRow] ?? 0, { forMarker: true }) ?? 0,
              },
            ] satisfies MarkerPoint[],
            pointStyle: 'rectRot' as const,
            pointRadius: 5,
            pointHoverRadius: 6,
            clip: false,
            backgroundColor: color,
            hoverBackgroundColor: getSessionEventHoverColor(type ?? 'system', isDark),
            borderWidth: 0,
            order: 5,
          } satisfies ChartDataset<'scatter', MarkerPoint[]>;
        }),
      ],
    }),
    [
      centers,
      displayMarkers,
      displayPauseChips,
      eventRow,
      isDark,
      laneByThreadId,
      mainEventSegments,
      markerRow,
      subAgentEventSegments,
      subAgentToolCallGroups,
      toolCallGroups,
      turnBars,
      turnFill,
      turnHover,
      yForSubAgentBar,
      yForThread,
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
      // Resolve by x and y so sibling lanes at the same time don’t steal hover.
      interaction: { mode: 'nearest', axis: 'xy', intersect: true },
      onClick: (event, elements, chart) => {
        const picked = pickTimelineHoverElement({ chart, event, elements });
        const target = chartTargets[picked?.datasetIndex ?? -1];
        if (target?.type === TIMELINE_TYPE.turn) onSelectTurn?.(target.bar.turnIndex);
      },
      onHover: (event, elements, chart) => {
        const picked = pickTimelineHoverElement({ chart, event, elements });
        const hoveredDatasetIndex = picked?.datasetIndex;
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
            scale.ticks = buildTimelineAxisTicks({ activeTotalMs, visualGaps });
          },
          ticks: {
            color: axis,
            align: 'inner',
            autoSkip: false,
            includeBounds: false,
            maxTicksLimit: 9,
            // Chart x is compressed; labels jump by wall wait across pause chips.
            callback: value => {
              const timelineMs = Number(value);
              return timelineMs <= totalMs
                ? formatReadableDurationMs(getWallTimelineMs({ valueMs: timelineMs, visualGaps }))
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
      axis,
      band,
      chartTargets,
      grid,
      onSelectTurn,
      refreshTooltipAnchor,
      timelineMaxMs,
      totalMs,
      visualGaps,
    ],
  );

  const tooltipTurnNumber = tooltipTarget?.type === TIMELINE_TYPE.turn ? tooltipTarget.bar.ordinal + 1 : undefined;
  const tooltipTurn = tooltipTurnNumber == null ? undefined : aggregateSessionTurnBand(turns, tooltipTurnNumber);
  const containerStyle = useMemo<CSSProperties>(() => ({ height: band + overheadPx }), [band, overheadPx]);
  const tooltipContent =
    tooltipTarget?.type === TIMELINE_TYPE.turn && tooltipTurn != null ? (
      <SessionTurnTooltip
        turn={tooltipTurn}
        turnNumber={tooltipTarget.bar.ordinal + 1}
        durationMs={tooltipTarget.bar.durationMs}
        segments={segmentsForTurnTooltip(segments.filter(segment => segment.turnIndex === tooltipTarget.bar.turnIndex))}
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
    <div ref={wrapperRef} className="w-full" data-slot="agent-session-event-timeline-chart">
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
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentSessionEventTimelineChart: ComponentType<AgentSessionEventTimelineChartProps>;
  }
}
