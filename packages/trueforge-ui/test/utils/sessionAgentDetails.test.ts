import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import type { SessionEventItem } from '@/server/types.js';
import {
  formatCostUsd,
  formatDurationMs,
  formatSessionListMetrics,
  formatTokenCount,
} from '@/utils/sessionDisplayFormat.js';
import { buildSessionTurnViews } from '@/utils/sessionTurnViews.js';

type TurnCreatedEvent = Extract<SessionEventItem['event'], { type: 'turn.created' }>;
type TurnDoneEvent = Extract<SessionEventItem['event'], { type: 'turn.done' }>;

function createdItem({
  turnId,
  createdAt,
  input,
}: {
  turnId: string;
  createdAt: string;
  input?: TurnCreatedEvent['input'];
}): SessionEventItem {
  return {
    turnId,
    event: {
      type: 'turn.created',
      id: `${turnId}-created`,
      turnId,
      previousTurnId: null,
      input,
      state: { status: 'running' },
      createdAt,
      threadId: null,
    },
  };
}

function doneItem({
  turnId,
  createdAt,
  state,
}: {
  turnId: string;
  createdAt: string;
  state: TurnDoneEvent['state'];
}): SessionEventItem {
  return {
    turnId,
    event: {
      type: 'turn.done',
      id: `${turnId}-done`,
      state,
      createdAt,
      threadId: null,
    },
  };
}

function messageItem({ turnId, id, createdAt }: { turnId: string; id: string; createdAt: string }): SessionEventItem {
  return {
    turnId,
    event: {
      type: 'model.message',
      id,
      threadId: 'main',
      content: id,
      createdAt,
    },
  };
}

describe('sessionDisplayFormat', () => {
  it('formats list metrics like the sessions mock', () => {
    assert.equal(
      formatSessionListMetrics({ totalTurns: 5, totalCostInUsd: 0.1615, totalDurationMs: 41_380 }),
      '5 turns | $0.1615 | 41.38s',
    );
    assert.equal(formatTokenCount(122_000), '122K');
    assert.equal(formatCostUsd(1.4872), '$1.4872');
    assert.equal(formatDurationMs(76_800), '1.28m');
    assert.equal(formatSessionListMetrics({ totalTurns: 5, totalDurationMs: 41_380 }), '5 turns | 41.38s');
  });
});

