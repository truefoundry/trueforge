// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgentSessionEventTimeline } from '@/atoms/agent-details/AgentSessionEventTimeline.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import type { SessionEventTimelineSegment } from '@/utils/sessionEventTimeline.js';
import type { SessionTurnView } from '@/utils/sessionTurnViews.js';

const turns = [
  {
    turnId: 't1',
    turnNumber: 1,
    showHeader: true,
    created: {
      type: 'turn.created',
      id: 'c1',
      turnId: 't1',
      previousTurnId: null,
      input: [{ type: 'user.message', content: 'hi' }],
      state: { status: 'running' },
      createdAt: '2026-01-01T00:00:00.000Z',
      threadId: null,
    },
    events: [],
  },
] as SessionTurnView[];

const segments: SessionEventTimelineSegment[] = [
  {
    id: 't1-user',
    type: 'user',
    title: 'user.message',
    description: 'hi',
    startMs: 0,
    endMs: 0,
    turnIndex: 0,
    threadId: 'main',
    isMarker: true,
  },
  {
    id: 't1-model',
    type: 'model',
    title: 'model.message',
    description: 'hello',
    startMs: 0,
    endMs: 1_000,
    turnIndex: 0,
    threadId: 'main',
  },
];

describe('AgentSessionEventTimeline', () => {
  it('renders event-type filters and honors a chart slot override', () => {
    const onSelectTurn = vi.fn();
    render(
      <SlotsProvider
        overrides={{
          AgentSessionEventTimelineChart: ({ hiddenTypes, onSelectTurn: select }) => (
            <button type="button" onClick={() => select?.(0)}>
              {`chart hidden=${[...hiddenTypes].join(',') || 'none'}`}
            </button>
          ),
        }}
      >
        <AgentSessionEventTimeline turns={turns} segments={segments} onSelectTurn={onSelectTurn} />
      </SlotsProvider>,
    );

    expect(screen.getByText('Event types')).toBeInTheDocument();
    expect(screen.getByText('Event types').parentElement).toHaveClass('border-b');
    fireEvent.click(screen.getByRole('button', { name: 'User' }));
    expect(screen.getByRole('button', { name: /chart hidden=/ })).toHaveTextContent('user');
    fireEvent.click(screen.getByRole('button', { name: /chart hidden=/ }));
    expect(onSelectTurn).toHaveBeenCalledWith(0);
  });

  it('renders nothing when there are no segments', () => {
    const { container } = render(<AgentSessionEventTimeline turns={turns} segments={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
