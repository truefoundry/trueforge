// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgentSessionTimelineContainer } from '@/containers/AgentSessionTimelineContainer.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { SessionEventItem } from '@/server/types.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { createMockAgentUIServer } from '../server/mockServer.js';

vi.mock('@truefoundry/assistant-ui-runtime', async () => {
  const actual = await vi.importActual<typeof import('@truefoundry/assistant-ui-runtime')>(
    '@truefoundry/assistant-ui-runtime',
  );
  return {
    ...actual,
    convertTurnsToThreadMessages: vi.fn(async () => ({ messages: [] })),
  };
});

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
});
