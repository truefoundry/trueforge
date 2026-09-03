// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentSessionEventTimelineChart } from '@/atoms/agent-details/AgentSessionEventTimelineChart.js';
import { SessionSubAgentGroupTooltip } from '@/atoms/agent-details/AgentSessionTimelineTooltip.js';
import type { SessionEventTimelineSegment } from '@/utils/sessionEventTimeline.js';
import type { SessionTurnView } from '@/utils/sessionTurnViews.js';

let capturedOptions: unknown;

vi.mock('react-chartjs-2', () => ({
  Bar: ({ options }: { options: unknown }) => {
    capturedOptions = options;
    return <canvas role="img" aria-label="Timeline chart" />;
  },
}));

const turns: SessionTurnView[] = [
  {
    turnId: 'turn-1',
    turnNumber: 1,
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
    capturedOptions = undefined;
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
});
