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

describe('sessionDisplayFormat', () => {
  it('formats list metrics like the sessions mock', () => {
    assert.equal(
      formatSessionListMetrics({ totalTurns: 5, totalCostInUsd: 0.1615, totalDurationMs: 41_380 }),
      '5 turns | $0.1615 | 41.38s',
    );
    assert.equal(formatTokenCount(122_000), '122K');
    assert.equal(formatCostUsd(1.4872), '$1.4872');
    assert.equal(formatDurationMs(76_800), '1.28m');
  });
});

describe('buildSessionTurnViews', () => {
  it('derives turn headers from turn.created and turn.done events', () => {
    const itemsAsc: SessionEventItem[] = [
      {
        turnId: 'turn-1',
        event: {
          type: 'turn.created',
          id: 'evt-1',
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
          id: 'evt-2',
          state: {
            status: 'done',
            completedAt: '2026-01-01T00:01:00.000Z',
            output: null,
            requiredActions: [],
            metrics: { totalTokens: 122_000, totalCostInUsd: 1.4872 },
          },
          createdAt: '2026-01-01T00:01:00.000Z',
          threadId: null,
        },
      },
    ] as SessionEventItem[];

    assert.deepEqual(buildSessionTurnViews(itemsAsc), [
      {
        turnId: 'turn-1',
        turnNumber: 1,
        showHeader: true,
        durationMs: 60_000,
        totalTokens: 122_000,
        totalCostInUsd: 1.4872,
      },
    ]);
  });
});
