// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentSessionEventTimelineChart } from '@/atoms/agent-details/AgentSessionEventTimelineChart.js';
import {
  SessionMarkerGroupTooltip,
  SessionSubAgentGroupTooltip,
  SessionTurnTooltip,
} from '@/atoms/agent-details/AgentSessionTimelineTooltip.js';
import { formatAbsoluteDateTime } from '@/atoms/lib/dateFormat.js';
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
    act(() => onHover({ native }, [{ datasetIndex: 0 }]));

    expect(await screen.findByRole('tooltip')).toHaveStyle({ left: '320px', top: '126px' });

    chartBottom = 220;
    act(() => window.dispatchEvent(new Event('scroll')));
    await waitFor(() => {
      expect(screen.getByRole('tooltip')).toHaveStyle({ left: '320px', top: '226px' });
    });

    fireEvent.mouseLeave(canvas);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows created time and omits completed time while the hovered turn is running', async () => {
    const { container } = render(
      <AgentSessionEventTimelineChart
        turns={turns}
        segments={[
          ...segments,
          {
            id: 'turn-2-model',
            type: 'model',
            title: 'model.message',
            description: 'later',
            startMs: 2_000,
            endMs: 3_000,
            turnIndex: 1,
            threadId: 'main',
          },
        ]}
        hiddenTypes={new Set()}
      />,
    );
    const wrapper = container.querySelector<HTMLElement>('[data-slot="agent-session-event-timeline-chart"]');
    const canvas = screen.getByRole('img', { name: 'Timeline chart' });
    if (wrapper == null) throw new Error('Expected timeline chart wrapper');
    vi.spyOn(wrapper, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, 600, 120));
    const onHover = Reflect.get(capturedOptions ?? {}, 'onHover');
    if (typeof onHover !== 'function') throw new Error('Expected Chart.js onHover callback');

    const native = new MouseEvent('mousemove', { clientX: 320 });
    Object.defineProperty(native, 'target', { value: canvas });
    act(() => onHover({ native }, [{ datasetIndex: 0 }]));

    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent(
      `Created At${formatAbsoluteDateTime(new Date('2026-01-01T00:00:00.000Z'), { seconds: true })}`,
    );
    expect(tooltip).not.toHaveTextContent('Completed At');
  });

  it('shows completed time from turn.done completedAt', () => {
    const turn = turns[0];
    if (turn == null) throw new Error('Expected turn');
    const completedAt = '2026-01-01T00:00:30.700Z';
    render(
      <SessionTurnTooltip
        turn={{
          ...turn,
          done: {
            type: 'turn.done',
            id: 'turn-1-done',
            createdAt: completedAt,
            state: { status: 'done', completedAt },
          },
        }}
        turnNumber={1}
        durationMs={30_700}
        segments={segments}
      />,
    );

    expect(screen.getByText(formatAbsoluteDateTime(new Date(completedAt), { seconds: true }))).toBeInTheDocument();
  });

  it('grows wider than the pane and scrolls when short turns would otherwise collapse', async () => {
    const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
    const manyTurns: SessionEventTimelineSegment[] = [
      ...Array.from({ length: 8 }, (_, turnIndex) => ({
        id: `turn-${turnIndex}-model`,
        type: 'model' as const,
        title: 'model.message',
        description: 'response',
        startMs: turnIndex * 1_000,
        endMs: turnIndex * 1_000 + 1_000,
        turnIndex,
        threadId: 'main',
      })),
      {
        id: 'turn-long-model',
        type: 'model',
        title: 'model.message',
        description: 'response',
        startMs: 8_000,
        endMs: 108_000,
        turnIndex: 8,
        threadId: 'main',
      },
    ];

    try {
      const { container } = render(
        <AgentSessionEventTimelineChart turns={turns} segments={manyTurns} hiddenTypes={new Set()} />,
      );
      const wrapper = container.querySelector<HTMLElement>('[data-slot="agent-session-event-timeline-chart"]');
      if (wrapper == null) throw new Error('Expected timeline chart wrapper');
      expect(wrapper).toHaveClass('overflow-x-auto');
      await waitFor(() => {
        const width = wrapper.firstElementChild?.getAttribute('style') ?? '';
        const pixels = Number(/width:\s*(\d+(?:\.\d+)?)px/.exec(width)?.[1]);
        expect(pixels).toBeGreaterThan(400);
      });
    } finally {
      clientWidth.mockRestore();
    }
  });

  it('keeps every turn within the drawn axis even when the gap floor forces extra room', () => {
    // 100px pane, 6 turns -> 5 gaps. Unclamped scale (100 - 5*12 - 12 = 28) is below the
    // half-pane floor (50), so the floor itself demands 22px more than the pane has.
    const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100);
    const sixTurns: SessionEventTimelineSegment[] = Array.from({ length: 6 }, (_, turnIndex) => ({
      id: `turn-${turnIndex}-model`,
      type: 'model' as const,
      title: 'model.message',
      description: 'response',
      startMs: turnIndex * 1_000,
      endMs: turnIndex * 1_000 + 1_000,
      turnIndex,
      threadId: 'main',
    }));

    try {
      render(<AgentSessionEventTimelineChart turns={turns} segments={sixTurns} hiddenTypes={new Set()} />);
      const datasets = Reflect.get(capturedData ?? {}, 'datasets');
      if (!Array.isArray(datasets)) throw new Error('Expected chart datasets');
      const turnEndsMs = datasets.flatMap(dataset => {
        const label = Reflect.get(dataset, 'label');
        if (typeof label !== 'string' || !label.startsWith('Turn ')) return [];
        const data = Reflect.get(dataset, 'data');
        const point = Array.isArray(data) ? data[0] : undefined;
        const range = typeof point === 'object' && point != null ? Reflect.get(point, 'x') : undefined;
        return Array.isArray(range) ? [Number(range[1])] : [];
      });
      expect(turnEndsMs).toHaveLength(6);

      const scales = Reflect.get(capturedOptions ?? {}, 'scales');
      const xScale = typeof scales === 'object' && scales != null ? Reflect.get(scales, 'x') : undefined;
      const axisMaxMs = typeof xScale === 'object' && xScale != null ? Number(Reflect.get(xScale, 'max')) : NaN;
      expect(axisMaxMs).toBeGreaterThanOrEqual(Math.max(...turnEndsMs));
    } finally {
      clientWidth.mockRestore();
    }
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
    act(() => onHover({ native: null }, [{ datasetIndex: groupedDatasetIndex }]));

    expect(await screen.findByText('Sub-Agent: Researcher')).toBeInTheDocument();
    expect(await screen.findByText('Tool calls')).toBeInTheDocument();
    expect(screen.getByText('search').parentElement?.parentElement).not.toHaveClass('border-t');
    expect(screen.getByText('fetch')).toBeInTheDocument();
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
