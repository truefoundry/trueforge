// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentSessionEventTimelineChart } from '@/atoms/agent-details/AgentSessionEventTimelineChart.js';
import {
  SessionMarkerGroupTooltip,
  SessionSubAgentGroupTooltip,
} from '@/atoms/agent-details/AgentSessionTimelineTooltip.js';
import type { SessionEventTimelineSegment } from '@/utils/sessionEventTimeline.js';
import type { SessionTurnView } from '@/utils/sessionTurnViews.js';

let capturedOptions: unknown;
let capturedData: unknown;

vi.mock('react-chartjs-2', () => ({
  Chart: ({ data, options }: { data: unknown; options: unknown }) => {
    capturedData = data;
    capturedOptions = options;
    return <canvas role="img" aria-label="Timeline chart" />;
  },
}));

const turns: SessionTurnView[] = [
  {
    turnId: 'turn-1',
    eventTurnNumber: 1,
    turnNumber: 1,
    renderable: true,
    showHeader: true,
    created: {
      type: 'turn.created',
      id: 'turn-1-created',
      turnId: 'turn-1',
      input: [{ type: 'user.message', content: 'hello' }],
      state: { status: 'running' },
      createdAt: '2026-01-01T00:00:00.000Z',
      threadId: null,
    },
    events: [],
  },
];

const segments: SessionEventTimelineSegment[] = [
  {
    id: 'turn-1-user',
    type: 'user',
    title: 'user.message',
    description: 'hello',
    startMs: 0,
    endMs: 0,
    turnIndex: 0,
    threadId: 'main',
    isMarker: true,
  },
  {
    id: 'turn-1-model',
    type: 'model',
    title: 'model.message',
    description: 'response',
    startMs: 0,
    endMs: 1_000,
    turnIndex: 0,
    threadId: 'main',
  },
];

