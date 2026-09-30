import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  toUiSessionEvent,
  toUiStreamingEvent,
  toUiTurnDoneMetrics,
  toUiTurnState,
} from '@/plugins/trueforge-agent-server-adapter/toUiTurnState.js';

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

  it('preserves paused turn state and lifecycle updates', () => {
    const paused = {
      status: 'paused' as const,
      actionRequiredOnEvents: [{ id: 'approval-required-1' }],
    };
    assert.deepEqual(toUiTurnState(paused), paused);
    assert.deepEqual(
      toUiStreamingEvent({
        type: 'turn.update',
        id: 'update-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        threadId: null,
        state: paused,
      }),
      {
        type: 'turn.update',
        id: 'update-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        threadId: null,
        state: paused,
      },
    );
  });

  it('forwards persisted approval-policy and MCP continuation events', () => {
    assert.deepEqual(
      toUiSessionEvent({
        type: 'user.tool_approval_policy',
        id: 'policy-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        policies: [{ serverName: 'github', name: 'create_issue', action: { type: 'allow_session' } }],
      }),
      {
        type: 'user.tool_approval_policy',
        id: 'policy-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        policies: [{ serverName: 'github', name: 'create_issue', action: { type: 'allow_session' } }],
      },
    );
    assert.deepEqual(
      toUiSessionEvent({
        type: 'user.mcp_auth_continue',
        id: 'mcp-continue-1',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
      {
        type: 'user.mcp_auth_continue',
        id: 'mcp-continue-1',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    );
  });
});
