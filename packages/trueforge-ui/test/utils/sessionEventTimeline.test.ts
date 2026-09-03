import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import type { SessionEventItem } from '@/server/types.js';
import { buildSessionMetrics } from '@/utils/buildSessionMetrics.js';
import { buildSessionTimelineSegments } from '@/utils/buildSessionTimelineSegments.js';
import type { SessionEventTimelineSegment } from '@/utils/sessionEventTimeline.js';
import {
  buildTimelineAxisTicks,
  compressInterTurnGaps,
  getActiveTimelineMs,
  getSubAgentLanes,
  groupOverlappingToolCalls,
  pickLongestNonOverlappingSegments,
} from '@/utils/sessionEventTimelineChart.js';
import { buildSessionTurnViews } from '@/utils/sessionTurnViews.js';

function created({
  turnId,
  createdAt,
  content = 'hello',
}: {
  turnId: string;
  createdAt: string;
  content?: string;
}): SessionEventItem {
  return {
    turnId,
    event: {
      type: 'turn.created',
      id: `${turnId}-created`,
      turnId,
      previousTurnId: null,
      input: [{ type: 'user.message', content }],
      state: { status: 'running' },
      createdAt,
      threadId: null,
    },
  };
}

function done({
  turnId,
  createdAt,
  status = 'done',
}: {
  turnId: string;
  createdAt: string;
  status?: 'done' | 'error';
}): SessionEventItem {
  return {
    turnId,
    event: {
      type: 'turn.done',
      id: `${turnId}-done`,
      state:
        status === 'error'
          ? { status: 'error', message: 'failed', completedAt: createdAt }
          : { status: 'done', completedAt: createdAt, output: null, requiredActions: [] },
      createdAt,
      threadId: null,
    },
  };
}

describe('buildSessionTimelineSegments', () => {
  it('compresses idle time between turns and keeps per-turn duration', () => {
    const turns = buildSessionTurnViews([
      created({ turnId: 't1', createdAt: '2026-01-01T00:00:00.000Z' }),
      done({ turnId: 't1', createdAt: '2026-01-01T00:01:00.000Z' }),
      created({ turnId: 't2', createdAt: '2026-01-01T00:10:00.000Z', content: 'next' }),
      done({ turnId: 't2', createdAt: '2026-01-01T00:11:00.000Z' }),
    ]);
    const segments = buildSessionTimelineSegments(turns);
    const users = segments.filter(segment => segment.type === 'user');
    assert.equal(users[0]?.startMs, 0);
    assert.equal(users[1]?.startMs, 60_000);
    const systems = segments.filter(segment => segment.title === 'turn.done');
    assert.equal(systems[0]?.endMs, 60_000);
    assert.equal(systems[1]?.endMs, 120_000);
  });

  it('builds nested sub-agent and overlapping tool-call segments', () => {
    const turns = buildSessionTurnViews([
      created({ turnId: 't1', createdAt: '2026-01-01T00:00:00.000Z' }),
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'model-1',
          threadId: 'main',
          content: 'calling tools',
          createdAt: '2026-01-01T00:00:01.000Z',
          toolCalls: [
            { id: 'call-a', type: 'function', function: { name: 'search', arguments: '{}' } },
            { id: 'call-b', type: 'function', function: { name: 'lookup', arguments: '{}' } },
            { id: 'call-sub', type: 'function', function: { name: 'create_sub_agent', arguments: '{}' } },
          ],
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'thread.created',
          id: 'thread-1',
          threadId: 'child',
          title: 'Researcher',
          createdAt: '2026-01-01T00:00:01.100Z',
          agentInfo: { type: 'dynamic', name: 'researcher', input: 'research' },
          parent: { threadId: 'main', toolCallId: 'call-sub' },
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.response',
          id: 'resp-a',
          threadId: 'main',
          toolCallId: 'call-a',
          content: 'a',
          createdAt: '2026-01-01T00:00:03.000Z',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.response',
          id: 'resp-b',
          threadId: 'main',
          toolCallId: 'call-b',
          content: 'b',
          createdAt: '2026-01-01T00:00:02.500Z',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'thread.done',
          id: 'thread-done',
          threadId: 'child',
          title: 'Researcher',
          createdAt: '2026-01-01T00:00:04.000Z',
          state: { status: 'completed' },
        },
      },
      done({ turnId: 't1', createdAt: '2026-01-01T00:00:05.000Z' }),
    ]);

    const segments = buildSessionTimelineSegments(turns);
    assert.equal(
      segments.some(segment => segment.type === 'sub_agent' && segment.description === 'Researcher'),
      true,
    );
    assert.equal(
      segments.some(segment => segment.id.endsWith('call-sub')),
      false,
    );
    const toolCalls = segments.filter(segment => segment.type === 'tool_call');
    assert.equal(toolCalls.length, 2);
    const groups = groupOverlappingToolCalls(toolCalls).filter(group => group.segments.length > 1);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.segments.length, 2);
  });
});