describe('AgentSessionEventTimelineChart', () => {
  beforeEach(() => {
    capturedData = undefined;
    capturedOptions = undefined;
  });

  it('uses one unclipped diamond close to the event row and no fractional tick step', () => {
    const coincidentSegments: SessionEventTimelineSegment[] = [
      segments[0] ??
        (() => {
          throw new Error('Expected user segment');
        })(),
      {
        id: 'turn-1-system',
        type: 'system',
        title: 'mcp.initialize',
        description: 'MCP initialized',
        startMs: 0,
        endMs: 0,
        turnIndex: 0,
        threadId: 'main',
        isMarker: true,
      },
      segments[1] ??
        (() => {
          throw new Error('Expected model segment');
        })(),
    ];

    render(<AgentSessionEventTimelineChart turns={turns} segments={coincidentSegments} hiddenTypes={new Set()} />);

    const datasets = Reflect.get(capturedData ?? {}, 'datasets');
    expect(Array.isArray(datasets)).toBe(true);
    if (!Array.isArray(datasets)) throw new Error('Expected chart datasets');
    const markerDatasets = datasets.filter(dataset => {
      if (typeof dataset !== 'object' || dataset == null) return false;
      return Reflect.get(dataset, 'type') === 'scatter';
    });
    expect(markerDatasets).toHaveLength(1);
    expect(Reflect.get(markerDatasets[0] ?? {}, 'pointStyle')).toBe('rectRot');
    expect(Reflect.get(markerDatasets[0] ?? {}, 'clip')).toBe(false);
    const markerData = Reflect.get(markerDatasets[0] ?? {}, 'data');
    const barDataset = datasets.find(dataset => {
      if (typeof dataset !== 'object' || dataset == null) return false;
      return Reflect.get(dataset, 'type') !== 'scatter';
    });
    const barData = typeof barDataset === 'object' && barDataset != null ? Reflect.get(barDataset, 'data') : undefined;
    const markerPoint = Array.isArray(markerData) ? markerData[0] : undefined;
    const barPoint = Array.isArray(barData) ? barData[0] : undefined;
    const markerY = typeof markerPoint === 'object' && markerPoint != null ? Reflect.get(markerPoint, 'y') : undefined;
    const barY = typeof barPoint === 'object' && barPoint != null ? Reflect.get(barPoint, 'y') : undefined;
    expect(typeof markerY === 'number' && typeof barY === 'number' ? barY - markerY : undefined).toBe(21);

    const scales = Reflect.get(capturedOptions ?? {}, 'scales');
    const xScale = typeof scales === 'object' && scales != null ? Reflect.get(scales, 'x') : undefined;
    const ticks = typeof xScale === 'object' && xScale != null ? Reflect.get(xScale, 'ticks') : undefined;
    expect(typeof ticks === 'object' && ticks != null ? Reflect.has(ticks, 'stepSize') : false).toBe(false);
    expect(typeof ticks === 'object' && ticks != null ? Reflect.get(ticks, 'align') : undefined).toBe('inner');
  });

  it('keeps an open tooltip anchored to live chart bounds while scrolling', async () => {
    const { container } = render(
      <AgentSessionEventTimelineChart turns={turns} segments={segments} hiddenTypes={new Set()} />,
    );
    const wrapper = container.querySelector<HTMLElement>('[data-slot="agent-session-event-timeline-chart"]');
    const canvas = screen.getByRole('img', { name: 'Timeline chart' });
    if (wrapper == null) throw new Error('Expected timeline chart wrapper');

    let chartBottom = 120;
    vi.spyOn(wrapper, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, 600, chartBottom));
    const onHover = Reflect.get(capturedOptions ?? {}, 'onHover');
    if (typeof onHover !== 'function') throw new Error('Expected Chart.js onHover callback');

    const native = new MouseEvent('mousemove', { clientX: 320 });
    Object.defineProperty(native, 'target', { value: canvas });
    const chartStub = {
      canvas,
      getDatasetMeta: () => ({ data: [{ y: 10 }] }),
      data: { datasets: [{ order: 1 }] },
    };
    act(() => onHover({ native }, [{ datasetIndex: 0 }], chartStub));

    expect(await screen.findByRole('tooltip')).toHaveStyle({ left: '320px', top: '126px' });

    chartBottom = 220;
    act(() => window.dispatchEvent(new Event('scroll')));
    await waitFor(() => {
      expect(screen.getByRole('tooltip')).toHaveStyle({ left: '320px', top: '226px' });
    });

    fireEvent.mouseLeave(canvas);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('groups overlapping tool calls within a sub-agent lane', async () => {
    const subAgentSegments: SessionEventTimelineSegment[] = [
      ...segments,
      {
        id: 'sub-agent',
        type: 'sub_agent',
        title: 'thread.created',
        description: 'Researcher',
        startMs: 100,
        endMs: 900,
        turnIndex: 0,
        threadId: 'sub-agent-thread',
      },
      {
        id: 'sub-tool-1',
        type: 'tool_call',
        title: 'tool.call',
        description: 'search',
        startMs: 200,
        endMs: 600,
        turnIndex: 0,
        threadId: 'sub-agent-thread',
      },
      {
        id: 'sub-tool-2',
        type: 'tool_call',
        title: 'tool.call',
        description: 'fetch',
        startMs: 300,
        endMs: 700,
        turnIndex: 0,
        threadId: 'sub-agent-thread',
      },
    ];
    render(<AgentSessionEventTimelineChart turns={turns} segments={subAgentSegments} hiddenTypes={new Set()} />);

    const datasets = Reflect.get(capturedData ?? {}, 'datasets');
    if (!Array.isArray(datasets)) throw new Error('Expected chart datasets');
    const groupedDatasetIndex = datasets.findIndex(dataset => Reflect.get(dataset, 'label') === 'Parallel tool calls');
    expect(groupedDatasetIndex).toBeGreaterThanOrEqual(0);
    expect(datasets.some(dataset => Reflect.get(dataset, 'label') === 'Tool call: search')).toBe(false);
    expect(datasets.some(dataset => Reflect.get(dataset, 'label') === 'Tool call: fetch')).toBe(false);

    const onHover = Reflect.get(capturedOptions ?? {}, 'onHover');
    if (typeof onHover !== 'function') throw new Error('Expected Chart.js onHover callback');
    const chartStub = {
      canvas: document.createElement('canvas'),
      getDatasetMeta: () => ({ data: [{ y: 40 }] }),
      data: { datasets: Array.from({ length: groupedDatasetIndex + 1 }, () => ({ order: 1 })) },
    };
    act(() => onHover({ native: null }, [{ datasetIndex: groupedDatasetIndex }], chartStub));

    expect(await screen.findByText('Sub-Agent: Researcher')).toBeInTheDocument();
    expect(await screen.findByText('Tool calls')).toBeInTheDocument();
    expect(screen.getByText('search').parentElement?.parentElement).not.toHaveClass('border-t');
    expect(screen.getByText('fetch')).toBeInTheDocument();
  });

  it('picks the hovered lane by y when several bars share the same x', async () => {
    const multiLaneSegments: SessionEventTimelineSegment[] = [
      ...segments,
      {
        id: 'sub-a',
        type: 'sub_agent',
        title: 'thread.created',
        description: 'Agent A',
        startMs: 100,
        endMs: 900,
        turnIndex: 0,
        threadId: 'thread-a',
      },
      {
        id: 'sub-b',
        type: 'sub_agent',
        title: 'thread.created',
        description: 'Agent B',
        startMs: 100,
        endMs: 900,
        turnIndex: 0,
        threadId: 'thread-b',
      },
      {
        id: 'model-a',
        type: 'model',
        title: 'model.message',
        description: 'response from A',
        startMs: 200,
        endMs: 600,
        turnIndex: 0,
        threadId: 'thread-a',
      },
      {
        id: 'model-b',
        type: 'model',
        title: 'model.message',
        description: 'response from B',
        startMs: 200,
        endMs: 600,
        turnIndex: 0,
        threadId: 'thread-b',
      },
    ];
    render(<AgentSessionEventTimelineChart turns={turns} segments={multiLaneSegments} hiddenTypes={new Set()} />);

    const datasets = Reflect.get(capturedData ?? {}, 'datasets');
    if (!Array.isArray(datasets)) throw new Error('Expected chart datasets');
    const yOf = (dataset: unknown) => {
      const data = Reflect.get(dataset as object, 'data');
      const point = Array.isArray(data) ? data[0] : undefined;
      return typeof point === 'object' && point != null ? Number(Reflect.get(point, 'y')) : Number.NaN;
    };
    // Datasets: turn → sub-agent events (A then B by lane) → … → main events.
    const subModels = datasets
      .map((dataset, index) => ({ index, y: yOf(dataset), label: Reflect.get(dataset, 'label') }))
      .filter(item => item.label === 'Model: model.message' && Number.isFinite(item.y))
      .slice(0, 2);
    expect(subModels).toHaveLength(2);
    const [laneA, laneB] = subModels;
    if (laneA == null || laneB == null) throw new Error('Expected two sub-agent model datasets');
    expect(laneA.y).not.toBe(laneB.y);

    const onHover = Reflect.get(capturedOptions ?? {}, 'onHover');
    if (typeof onHover !== 'function') throw new Error('Expected Chart.js onHover callback');

    const canvas = screen.getByRole('img', { name: 'Timeline chart' });
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 200));
    const yByIndex = new Map(subModels.map(item => [item.index, item.y]));
    const chartStub = {
      canvas,
      getDatasetMeta: (datasetIndex: number) => ({
        data: [{ y: yByIndex.get(datasetIndex) ?? 0 }],
      }),
      data: {
        datasets: datasets.map(dataset => ({
          order: Reflect.get(dataset as object, 'order') ?? 1,
        })),
      },
    };

    // Pointer near lane B — even when Chart.js lists lane A first.
    const native = new MouseEvent('mousemove', { clientX: 100, clientY: laneB.y });
    Object.defineProperty(native, 'target', { value: canvas });
    act(() => onHover({ native }, [{ datasetIndex: laneA.index }, { datasetIndex: laneB.index }], chartStub));

    expect(await screen.findByText('response from B')).toBeInTheDocument();
    expect(screen.queryByText('response from A')).not.toBeInTheDocument();
  });

  it('summarizes every sub-agent represented by a shared bar', () => {
    render(
      <SessionSubAgentGroupTooltip
        group={{
          id: 'sub-agent-group',
          barId: 'researcher',
          startMs: 1_000,
          endMs: 6_000,
          segments: [
            {
              id: 'researcher',
              type: 'sub_agent',
              title: 'thread.created',
              description: 'Researcher',
              startMs: 1_000,
              endMs: 6_000,
              turnIndex: 0,
              threadId: 'researcher-thread',
            },
            {
              id: 'writer',
              type: 'sub_agent',
              title: 'thread.created',
              description: 'Writer',
              startMs: 2_000,
              endMs: 5_000,
              turnIndex: 0,
              threadId: 'writer-thread',
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('Sub-agents')).toBeInTheDocument();
    expect(screen.getByText('Sub-agent 1: Researcher')).toBeInTheDocument();
    expect(screen.getByText('Sub-agent 2: Writer')).toBeInTheDocument();
    expect(screen.getAllByText('5s')).not.toHaveLength(0);
  });

  it('shows only the name for a single sub-agent bar', () => {
    render(
      <SessionSubAgentGroupTooltip
        group={{
          id: 'sub-agent-group',
          barId: 'researcher',
          startMs: 1_000,
          endMs: 6_000,
          segments: [
            {
              id: 'researcher',
              type: 'sub_agent',
              title: 'thread.created',
              description: 'Researcher',
              startMs: 1_000,
              endMs: 6_000,
              turnIndex: 0,
              threadId: 'researcher-thread',
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('Researcher')).toBeInTheDocument();
    expect(screen.queryByText('Sub-agent 1: Researcher')).not.toBeInTheDocument();
  });

  it('shows the event directly for a single diamond', () => {
    render(
      <SessionMarkerGroupTooltip
        group={{
          id: 'marker-user',
          startMs: 0,
          endMs: 0,
          segments: [
            {
              id: 'user',
              type: 'user',
              title: 'user.message',
              description: 'Hello',
              startMs: 0,
              endMs: 0,
              turnIndex: 0,
              threadId: 'main',
              isMarker: true,
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('User Message')).toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.queryByText('Events')).not.toBeInTheDocument();
  });

  it('lists every event represented by a shared diamond', () => {
    render(
      <SessionMarkerGroupTooltip
        group={{
          id: 'marker-1000',
          startMs: 1_000,
          endMs: 1_000,
          segments: [
            {
              id: 'approval',
              type: 'approval',
              title: 'tool.approval_required',
              description: 'Approval required',
              startMs: 1_000,
              endMs: 1_000,
              turnIndex: 0,
              threadId: 'main',
              isMarker: true,
            },
            {
              id: 'system',
              type: 'system',
              title: 'mcp.initialize',
              description: 'MCP initialized',
              startMs: 1_000,
              endMs: 1_000,
              turnIndex: 0,
              threadId: 'main',
              isMarker: true,
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('Events')).toBeInTheDocument();
    expect(screen.getByText('Approval required')).toBeInTheDocument();
    expect(screen.getByText('MCP initialized')).toBeInTheDocument();
  });
});

describe('AgentSessionEventTimelineChart pause chips', () => {
  beforeEach(() => {
    capturedData = undefined;
    capturedOptions = undefined;
  });

  it('hides sub-agent markers and pause chips when Sub-agent is toggled off', () => {
    const subThread = 'sub-agent-thread';
    const withSub: SessionEventTimelineSegment[] = [
      ...segments,
      {
        id: 'sub-agent',
        type: 'sub_agent',
        title: 'thread.created',
        description: 'Worker',
        startMs: 100,
        endMs: 900,
        turnIndex: 0,
        threadId: subThread,
      },
      {
        id: 'sub-approval',
        type: 'approval',
        title: 'tool.approval_required',
        description: 'Approval required',
        startMs: 400,
        endMs: 400,
        turnIndex: 0,
        threadId: subThread,
        isMarker: true,
      },
      {
        id: 'sub-pause',
        type: 'waiting_on_human',
        title: 'turn.paused',
        description: 'Paused',
        startMs: 400,
        endMs: 400,
        turnIndex: 0,
        threadId: subThread,
        isPauseChip: true,
        wallDurationMs: 5_000,
      },
    ];

    const { rerender } = render(
      <AgentSessionEventTimelineChart turns={turns} segments={withSub} hiddenTypes={new Set()} />,
    );
    let datasets = Reflect.get(capturedData ?? {}, 'datasets');
    if (!Array.isArray(datasets)) throw new Error('Expected chart datasets');
    const labelsOn = datasets.map(dataset => Reflect.get(dataset, 'label'));
    expect(labelsOn).toContain('Paused');
    expect(labelsOn).toContain('Sub-agent: thread.created');
    expect(labelsOn.some(label => typeof label === 'string' && label.includes('Approval'))).toBe(true);

    rerender(<AgentSessionEventTimelineChart turns={turns} segments={withSub} hiddenTypes={new Set(['sub_agent'])} />);
    datasets = Reflect.get(capturedData ?? {}, 'datasets');
    if (!Array.isArray(datasets)) throw new Error('Expected chart datasets');
    expect(datasets.some(dataset => Reflect.get(dataset, 'label') === 'Paused')).toBe(false);
    expect(datasets.some(dataset => Reflect.get(dataset, 'label') === 'Sub-agent: thread.created')).toBe(false);
    expect(datasets.some(dataset => Reflect.get(dataset, 'label') === 'Approval / HITL')).toBe(false);
  });

  it('draws a pause-chip bar and keeps axis ticks on active time', () => {
    const pauseSegments: SessionEventTimelineSegment[] = [
      ...segments,
      {
        id: 'pause-1',
        type: 'waiting_on_human',
        title: 'turn.paused',
        description: 'Paused',
        startMs: 500,
        endMs: 500,
        turnIndex: 0,
        threadId: 'main',
        isPauseChip: true,
        wallDurationMs: 172_800_000,
      },
      {
        id: 'approval-1',
        type: 'approval',
        title: 'tool.approval_required',
        description: 'Approval required',
        startMs: 500,
        endMs: 500,
        turnIndex: 0,
        threadId: 'main',
        isMarker: true,
      },
      {
        id: 'after-pause',
        type: 'model',
        title: 'model.message',
        description: 'resumed',
        startMs: 500,
        endMs: 800,
        turnIndex: 0,
        threadId: 'main',
      },
    ];

    render(<AgentSessionEventTimelineChart turns={turns} segments={pauseSegments} hiddenTypes={new Set()} />);

    const datasets = Reflect.get(capturedData ?? {}, 'datasets');
    expect(Array.isArray(datasets)).toBe(true);
    if (!Array.isArray(datasets)) throw new Error('Expected chart datasets');
    const pauseDataset = datasets.find(dataset => {
      if (typeof dataset !== 'object' || dataset == null) return false;
      return Reflect.get(dataset, 'label') === 'Paused';
    });
    expect(pauseDataset).toBeTruthy();
    expect(Reflect.get(pauseDataset ?? {}, 'minBarLength')).toBe(0);

    const scales = Reflect.get(capturedOptions ?? {}, 'scales');
    const xScale = typeof scales === 'object' && scales != null ? Reflect.get(scales, 'x') : undefined;
    const afterBuildTicks =
      typeof xScale === 'object' && xScale != null ? Reflect.get(xScale, 'afterBuildTicks') : undefined;
    expect(typeof afterBuildTicks).toBe('function');
    if (typeof afterBuildTicks !== 'function') throw new Error('Expected afterBuildTicks');
    const scale = { ticks: [] as Array<{ value: number }> };
    afterBuildTicks(scale);
    expect(scale.ticks.length).toBeGreaterThan(0);
    // Active-time ticks after the pause anchor are shifted by the chip width.
    const lastTick = scale.ticks.at(-1);
    expect(lastTick?.value).toBeGreaterThan(1_000);
  });
});
