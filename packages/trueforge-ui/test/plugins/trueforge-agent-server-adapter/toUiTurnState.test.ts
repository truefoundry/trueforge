import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { toUiTurnDoneMetrics, toUiTurnState } from '@/plugins/trueforge-agent-server-adapter/toUiTurnState.js';

describe('toUiTurnState', () => {
  it('fills optional SDK token fields so TurnDoneMetrics is complete', () => {
    assert.deepEqual(toUiTurnDoneMetrics({ totalInputTokens: 3, totalCostInUsd: 0.12 }), {
      totalInputTokens: 3,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalReasoningTokens: 0,
      totalCostInUsd: 0.12,
    });
  });

  it('maps a done state with partial metrics', () => {
    assert.deepEqual(
      toUiTurnState({
        status: 'done',
        completedAt: '2026-01-01T00:00:00.000Z',
        output: null,
        requiredActions: [],
        metrics: { totalTokens: 10 },
      }),
      {
        status: 'done',
        completedAt: '2026-01-01T00:00:00.000Z',
        requiredActions: [],
        metrics: {
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 10,
          totalCacheReadTokens: 0,
          totalCacheWriteTokens: 0,
          totalReasoningTokens: 0,
        },
      },
    );
  });
});