describe('sessionEventTimelineChart helpers', () => {
  const bars = (items: Array<[number, number, number]>): SessionEventTimelineSegment[] =>
    items.map(([startMs, endMs, turnIndex], index) => ({
      id: `s${index}`,
      type: 'tool_call',
      title: 'tool.call',
      description: `s${index}`,
      startMs,
      endMs,
      turnIndex,
      threadId: 'main',
    }));

  it('picks the longest non-overlapping sub-agent bars', () => {
    const selected = pickLongestNonOverlappingSegments(
      bars([
        [0, 10, 0],
        [2, 4, 0],
        [12, 20, 0],
      ]),
    );
    assert.deepEqual(
      selected.map(segment => segment.id),
      ['s0', 's2'],
    );
  });

  it('assigns non-overlapping sub-agent lanes', () => {
    const lanes = getSubAgentLanes({
      subAgentSegments: [
        {
          id: 'a',
          type: 'sub_agent',
          title: 'thread.created',
          description: 'A',
          startMs: 0,
          endMs: 10,
          turnIndex: 0,
          threadId: 'a',
        },
        {
          id: 'b',
          type: 'sub_agent',
          title: 'thread.created',
          description: 'B',
          startMs: 2,
          endMs: 8,
          turnIndex: 0,
          threadId: 'b',
        },
        {
          id: 'c',
          type: 'sub_agent',
          title: 'thread.created',
          description: 'C',
          startMs: 10,
          endMs: 12,
          turnIndex: 0,
          threadId: 'c',
        },
      ],
      threadSegments: [],
      minWidthMs: 1,
    });
    assert.equal(lanes.find(lane => lane.threadId === 'a')?.lane, 0);
    assert.equal(lanes.find(lane => lane.threadId === 'b')?.lane, 1);
    assert.equal(lanes.find(lane => lane.threadId === 'c')?.lane, 0);
  });

  it('subtracts visual turn-gap bands from axis labels', () => {
    assert.equal(getActiveTimelineMs(150, [{ startMs: 100, endMs: 120 }]), 130);
  });

  it('keeps the session end time as the last labeled tick', () => {
    assert.deepEqual(
      buildTimelineAxisTicks({
        ticks: [{ value: 0 }, { value: 4000 }, { value: 8000 }, { value: 9000 }],
        totalMs: 7900,
        timelineMaxMs: 9000,
      }),
      [{ value: 0 }, { value: 4000 }, { value: 7900 }, { value: 9000 }],
    );
  });

  it('compresses inter-turn gaps onto a contiguous axis', () => {
    const compressed = compressInterTurnGaps([
      {
        id: 'u1',
        type: 'user',
        title: 'user.message',
        description: '',
        startMs: 0,
        endMs: 0,
        turnIndex: 0,
        threadId: 'main',
        isMarker: true,
      },
      {
        id: 'd1',
        type: 'system',
        title: 'turn.done',
        description: '',
        startMs: 50,
        endMs: 50,
        turnIndex: 0,
        threadId: 'main',
        isMarker: true,
      },
      {
        id: 'u2',
        type: 'user',
        title: 'user.message',
        description: '',
        startMs: 500,
        endMs: 500,
        turnIndex: 1,
        threadId: 'main',
        isMarker: true,
      },
    ]);
    assert.equal(compressed.find(segment => segment.id === 'u2')?.startMs, 50);
  });
});

describe('buildSessionMetrics', () => {
  it('derives tiles from terminal turn metrics and timeline segments', () => {
    const turns = buildSessionTurnViews([
      created({ turnId: 't1', createdAt: '2026-01-01T00:00:00.000Z' }),
      {
        turnId: 't1',
        event: {
          type: 'turn.done',
          id: 't1-done',
          state: {
            status: 'done',
            completedAt: '2026-01-01T00:00:02.000Z',
            output: null,
            requiredActions: [],
            ...{
              metrics: {
                totalTokens: 80,
                totalCostInUsd: 0.5,
                totalInputTokens: 50,
                totalOutputTokens: 30,
                totalCacheReadTokens: 0,
                totalCacheWriteTokens: 0,
                totalReasoningTokens: 0,
              },
            },
          },
          createdAt: '2026-01-01T00:00:02.000Z',
          threadId: null,
        },
      },
    ]);
    const segments = buildSessionTimelineSegments(turns);
    const metrics = buildSessionMetrics({ turns, segments });
    assert.equal(metrics.totalTurns, 1);
    assert.equal(metrics.wallTimeMs, 2_000);
    assert.equal(metrics.totalCostUsd, 0.5);
    assert.equal(metrics.totalTokens, 80);
    assert.equal(metrics.tokenBreakdown.find(item => item.label === 'input')?.value, 50);
    assert.equal(metrics.errors, 0);
  });
});
