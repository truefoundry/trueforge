// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgentSessionTimelineContainer } from '@/containers/AgentSessionTimelineContainer.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { SessionEventItem } from '@/server/types.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { createMockAgentUIServer } from '../server/mockServer.js';

type TurnDoneEvent = Extract<SessionEventItem['event'], { type: 'turn.done' }>;

const events: SessionEventItem[] = [
  {
    turnId: 'turn-1',
    event: {
      type: 'turn.created',
      id: 'c1',
      turnId: 'turn-1',
      previousTurnId: null,
      input: [{ type: 'user.message', content: 'hello' }],
      state: { status: 'running' },
      createdAt: '2026-01-01T00:00:00.000Z',
      threadId: null,
    },
  },
  {
    turnId: 'turn-1',
    event: {
      type: 'turn.done',
      id: 'd1',
      state: { status: 'done', completedAt: '2026-01-01T00:00:02.000Z', output: null, requiredActions: [] },
      createdAt: '2026-01-01T00:00:02.000Z',
      threadId: null,
    },
  },
];

const doneState: TurnDoneEvent['state'] = {
  status: 'done',
  completedAt: '2026-01-01T00:00:02.000Z',
  output: null,
  requiredActions: [],
};

const groupingEvents: SessionEventItem[] = [
  {
    turnId: 'turn-1',
    event: {
      type: 'turn.created',
      id: 'turn-1-created',
      turnId: 'turn-1',
      previousTurnId: null,
      input: [{ type: 'user.message', content: 'initial request' }],
      state: { status: 'running' },
      createdAt: '2026-01-01T00:00:00.000Z',
      threadId: null,
    },
  },
  {
    turnId: 'turn-1',
    event: {
      type: 'model.message',
      id: 'turn-1-model',
      threadId: 'main',
      content: 'turn one response',
      createdAt: '2026-01-01T00:00:01.000Z',
    },
  },
  {
    turnId: 'turn-1',
    event: { type: 'turn.done', id: 'turn-1-done', state: doneState, createdAt: doneState.completedAt },
  },
  {
    turnId: 'turn-2',
    event: {
      type: 'turn.created',
      id: 'turn-2-created',
      turnId: 'turn-2',
      previousTurnId: 'turn-1',
      input: [{ type: 'user.tool_response', threadId: 'main', toolCallId: 'question-1', content: 'continue' }],
      state: { status: 'running' },
      createdAt: '2026-01-01T00:00:03.000Z',
      threadId: null,
    },
  },
  {
    turnId: 'turn-2',
    event: {
      type: 'model.message',
      id: 'turn-2-model',
      threadId: 'main',
      content: 'turn two response',
      createdAt: '2026-01-01T00:00:04.000Z',
    },
  },
  {
    turnId: 'turn-2',
    event: {
      type: 'turn.done',
      id: 'turn-2-done',
      state: { ...doneState, completedAt: '2026-01-01T00:00:05.000Z' },
      createdAt: '2026-01-01T00:00:05.000Z',
    },
  },
  {
    turnId: 'turn-3',
    event: {
      type: 'turn.created',
      id: 'turn-3-created',
      turnId: 'turn-3',
      previousTurnId: 'turn-2',
      input: [{ type: 'user.tool_response', threadId: 'main', toolCallId: 'question-2', content: 'stop' }],
      state: { status: 'running' },
      createdAt: '2026-01-01T00:00:06.000Z',
      threadId: null,
    },
  },
  {
    turnId: 'turn-3',
    event: {
      type: 'turn.done',
      id: 'turn-3-done',
      state: {
        status: 'cancelled',
        reason: 'client-cancelled',
        completedAt: '2026-01-01T00:00:07.000Z',
      },
      createdAt: '2026-01-01T00:00:07.000Z',
    },
  },
  {
    turnId: 'turn-4',
    event: {
      type: 'turn.created',
      id: 'turn-4-created',
      turnId: 'turn-4',
      previousTurnId: 'turn-3',
      input: [{ type: 'user.message', content: 'retry' }],
      state: { status: 'running' },
      createdAt: '2026-01-01T00:00:08.000Z',
      threadId: null,
    },
  },
  {
    turnId: 'turn-4',
    event: {
      type: 'turn.done',
      id: 'turn-4-done',
      state: { status: 'error', message: 'model failed', completedAt: '2026-01-01T00:00:09.000Z' },
      createdAt: '2026-01-01T00:00:09.000Z',
    },
  },
];

describe('AgentSessionTimelineContainer', () => {
  it('passes grouped turns to the timeline slot and scrolls on select', async () => {
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    render(
      <SlotsProvider
        overrides={{
          AgentSessionEventTimeline: ({ turns, onSelectTurn }) => (
            <button type="button" onClick={() => onSelectTurn?.(0)}>
              {`timeline turns=${turns.length}`}
            </button>
          ),
        }}
      >
        <ServerProvider server={createMockAgentUIServer()}>
          <AgentSessionTimelineContainer sessionId="sess-1" events={events} />
        </ServerProvider>
      </SlotsProvider>,
    );

    expect(await screen.findByText('timeline turns=1')).toBeInTheDocument();
    expect(await screen.findByText('Turn 1')).toBeInTheDocument();
    expect(screen.getByText('Turns')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'timeline turns=1' }));
    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalled();
    });
  });

  it('keeps responses in their backend turns and renders terminal failures', async () => {
    render(
      <SlotsProvider
        overrides={{
          AgentSessionEventTimeline: () => null,
        }}
      >
        <ServerProvider server={createMockAgentUIServer()}>
          <AgentSessionTimelineContainer sessionId="sess-1" events={groupingEvents} />
        </ServerProvider>
      </SlotsProvider>,
    );

    const turn1 = (await screen.findByText('Turn 1')).closest('section');
    const turn2 = screen.getByText('Turn 2').closest('section');
    const turn3 = screen.getByText('Turn 3').closest('section');
    const turn4 = screen.getByText('Turn 4').closest('section');

    expect(turn1).not.toBeNull();
    expect(turn2).not.toBeNull();
    expect(turn3).not.toBeNull();
    expect(turn4).not.toBeNull();
    if (turn1 == null || turn2 == null || turn3 == null || turn4 == null) {
      throw new Error('Expected every backend turn to render a section');
    }
    expect(within(turn1).getByText('turn one response')).toBeInTheDocument();
    expect(within(turn1).queryByText('turn two response')).not.toBeInTheDocument();
    expect(within(turn2).getByText('continue')).toBeInTheDocument();
    expect(within(turn2).getByText('turn two response')).toBeInTheDocument();
    expect(within(turn3).getByText('Cancelled: client-cancelled')).toBeInTheDocument();
    expect(within(turn4).getByText('model failed')).toBeInTheDocument();
  });
});