describe('buildSessionTurnViews', () => {
  it('pairs interleaved lifecycle events and sorts turns and their events', () => {
    const doneState = {
      status: 'done',
      completedAt: '2026-01-01T00:01:00.000Z',
      output: null,
      requiredActions: [],
      metrics: {
        totalTokens: 122_000,
        totalCostInUsd: 1.4872,
        totalInputTokens: 100_000,
        totalOutputTokens: 20_000,
        totalCacheReadTokens: 1_500,
        totalCacheWriteTokens: 500,
        totalReasoningTokens: 0,
      },
    } satisfies TurnDoneEvent['state'] & {
      metrics: { totalTokens: number; totalCostInUsd: number };
    };
    const itemsAsc: SessionEventItem[] = [
      createdItem({
        turnId: 'turn-2',
        createdAt: '2026-01-01T00:00:10.000Z',
        input: [{ type: 'user.message', content: 'second' }],
      }),
      createdItem({
        turnId: 'turn-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        input: [{ type: 'user.message', content: 'first' }],
      }),
      messageItem({ turnId: 'turn-2', id: 'later', createdAt: '2026-01-01T00:00:40.000Z' }),
      doneItem({ turnId: 'turn-1', createdAt: '2026-01-01T00:01:00.000Z', state: doneState }),
      messageItem({ turnId: 'turn-2', id: 'earlier', createdAt: '2026-01-01T00:00:20.000Z' }),
      doneItem({ turnId: 'turn-2', createdAt: '2026-01-01T00:01:10.000Z', state: doneState }),
    ];

    const views = buildSessionTurnViews(itemsAsc);
    assert.deepEqual(
      views.map(
        ({
          turnId,
          turnNumber,
          showHeader,
          durationMs,
          totalTokens,
          inputTokens,
          outputTokens,
          cachedTokens,
          totalCostInUsd,
        }) => ({
          turnId,
          turnNumber,
          showHeader,
          durationMs,
          totalTokens,
          inputTokens,
          outputTokens,
          cachedTokens,
          totalCostInUsd,
        }),
      ),
      [
        {
          turnId: 'turn-1',
          turnNumber: 1,
          showHeader: true,
          durationMs: 60_000,
          totalTokens: 122_000,
          // Input is uncached: 100_000 total input - 2_000 cached.
          inputTokens: 98_000,
          outputTokens: 20_000,
          cachedTokens: 2_000,
          totalCostInUsd: 1.4872,
        },
        {
          turnId: 'turn-2',
          turnNumber: 2,
          showHeader: true,
          durationMs: 60_000,
          totalTokens: 122_000,
          inputTokens: 98_000,
          outputTokens: 20_000,
          cachedTokens: 2_000,
          totalCostInUsd: 1.4872,
        },
      ],
    );
    assert.deepEqual(
      views[1]?.events.map(event => event.id),
      ['earlier', 'later'],
    );
    assert.equal(views[0]?.created.turnId, 'turn-1');
    assert.equal(views[0]?.done?.id, 'turn-1-done');
  });

  it('ignores terminal and content events without turn.created', () => {
    const terminalState = {
      status: 'cancelled',
      reason: 'stopped',
      completedAt: '2026-01-01T00:00:02.000Z',
    } satisfies TurnDoneEvent['state'];

    assert.deepEqual(
      buildSessionTurnViews([
        doneItem({ turnId: 'orphan', createdAt: '2026-01-01T00:00:02.000Z', state: terminalState }),
        messageItem({ turnId: 'orphan', id: 'orphan-message', createdAt: '2026-01-01T00:00:01.000Z' }),
      ]),
      [],
    );
  });

  it('includes running and resume-only turns', () => {
    const views = buildSessionTurnViews([
      createdItem({
        turnId: 'normal',
        createdAt: '2026-01-01T00:00:00.000Z',
        input: [{ type: 'user.message', content: 'hello' }],
      }),
      createdItem({
        turnId: 'resume',
        createdAt: '2026-01-01T00:00:05.000Z',
        input: [
          {
            type: 'user.tool_response',
            threadId: 'main',
            toolCallId: 'call-1',
            content: 'approved result',
          },
        ],
      }),
    ]);

    assert.deepEqual(
      views.map(view => ({
        turnId: view.turnId,
        turnNumber: view.turnNumber,
        status: view.created.state?.status,
        durationMs: view.durationMs,
      })),
      [
        { turnId: 'normal', turnNumber: 1, status: 'running', durationMs: undefined },
        { turnId: 'resume', turnNumber: 2, status: 'running', durationMs: undefined },
      ],
    );
    assert.equal(views[1]?.created.input?.[0]?.type, 'user.tool_response');
  });

  it('derives duration and metrics from error terminal state', () => {
    const errorState = {
      status: 'error',
      message: 'model failed',
      completedAt: '2026-01-01T00:00:03.000Z',
      metrics: { totalTokens: 7, totalCostInUsd: 0.25 },
    } satisfies TurnDoneEvent['state'] & {
      metrics: { totalTokens: number; totalCostInUsd: number };
    };

    const views = buildSessionTurnViews([
      createdItem({
        turnId: 'failed',
        createdAt: '2026-01-01T00:00:01.000Z',
        input: [{ type: 'user.message', content: 'retry' }],
      }),
      doneItem({ turnId: 'failed', createdAt: '2026-01-01T00:00:03.000Z', state: errorState }),
    ]);

    assert.deepEqual(
      views.map(({ turnId, durationMs, totalTokens, totalCostInUsd }) => ({
        turnId,
        durationMs,
        totalTokens,
        totalCostInUsd,
      })),
      [
        {
          turnId: 'failed',
          durationMs: 2_000,
          totalTokens: 7,
          totalCostInUsd: 0.25,
        },
      ],
    );
  });

  it('skips turns that have no renderable user input', () => {
    assert.deepEqual(
      buildSessionTurnViews([
        createdItem({ turnId: 'hidden', createdAt: '2026-01-01T00:00:00.000Z' }),
        createdItem({
          turnId: 'shown',
          createdAt: '2026-01-01T00:00:01.000Z',
          input: [
            { type: 'user.tool_approval', threadId: 'main', toolCallId: 'call-1', approval: { status: 'allow' } },
          ],
        }),
      ]).map(view => view.turnId),
      ['shown'],
    );
  });
});
