import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import type { SessionEventItem } from '@/server/types.js';
import { buildSessionMetrics } from '@/utils/buildSessionMetrics.js';
import { buildSessionTimelineSegments, sessionHasOpenPause } from '@/utils/buildSessionTimelineSegments.js';
import {
  formatTimelineDuration,
  getSessionEventColor,
  segmentsForTurnTooltip,
  type SessionEventTimelineSegment,
} from '@/utils/sessionEventTimeline.js';
import {
  applyPauseChipLayout,
  buildTimelineAxisTicks,
  buildTimelineGaps,
  compressInterTurnGaps,
  compressIntraTurnPauses,
  formatTimelineAxisDuration,
  getActiveTimelineMs,
  getSubAgentHoverGroups,
  getSubAgentLanes,
  getWallTimelineMs,
  groupCoincidentTimelineMarkers,
  groupOverlappingToolCalls,
  mergeOverlappingSubAgentSegments,
  packTimelineMarkers,
} from '@/utils/sessionEventTimelineChart.js';
import { buildSessionTurnViews } from '@/utils/sessionTurnViews.js';

describe('session event colors', () => {
  it('uses dark overrides when present and otherwise falls back to the base color', () => {
    assert.equal(getSessionEventColor('model'), '#3b82f6');
    assert.equal(getSessionEventColor('model', true), '#6366f1');
    assert.equal(getSessionEventColor('sub_agent', true), '#3f3f46');
    assert.equal(getSessionEventColor('tool_call', true), '#f59e0b');
  });
});

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
  reason,
}: {
  turnId: string;
  createdAt: string;
  status?: 'done' | 'error' | 'cancelled';
  reason?: string;
}): SessionEventItem {
  return {
    turnId,
    event: {
      type: 'turn.done',
      id: `${turnId}-done`,
      state:
        status === 'error'
          ? { status: 'error', message: 'failed', completedAt: createdAt }
          : status === 'cancelled'
            ? {
                status: 'cancelled',
                reason: reason ?? 'client-cancelled',
                completedAt: createdAt,
              }
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
      segments.some(segment => segment.type === 'tool_call' && segment.description === 'search'),
      true,
    );
    assert.equal(
      segments.some(segment => segment.type === 'tool_call' && segment.description === 'lookup'),
      true,
    );
    assert.equal(
      segments.some(segment => segment.id.endsWith('call-sub')),
      false,
    );
    assert.deepEqual(
      segments
        .filter(segment => segment.type === 'system' && segment.title === 'system.waiting_for_sub_agent')
        .map(({ description, startMs, endMs, threadId }) => ({ description, startMs, endMs, threadId })),
      [
        {
          description: 'System waiting for sub-agent to start executing',
          startMs: 1_000,
          endMs: 1_100,
          threadId: 'main',
        },
      ],
    );
    const toolCalls = segments.filter(segment => segment.type === 'tool_call');
    assert.equal(toolCalls.length, 2);
    const groups = groupOverlappingToolCalls(toolCalls).filter(group => group.segments.length > 1);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.segments.length, 2);
  });

  it('excludes sub-agent thread tool calls from strip Tool calls', () => {
    const turns = buildSessionTurnViews([
      created({ turnId: 't1', createdAt: '2026-01-01T00:00:00.000Z' }),
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'model-main',
          threadId: 'main',
          content: 'root',
          createdAt: '2026-01-01T00:00:01.000Z',
          toolCalls: [
            { id: 'call-main', type: 'function', function: { name: 'search', arguments: '{}' } },
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
          type: 'model.message',
          id: 'model-child',
          threadId: 'child',
          content: 'child work',
          createdAt: '2026-01-01T00:00:02.000Z',
          toolCalls: [
            { id: 'call-child-a', type: 'function', function: { name: 'child_search', arguments: '{}' } },
            { id: 'call-child-b', type: 'function', function: { name: 'child_fetch', arguments: '{}' } },
          ],
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.response',
          id: 'resp-main',
          threadId: 'main',
          toolCallId: 'call-main',
          content: 'ok',
          createdAt: '2026-01-01T00:00:03.000Z',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.response',
          id: 'resp-child-a',
          threadId: 'child',
          toolCallId: 'call-child-a',
          content: 'a',
          createdAt: '2026-01-01T00:00:03.500Z',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.response',
          id: 'resp-child-b',
          threadId: 'child',
          toolCallId: 'call-child-b',
          content: 'b',
          createdAt: '2026-01-01T00:00:04.000Z',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'thread.done',
          id: 'thread-done',
          threadId: 'child',
          title: 'Researcher',
          createdAt: '2026-01-01T00:00:04.500Z',
          state: { status: 'completed' },
        },
      },
      done({ turnId: 't1', createdAt: '2026-01-01T00:00:05.000Z' }),
    ]);

    const segments = buildSessionTimelineSegments(turns);
    assert.equal(segments.filter(segment => segment.type === 'tool_call').length, 3);
    assert.equal(buildSessionMetrics({ turns, segments }).toolCalls, 1);
    assert.equal(buildSessionMetrics({ turns, segments }).subAgents, 1);
  });

  it('counts pending ask-user tool calls waiting on tool.response_required', () => {
    const turns = buildSessionTurnViews([
      created({ turnId: 't1', createdAt: '2026-01-01T00:00:00.000Z' }),
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'model-1',
          threadId: 'main',
          content: '',
          createdAt: '2026-01-01T00:00:01.000Z',
          toolCalls: [
            {
              id: 'call-ask',
              type: 'function',
              function: { name: 'ask_user_question', arguments: '{"question":"clarify?"}' },
            },
          ],
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.response_required',
          id: 'required-1',
          threadId: 'main',
          createdAt: '2026-01-01T00:00:01.100Z',
          toolCalls: [{ id: 'call-ask', sourceEventId: 'model-1' }],
        },
      },
      done({ turnId: 't1', createdAt: '2026-01-01T00:00:01.200Z' }),
    ]);

    const segments = buildSessionTimelineSegments(turns);
    const toolCalls = segments.filter(segment => segment.type === 'tool_call');
    assert.equal(toolCalls.length, 1);
    assert.equal(toolCalls[0]?.description, 'ask_user_question');
    assert.equal(toolCalls[0]?.startMs, 1_000);
    assert.equal(toolCalls[0]?.endMs, 1_100);
    assert.equal(buildSessionMetrics({ turns, segments }).toolCalls, 1);
  });

  it('labels deferred MCP meta-tool bars with the underlying tool name', () => {
    const turns = buildSessionTurnViews([
      created({ turnId: 't1', createdAt: '2026-01-01T00:00:00.000Z' }),
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'model-1',
          threadId: 'main',
          content: 'calling deferred tool',
          createdAt: '2026-01-01T00:00:01.000Z',
          toolCalls: [
            {
              id: 'call-deferred',
              type: 'function',
              function: {
                name: 'call_tool',
                arguments: JSON.stringify({
                  mcp_server: 'github',
                  tool_name: 'search_issues',
                  input: { q: 'bug' },
                }),
              },
            },
          ],
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.response',
          id: 'resp-deferred',
          threadId: 'main',
          toolCallId: 'call-deferred',
          content: 'ok',
          createdAt: '2026-01-01T00:00:02.000Z',
        },
      },
      done({ turnId: 't1', createdAt: '2026-01-01T00:00:03.000Z' }),
    ]);

    const segments = buildSessionTimelineSegments(turns);
    assert.equal(
      segments.some(
        segment => segment.type === 'tool_call' && segment.description === 'call_tool: search_issues (github)',
      ),
      true,
    );
  });

  it('waits only for the first sub-agent in a concurrent batch', () => {
    const subAgentEvents: SessionEventItem[] = [
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'model-sub-agents',
          threadId: 'main',
          content: '',
          createdAt: '2026-01-01T00:00:00.005Z',
          toolCalls: ['a', 'b', 'c'].map(id => ({
            id: `call-${id}`,
            type: 'function',
            function: { name: 'create_sub_agent', arguments: '{}' },
          })),
        },
      },
      ...['a', 'b', 'c'].map((id, index): SessionEventItem => ({
        turnId: 't1',
        event: {
          type: 'thread.created',
          id: `thread-${id}`,
          threadId: `child-${id}`,
          title: `Agent ${id}`,
          createdAt: `2026-01-01T00:00:00.0${10 + index * 5}Z`,
          agentInfo: { type: 'dynamic', name: `agent-${id}`, input: id },
          parent: { threadId: 'main', toolCallId: `call-${id}` },
        },
      })),
      ...['a', 'b', 'c'].map((id, index): SessionEventItem => ({
        turnId: 't1',
        event: {
          type: 'thread.done',
          id: `thread-${id}-done`,
          threadId: `child-${id}`,
          title: `Agent ${id}`,
          createdAt: `2026-01-01T00:00:00.0${40 + index * 10}Z`,
          state: { status: 'completed' },
        },
      })),
    ];
    const turns = buildSessionTurnViews([
      created({ turnId: 't1', createdAt: '2026-01-01T00:00:00.000Z' }),
      ...subAgentEvents,
      done({ turnId: 't1', createdAt: '2026-01-01T00:00:00.070Z' }),
    ]);

    const segments = buildSessionTimelineSegments(turns);
    assert.deepEqual(
      segments
        .filter(segment => segment.title === 'system.waiting_for_sub_agent')
        .map(segment => [segment.startMs, segment.endMs]),
      [[5, 10]],
    );
    assert.deepEqual(
      mergeOverlappingSubAgentSegments(segments.filter(segment => segment.type === 'sub_agent')).map(segment => [
        segment.startMs,
        segment.endMs,
      ]),
      [[10, 60]],
    );
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
  const marker = (
    id: string,
    type: SessionEventTimelineSegment['type'],
    startMs: number,
  ): SessionEventTimelineSegment => ({
    id,
    type,
    title: id,
    description: id,
    startMs,
    endMs: startMs,
    turnIndex: 0,
    threadId: 'main',
    isMarker: true,
  });

  it('merges overlapping sub-agent bars from the first start through the last end', () => {
    const selected = mergeOverlappingSubAgentSegments(
      bars([
        [10, 40, 0],
        [15, 50, 0],
        [20, 60, 0],
      ]),
    );
    assert.deepEqual(
      selected.map(segment => ({ id: segment.id, startMs: segment.startMs, endMs: segment.endMs })),
      [{ id: 's0', startMs: 10, endMs: 60 }],
    );
  });

  it('fills gaps between same-turn sub-agent bars into one continuous track', () => {
    const selected = mergeOverlappingSubAgentSegments(
      bars([
        [0, 10, 0],
        [40, 50, 0],
        [100, 120, 1],
      ]),
    );
    assert.deepEqual(
      selected.map(segment => ({
        id: segment.id,
        startMs: segment.startMs,
        endMs: segment.endMs,
        turnIndex: segment.turnIndex,
      })),
      [
        { id: 's0', startMs: 0, endMs: 50, turnIndex: 0 },
        { id: 's2', startMs: 100, endMs: 120, turnIndex: 1 },
      ],
    );
  });

  it('scopes each sub-agent tooltip to its merged visible bar', () => {
    const subAgents = bars([
      [0, 10, 0],
      [9, 11, 0],
      [10.5, 20, 0],
    ]).map((segment, index): SessionEventTimelineSegment => ({
      ...segment,
      type: 'sub_agent',
      threadId: `child-${index}`,
    }));
    const visibleBars = mergeOverlappingSubAgentSegments(subAgents);
    const groups = getSubAgentHoverGroups({
      bars: visibleBars,
      subAgentSegments: subAgents,
    });

    assert.deepEqual(
      visibleBars.map(segment => segment.id),
      ['s0'],
    );
    assert.deepEqual(
      groups.map(group => ({
        barId: group.barId,
        startMs: group.startMs,
        endMs: group.endMs,
        segments: group.segments.map(segment => segment.id),
      })),
      [{ barId: 's0', startMs: 0, endMs: 20, segments: ['s0', 's1', 's2'] }],
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

  it('groups coincident point events into one marker', () => {
    assert.deepEqual(
      groupCoincidentTimelineMarkers([
        marker('user', 'user', 10),
        marker('system', 'system', 10),
        marker('error', 'error', 20),
        ...bars([[10, 30, 0]]),
      ]).map(group => ({
        startMs: group.startMs,
        ids: group.segments.map(segment => segment.id),
      })),
      [
        { startMs: 10, ids: ['user', 'system'] },
        { startMs: 20, ids: ['error'] },
      ],
    );
  });

  it('groups near-coincident markers within tolerance into one tooltip target', () => {
    assert.deepEqual(
      groupCoincidentTimelineMarkers(
        [marker('auth', 'waiting_on_human', 10), marker('done', 'system', 14), marker('later', 'user', 40)],
        { toleranceMs: 5 },
      ).map(group => ({
        startMs: group.startMs,
        ids: group.segments.map(segment => segment.id),
      })),
      [
        { startMs: 10, ids: ['auth', 'done'] },
        { startMs: 40, ids: ['later'] },
      ],
    );
  });

  it('does not merge coincident markers across different threads', () => {
    const a = { ...marker('ar-a', 'approval', 100), threadId: 'sub-a' };
    const b = { ...marker('ar-b', 'approval', 100), threadId: 'sub-b' };
    const c = { ...marker('ar-c', 'approval', 102), threadId: 'sub-c' };
    const groups = groupCoincidentTimelineMarkers([a, b, c], { toleranceMs: 5 });
    assert.deepEqual(
      groups.map(group => ({
        threadId: group.segments[0]?.threadId,
        ids: group.segments.map(segment => segment.id),
      })),
      [
        { threadId: 'sub-a', ids: ['ar-a'] },
        { threadId: 'sub-b', ids: ['ar-b'] },
        { threadId: 'sub-c', ids: ['ar-c'] },
      ],
    );
  });

  it('packs each thread’s pause markers onto that thread’s chip only', () => {
    const aReq = { ...marker('ar-a', 'approval', 100), threadId: 'sub-a', pauseOffsetMs: 0 };
    const bReq = { ...marker('ar-b', 'approval', 100), threadId: 'sub-b', pauseOffsetMs: 0 };
    const aOk = { ...marker('ua-a', 'approval', 100), threadId: 'sub-a', pauseOffsetMs: 900 };
    const packed = packTimelineMarkers({
      groups: groupCoincidentTimelineMarkers([aReq, bReq, aOk], { toleranceMs: 5 }),
      pauseChips: [
        { startMs: 100, endMs: 200, wallDurationMs: 1_000, threadId: 'sub-a' },
        { startMs: 100, endMs: 200, wallDurationMs: 1_000, threadId: 'sub-b' },
      ],
    });
    const onA = packed.filter(item => item.segments.every(segment => segment.threadId === 'sub-a'));
    const onB = packed.filter(item => item.segments.every(segment => segment.threadId === 'sub-b'));
    assert.equal(onA.length, 2);
    assert.equal(onB.length, 1);
    assert.equal(onA[0]?.x, 100);
    assert.equal(onA[1]?.x, 190);
    assert.equal(onB[0]?.x, 100);
  });

  it('maps clean active-time ticks around fixed turn separators', () => {
    const gaps = [{ startMs: 42_000, endMs: 43_000 }];
    const ticks = buildTimelineAxisTicks({
      activeTotalMs: 96_000,
      turnStartsMs: [0, 42_000],
      turnGapMs: 1_000,
    });
    assert.deepEqual(
      ticks.map(tick => getActiveTimelineMs(tick.value, gaps)),
      [0, 15_000, 30_000, 45_000, 60_000, 75_000, 90_000, 96_000],
    );
    assert.deepEqual(
      ticks.map(tick => formatTimelineAxisDuration(getActiveTimelineMs(tick.value, gaps))),
      ['0ms', '15s', '30s', '45s', '1m', '1.25m', '1.5m', '1.6m'],
    );
    assert.equal(formatTimelineAxisDuration(813_292), '13.55m');
  });

  it('changes axis units at one second, one minute, and one hour', () => {
    assert.deepEqual([999, 1_000, 60_000, 3_600_000].map(formatTimelineAxisDuration), ['999ms', '1s', '1m', '1h']);
  });

  it('drops a regular tick that would overlap the exact endpoint', () => {
    assert.deepEqual(
      buildTimelineAxisTicks({
        activeTotalMs: 121_000,
        turnStartsMs: [0],
        turnGapMs: 0,
      }).map(tick => tick.value),
      [0, 30_000, 60_000, 90_000, 121_000],
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

  it('collapses pause wall time and preserves wallDurationMs', () => {
    const compressed = compressIntraTurnPauses([
      {
        id: 'pause',
        type: 'waiting_on_human',
        title: 'turn.paused',
        description: 'Paused',
        startMs: 10_000,
        endMs: 10_000 + 2 * 86_400_000,
        turnIndex: 0,
        threadId: 'main',
        isPauseChip: true,
        wallDurationMs: 2 * 86_400_000,
      },
      {
        id: 'approval',
        type: 'approval',
        title: 'tool.approval_required',
        description: 'Approval required',
        startMs: 10_000,
        endMs: 10_000,
        turnIndex: 0,
        threadId: 'main',
        isMarker: true,
      },
      {
        id: 'later',
        type: 'model',
        title: 'model.message',
        description: 'done',
        startMs: 10_000 + 2 * 86_400_000 + 5_000,
        endMs: 10_000 + 2 * 86_400_000 + 8_000,
        turnIndex: 0,
        threadId: 'main',
      },
    ]);
    const pause = compressed.find(segment => segment.id === 'pause');
    assert.equal(pause?.startMs, 10_000);
    assert.equal(pause?.endMs, 10_000);
    assert.equal(pause?.wallDurationMs, 2 * 86_400_000);
    assert.equal(compressed.find(segment => segment.id === 'approval')?.startMs, 10_000);
    assert.equal(compressed.find(segment => segment.id === 'later')?.startMs, 15_000);
    assert.equal(compressed.find(segment => segment.id === 'later')?.endMs, 18_000);
  });

  it('maps active-time ticks around pause chips and labels them with wall time', () => {
    const visualGaps = [
      { atActiveMs: 30_000, gapMs: 2_000, containsAnchor: true as const, wallDurationMs: 120_000 },
      { atActiveMs: 42_000, gapMs: 1_000 },
    ];
    const gaps = buildTimelineGaps(visualGaps);
    const ticks = buildTimelineAxisTicks({ activeTotalMs: 50_000, visualGaps });
    assert.deepEqual(
      ticks.map(tick => getActiveTimelineMs(tick.value, gaps)),
      [0, 10_000, 20_000, 30_000, 40_000, 50_000],
    );
    assert.deepEqual(
      ticks.map(tick => getWallTimelineMs({ valueMs: tick.value, visualGaps })),
      [0, 10_000, 20_000, 30_000, 160_000, 170_000],
    );
    const tickAtPause = ticks.find(tick => getActiveTimelineMs(tick.value, gaps) === 30_000);
    assert.equal(tickAtPause?.value, 30_000);
    const tickAfterPause = ticks.find(tick => getActiveTimelineMs(tick.value, gaps) === 40_000);
    assert.equal(tickAfterPause?.value, 42_000);
    assert.equal(getWallTimelineMs({ valueMs: 31_000, visualGaps }), 30_000 + 60_000);
  });

  it('packs pause-chip markers by wall offset without +N overflow', () => {
    const wallDurationMs = 1_000;
    const segments = Array.from({ length: 6 }, (_, index) => ({
      ...marker(`m${index}`, index % 2 === 0 ? 'approval' : 'user', 100),
      pauseOffsetMs: index * 100,
    }));
    const groups = groupCoincidentTimelineMarkers(segments);
    const packed = packTimelineMarkers({
      groups,
      pauseChips: [{ startMs: 100, endMs: 100 + 1_000, wallDurationMs }],
    });
    assert.equal(packed.length, 6);
    assert.equal(packed[0]?.x, 100);
    assert.ok((packed[1]?.x ?? 0) > (packed[0]?.x ?? 0));
    assert.ok((packed.at(-1)?.x ?? 0) <= 1_100);
  });

  it('places a single pause marker at its occurrence ratio on the chip', () => {
    const segment = { ...marker('mid', 'approval', 50), pauseOffsetMs: 500 };
    const packed = packTimelineMarkers({
      groups: groupCoincidentTimelineMarkers([segment]),
      pauseChips: [{ startMs: 50, endMs: 150, wallDurationMs: 1_000 }],
    });
    assert.equal(packed.length, 1);
    assert.equal(packed[0]?.x, 100);
  });

  it('packs markers onto a chip when the group starts slightly before the chip', () => {
    const early = { ...marker('early', 'approval', 48), pauseOffsetMs: 0 };
    const late = { ...marker('late', 'approval', 48), pauseOffsetMs: 900 };
    const packed = packTimelineMarkers({
      groups: groupCoincidentTimelineMarkers([early, late], { toleranceMs: 5 }),
      pauseChips: [{ startMs: 50, endMs: 150, wallDurationMs: 1_000 }],
    });
    assert.equal(packed.length, 2);
    assert.equal(packed[0]?.x, 50);
    assert.equal(packed[1]?.x, 140);
  });

  it('pins approval diamonds to the wait span edges', () => {
    const required = {
      ...marker('ar-b', 'approval', 40),
      title: 'tool.approval_required',
      threadId: 'sub-b',
      pauseSpanId: 'ar-b-wait-span-sub-b',
      pauseSpanEdge: 'start' as const,
      pauseOffsetMs: 0,
    };
    const approved = {
      ...marker('ua-b', 'approval', 40),
      title: 'user.tool_approval',
      threadId: 'sub-b',
      pauseSpanId: 'ar-b-wait-span-sub-b',
      pauseSpanEdge: 'end' as const,
      pauseOffsetMs: 6_000,
    };
    const packed = packTimelineMarkers({
      groups: groupCoincidentTimelineMarkers([required, approved], { toleranceMs: 5 }),
      pauseChips: [
        {
          id: 'ar-b-wait-span-sub-b',
          startMs: 10,
          endMs: 400,
          wallDurationMs: 17_000,
          threadId: 'sub-b',
        },
      ],
    });
    const byId = new Map(packed.map(item => [item.segments[0]?.id, item.x]));
    assert.equal(byId.get('ar-b'), 10);
    assert.equal(byId.get('ua-b'), 400);
  });

  it('does not pull distant pre-chip markers onto the hatch', () => {
    const distant = marker('distant', 'system', 0);
    const packed = packTimelineMarkers({
      groups: groupCoincidentTimelineMarkers([distant]),
      pauseChips: [{ startMs: 200, endMs: 1_200, wallDurationMs: 60_000 }],
    });
    assert.equal(packed.length, 1);
    assert.equal(packed[0]?.x, 0);
  });

  it('splits spanning bars so the pause hatch slot stays exclusive', () => {
    const laidOut = applyPauseChipLayout({
      pauseChipMs: 1_000,
      segments: [
        {
          id: 'pause',
          type: 'waiting_on_human',
          title: 'turn.paused',
          description: '',
          startMs: 50,
          endMs: 50,
          turnIndex: 0,
          threadId: 'main',
          isPauseChip: true,
          wallDurationMs: 120_000,
        },
        {
          id: 'span',
          type: 'tool_call',
          title: 'tool.call',
          description: 'long tool',
          startMs: 0,
          endMs: 100,
          turnIndex: 0,
          threadId: 'main',
        },
        {
          id: 'after',
          type: 'model',
          title: 'model.message',
          description: '',
          startMs: 50,
          endMs: 80,
          turnIndex: 0,
          threadId: 'main',
        },
      ],
    });
    assert.deepEqual(
      laidOut.map(segment => ({ id: segment.id, startMs: segment.startMs, endMs: segment.endMs })),
      [
        { id: 'pause', startMs: 50, endMs: 1_050 },
        // Pre ends at chip start; post starts after hatch — no draw-through.
        { id: 'span@pre:50', startMs: 0, endMs: 50 },
        { id: 'span@post:50', startMs: 1_050, endMs: 1_100 },
        { id: 'after', startMs: 1_050, endMs: 1_080 },
      ],
    );
  });

  it('lets a wait span cover a compression chip instead of starting after a gap', () => {
    const laidOut = applyPauseChipLayout({
      pauseChipMs: 1_000,
      segments: [
        {
          id: 'chip',
          type: 'waiting_on_human',
          title: 'turn.paused',
          description: '',
          startMs: 50,
          endMs: 50,
          turnIndex: 0,
          threadId: 'sub-b',
          isPauseChip: true,
          isCompressionOnly: true,
          wallDurationMs: 7_000,
        },
        {
          id: 'wait',
          type: 'waiting_on_human',
          title: 'thread.paused',
          description: '',
          startMs: 50,
          endMs: 200,
          turnIndex: 0,
          threadId: 'sub-b',
          isPauseSpan: true,
          wallDurationMs: 12_000,
        },
      ],
    });
    const span = laidOut.find(segment => segment.id === 'wait');
    assert.ok(span != null);
    // Starts on the chip, ends past it — the 32px slot is hatch, not a hole.
    assert.equal(span.startMs, 50);
    assert.equal(span.endMs, 1_200);
  });

  it('expands pause chips in chart space and shifts later bars', () => {
    const laidOut = applyPauseChipLayout({
      pauseChipMs: 1_000,
      segments: [
        {
          id: 'pause',
          type: 'waiting_on_human',
          title: 'turn.paused',
          description: '',
          startMs: 50,
          endMs: 50,
          turnIndex: 0,
          threadId: 'main',
          isPauseChip: true,
          wallDurationMs: 86_400_000,
        },
        {
          id: 'mark',
          type: 'user',
          title: 'user.tool_approval',
          description: 'Approved',
          startMs: 50,
          endMs: 50,
          turnIndex: 0,
          threadId: 'main',
          isMarker: true,
        },
        {
          id: 'model',
          type: 'model',
          title: 'model.message',
          description: '',
          startMs: 50,
          endMs: 80,
          turnIndex: 0,
          threadId: 'main',
        },
      ],
    });
    assert.deepEqual(
      laidOut.map(segment => ({ id: segment.id, startMs: segment.startMs, endMs: segment.endMs })),
      [
        { id: 'pause', startMs: 50, endMs: 1_050 },
        { id: 'mark', startMs: 50, endMs: 50 },
        { id: 'model', startMs: 1_050, endMs: 1_080 },
      ],
    );
  });
});

describe('pause chips in buildSessionTimelineSegments', () => {
  it('emits a collapsed pause chip with approval and policy markers', () => {
    const turns = buildSessionTurnViews([
      created({ turnId: 't1', createdAt: '2026-01-01T00:00:00.000Z' }),
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm1',
          content: 'calling',
          toolCalls: [
            {
              id: 'call-1',
              type: 'function',
              function: {
                name: 'call_tool',
                arguments: JSON.stringify({ mcp_server: 'linear', tool_name: 'save_comment', input: {} }),
              },
            },
          ],
          createdAt: '2026-01-01T00:00:05.000Z',
          threadId: 'main',
          finishReason: 'tool_calls',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.approval_required',
          id: 'ar1',
          createdAt: '2026-01-01T00:00:06.000Z',
          threadId: 'main',
          toolCalls: [{ id: 'call-1', sourceEventId: 'm1' }],
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-paused',
          state: { status: 'paused' },
          createdAt: '2026-01-01T00:00:06.000Z',
          threadId: null,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'user.tool_approval',
          id: 'ua1',
          threadId: 'main',
          toolCallId: 'call-1',
          approval: { status: 'allow' },
          createdAt: '2026-01-01T00:02:06.000Z',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'user.tool_approval_policy',
          id: 'up1',
          policies: [
            {
              serverName: 'linear',
              name: 'save_comment',
              policy: { type: 'allow_session', expireAt: '2026-01-01T00:12:06.000Z' },
            },
          ],
          createdAt: '2026-01-01T00:02:06.000Z',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-running',
          state: { status: 'running' },
          createdAt: '2026-01-01T00:02:06.100Z',
          threadId: null,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.response',
          id: 'tr1',
          toolCallId: 'call-1',
          content: '{"ok":true}',
          createdAt: '2026-01-01T00:02:07.000Z',
          threadId: 'main',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm2',
          content: 'Added comment',
          createdAt: '2026-01-01T00:02:08.000Z',
          threadId: 'main',
          finishReason: 'stop',
        },
      },
      done({ turnId: 't1', createdAt: '2026-01-01T00:02:09.000Z' }),
    ]);

    const segments = buildSessionTimelineSegments(turns);
    const pause = segments.find(segment => segment.isPauseChip);
    assert.ok(pause);
    assert.equal(pause?.startMs, pause?.endMs);
    assert.equal(pause?.wallDurationMs, 120_100);
    assert.equal(formatTimelineDuration(pause?.wallDurationMs ?? 0), '2m');

    const approval = segments.find(segment => segment.title === 'tool.approval_required');
    const userApproval = segments.find(segment => segment.title === 'user.tool_approval');
    const policy = segments.find(segment => segment.title === 'user.tool_approval_policy');
    assert.equal(approval?.type, 'approval');
    assert.equal(userApproval?.type, 'approval');
    assert.equal(approval?.startMs, pause?.startMs);
    assert.equal(userApproval?.startMs, pause?.startMs);
    assert.equal(approval?.pauseOffsetMs, 0);
    assert.equal(userApproval?.pauseOffsetMs, 120_000);
    assert.equal(policy?.pauseOffsetMs, 120_000);
    assert.equal(userApproval?.description, 'linear/save_comment · approved');
    assert.equal(policy?.startMs, pause?.startMs);
    assert.equal(policy?.description, 'linear/save_comment · allow_session · 10m');
    assert.equal(approval?.description, 'linear/save_comment');

    const postApprovalTool = segments.find(segment => segment.type === 'tool_call' && segment.id.includes('call-1'));
    assert.ok(postApprovalTool);
    assert.equal(postApprovalTool?.startMs, pause?.startMs);
    assert.ok((postApprovalTool?.endMs ?? 0) > (postApprovalTool?.startMs ?? 0));

    const laterModel = segments.find(segment => segment.id === 'm2');
    assert.ok((laterModel?.startMs ?? 0) < 10_000);

    const metrics = buildSessionMetrics({ turns, segments });
    const waiting = metrics.timeBreakdown.find(entry => entry.label === 'waiting on human');
    assert.equal(waiting?.value, 120_100);
  });

  it('skips a sub-second pause chip when there is no human action', () => {
    const turns = buildSessionTurnViews([
      created({ turnId: 't1', createdAt: '2026-01-01T00:00:00.000Z' }),
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-paused',
          state: { status: 'paused' },
          createdAt: '2026-01-01T00:00:01.000Z',
          threadId: null,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-running',
          state: { status: 'running' },
          createdAt: '2026-01-01T00:00:01.400Z',
          threadId: null,
        },
      },
      done({ turnId: 't1', createdAt: '2026-01-01T00:00:02.000Z' }),
    ]);
    const segments = buildSessionTimelineSegments(turns);
    assert.equal(segments.filter(segment => segment.isPauseChip).length, 0);
  });

  it('attributes a pause chip to the sub-agent thread that required approval', () => {
    const subThread = 'sub-thread-1';
    const turns = buildSessionTurnViews([
      created({ turnId: 't1', createdAt: '2026-01-01T00:00:00.000Z' }),
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm-main',
          content: '',
          toolCalls: [
            {
              id: 'call-sub',
              type: 'function',
              function: { name: 'create_sub_agent', arguments: '{"name":"worker"}' },
            },
          ],
          createdAt: '2026-01-01T00:00:01.000Z',
          threadId: 'main',
          finishReason: 'tool_calls',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'thread.created',
          id: 'tc1',
          title: 'worker',
          createdAt: '2026-01-01T00:00:02.000Z',
          threadId: subThread,
          agentInfo: { type: 'dynamic', name: 'worker', input: 'worker' },
          parent: { threadId: 'main', toolCallId: 'call-sub' },
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm-sub',
          content: '',
          toolCalls: [
            {
              id: 'call-1',
              type: 'function',
              function: {
                name: 'call_tool',
                arguments: JSON.stringify({ mcp_server: 'linear', tool_name: 'delete_comment', input: {} }),
              },
            },
          ],
          createdAt: '2026-01-01T00:00:03.000Z',
          threadId: subThread,
          finishReason: 'tool_calls',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.approval_required',
          id: 'ar1',
          createdAt: '2026-01-01T00:00:03.001Z',
          threadId: subThread,
          toolCalls: [{ id: 'call-1', sourceEventId: 'm-sub' }],
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-paused',
          state: { status: 'paused' },
          createdAt: '2026-01-01T00:00:03.002Z',
          threadId: null,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'user.tool_approval',
          id: 'ua1',
          toolCallId: 'call-1',
          approval: { status: 'allow' },
          createdAt: '2026-01-01T00:00:10.000Z',
          threadId: subThread,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-running',
          state: { status: 'running' },
          createdAt: '2026-01-01T00:00:10.100Z',
          threadId: null,
        },
      },
    ]);
    const segments = buildSessionTimelineSegments(turns);
    const pause = segments.find(segment => segment.isPauseChip);
    assert.equal(pause?.threadId, subThread);
    const approval = segments.find(segment => segment.id === 'ar1');
    assert.equal(approval?.threadId, subThread);
  });

  it('emits one pause chip per sub-agent thread in a shared pause window', () => {
    const subA = 'sub-a';
    const subB = 'sub-b';
    const turns = buildSessionTurnViews([
      created({ turnId: 't1', createdAt: '2026-01-01T00:00:00.000Z' }),
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm-main',
          content: '',
          toolCalls: [
            {
              id: 'call-a',
              type: 'function',
              function: { name: 'create_sub_agent', arguments: '{"name":"a"}' },
            },
            {
              id: 'call-b',
              type: 'function',
              function: { name: 'create_sub_agent', arguments: '{"name":"b"}' },
            },
          ],
          createdAt: '2026-01-01T00:00:01.000Z',
          threadId: 'main',
          finishReason: 'tool_calls',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'thread.created',
          id: 'tc-a',
          title: 'a',
          createdAt: '2026-01-01T00:00:02.000Z',
          threadId: subA,
          agentInfo: { type: 'dynamic', name: 'a', input: 'a' },
          parent: { threadId: 'main', toolCallId: 'call-a' },
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'thread.created',
          id: 'tc-b',
          title: 'b',
          createdAt: '2026-01-01T00:00:02.000Z',
          threadId: subB,
          agentInfo: { type: 'dynamic', name: 'b', input: 'b' },
          parent: { threadId: 'main', toolCallId: 'call-b' },
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.approval_required',
          id: 'ar-a',
          createdAt: '2026-01-01T00:00:03.000Z',
          threadId: subA,
          toolCalls: [{ id: 'call-tool-a', sourceEventId: 'm-a' }],
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.approval_required',
          id: 'ar-b',
          createdAt: '2026-01-01T00:00:03.001Z',
          threadId: subB,
          toolCalls: [{ id: 'call-tool-b', sourceEventId: 'm-b' }],
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-paused',
          state: { status: 'paused' },
          createdAt: '2026-01-01T00:00:03.002Z',
          threadId: null,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'user.tool_approval',
          id: 'ua-a',
          toolCallId: 'call-tool-a',
          approval: { status: 'allow' },
          createdAt: '2026-01-01T00:00:10.000Z',
          threadId: subA,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-running',
          state: { status: 'running' },
          createdAt: '2026-01-01T00:00:10.100Z',
          threadId: null,
        },
      },
    ]);
    const pauses = buildSessionTimelineSegments(turns).filter(segment => segment.isPauseChip);
    assert.deepEqual(pauses.map(segment => segment.threadId).sort(), [subA, subB].sort());
  });

  it('keeps pause hatch when sub-agent resumes and works after the pause', () => {
    const subA = 'sub-post-pause-work';
    const turns = buildSessionTurnViews([
      created({ turnId: 't1', createdAt: '2026-01-01T00:00:00.000Z' }),
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm-main',
          content: '',
          toolCalls: [
            {
              id: 'call-a',
              type: 'function',
              function: { name: 'create_sub_agent', arguments: '{"name":"a"}' },
            },
          ],
          createdAt: '2026-01-01T00:00:01.000Z',
          threadId: 'main',
          finishReason: 'tool_calls',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'thread.created',
          id: 'tc-a',
          title: 'a',
          createdAt: '2026-01-01T00:00:02.000Z',
          threadId: subA,
          agentInfo: { type: 'dynamic', name: 'a', input: 'a' },
          parent: { threadId: 'main', toolCallId: 'call-a' },
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm-sub',
          content: '',
          toolCalls: [
            {
              id: 'call-tool-a',
              type: 'function',
              function: {
                name: 'call_tool',
                arguments: JSON.stringify({ mcp_server: 'linear', tool_name: 'save_comment', input: {} }),
              },
            },
          ],
          createdAt: '2026-01-01T00:00:03.000Z',
          threadId: subA,
          finishReason: 'tool_calls',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.approval_required',
          id: 'ar-a',
          createdAt: '2026-01-01T00:00:03.001Z',
          threadId: subA,
          toolCalls: [{ id: 'call-tool-a', sourceEventId: 'm-sub' }],
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-paused',
          state: { status: 'paused' },
          createdAt: '2026-01-01T00:00:03.002Z',
          threadId: null,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'user.tool_approval',
          id: 'ua-a',
          toolCallId: 'call-tool-a',
          approval: { status: 'allow' },
          createdAt: '2026-01-01T00:00:10.000Z',
          threadId: subA,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-running',
          state: { status: 'running' },
          createdAt: '2026-01-01T00:00:10.100Z',
          threadId: null,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.response',
          id: 'tr-a',
          toolCallId: 'call-tool-a',
          content: '{"ok":true}',
          createdAt: '2026-01-01T00:00:10.200Z',
          threadId: subA,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'thread.done',
          id: 'td-a',
          title: 'a',
          createdAt: '2026-01-01T00:00:10.300Z',
          threadId: subA,
          state: { status: 'completed' },
        },
      },
    ]);
    const segments = buildSessionTimelineSegments(turns);
    // Chip is compression-only; painted hatch is the per-thread wait span.
    const chip = segments.find(segment => segment.isPauseChip && segment.threadId === subA);
    assert.ok(chip != null);
    assert.equal(chip.isCompressionOnly, true);
    const span = segments.find(segment => segment.isPauseSpan && segment.threadId === subA);
    assert.ok(span != null);
    // Completed after resume — hatch stays (they were paused, then worked).
    assert.equal(span.isCompressionOnly, undefined);
  });

  it('hides pause hatch when sub-agent completes during the pause (no resume work)', () => {
    const subA = 'sub-done-during-pause';
    const turns = buildSessionTurnViews([
      created({ turnId: 't1', createdAt: '2026-01-01T00:00:00.000Z' }),
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm-main',
          content: '',
          toolCalls: [
            {
              id: 'call-a',
              type: 'function',
              function: { name: 'create_sub_agent', arguments: '{"name":"a"}' },
            },
          ],
          createdAt: '2026-01-01T00:00:01.000Z',
          threadId: 'main',
          finishReason: 'tool_calls',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'thread.created',
          id: 'tc-a',
          title: 'a',
          createdAt: '2026-01-01T00:00:02.000Z',
          threadId: subA,
          agentInfo: { type: 'dynamic', name: 'a', input: 'a' },
          parent: { threadId: 'main', toolCallId: 'call-a' },
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.approval_required',
          id: 'ar-a',
          createdAt: '2026-01-01T00:00:03.000Z',
          threadId: subA,
          toolCalls: [{ id: 'call-tool-a', sourceEventId: 'm-a' }],
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-paused',
          state: { status: 'paused' },
          createdAt: '2026-01-01T00:00:03.002Z',
          threadId: null,
        },
      },
      // Completes while turn is still paused (cancelled / abandoned wait).
      {
        turnId: 't1',
        event: {
          type: 'thread.done',
          id: 'td-a',
          title: 'a',
          createdAt: '2026-01-01T00:00:05.000Z',
          threadId: subA,
          state: { status: 'completed' },
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.done',
          id: 'td-turn',
          state: {
            status: 'cancelled',
            reason: 'cancelled-for-next-turn',
            completedAt: '2026-01-01T00:00:20.000Z',
          },
          createdAt: '2026-01-01T00:00:20.000Z',
          threadId: null,
        },
      },
    ]);
    const pause = buildSessionTimelineSegments(turns).find(segment => segment.isPauseChip && segment.threadId === subA);
    assert.ok(pause != null);
    assert.equal(pause.isCompressionOnly, true);
  });

  it('hides terminal pause span when sub-agent completes with no later work', () => {
    const subA = 'sub-span-terminal';
    const subB = 'sub-span-sibling';
    const turns = buildSessionTurnViews([
      created({ turnId: 't1', createdAt: '2026-01-01T00:00:00.000Z' }),
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm-main',
          content: '',
          toolCalls: [
            {
              id: 'call-a',
              type: 'function',
              function: { name: 'create_sub_agent', arguments: '{"name":"a"}' },
            },
            {
              id: 'call-b',
              type: 'function',
              function: { name: 'create_sub_agent', arguments: '{"name":"b"}' },
            },
          ],
          createdAt: '2026-01-01T00:00:01.000Z',
          threadId: 'main',
          finishReason: 'tool_calls',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'thread.created',
          id: 'tc-a',
          title: 'a',
          createdAt: '2026-01-01T00:00:02.000Z',
          threadId: subA,
          agentInfo: { type: 'dynamic', name: 'a', input: 'a' },
          parent: { threadId: 'main', toolCallId: 'call-a' },
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'thread.created',
          id: 'tc-b',
          title: 'b',
          createdAt: '2026-01-01T00:00:02.100Z',
          threadId: subB,
          agentInfo: { type: 'dynamic', name: 'b', input: 'b' },
          parent: { threadId: 'main', toolCallId: 'call-b' },
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.approval_required',
          id: 'ar-a',
          createdAt: '2026-01-01T00:00:03.000Z',
          threadId: subA,
          toolCalls: [{ id: 'call-tool-a', sourceEventId: 'm-a' }],
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.approval_required',
          id: 'ar-b',
          createdAt: '2026-01-01T00:00:03.100Z',
          threadId: subB,
          toolCalls: [{ id: 'call-tool-b', sourceEventId: 'm-b' }],
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-paused',
          state: { status: 'paused' },
          createdAt: '2026-01-01T00:00:03.200Z',
          threadId: null,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'user.tool_approval',
          id: 'ua-b',
          toolCallId: 'call-tool-b',
          approval: { status: 'allow' },
          createdAt: '2026-01-01T00:00:10.000Z',
          threadId: subB,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-running',
          state: { status: 'running' },
          createdAt: '2026-01-01T00:00:10.100Z',
          threadId: null,
        },
      },
      // subA never approved — completes while sibling runs (stranded wait → span).
      {
        turnId: 't1',
        event: {
          type: 'thread.done',
          id: 'td-a',
          title: 'a',
          createdAt: '2026-01-01T00:00:15.000Z',
          threadId: subA,
          state: { status: 'completed' },
        },
      },
    ]);
    const span = buildSessionTimelineSegments(turns).find(segment => segment.isPauseSpan && segment.threadId === subA);
    assert.ok(span != null);
    assert.equal(span.isCompressionOnly, true);
  });

  it('splits model activity around a pause so bars do not occupy the hatch interval', () => {
    const subThread = 'sub-split-pause';
    const turns = buildSessionTurnViews([
      created({ turnId: 't1', createdAt: '2026-01-01T00:00:00.000Z' }),
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm-main',
          content: '',
          toolCalls: [
            {
              id: 'call-sub',
              type: 'function',
              function: { name: 'create_sub_agent', arguments: '{"name":"worker"}' },
            },
          ],
          createdAt: '2026-01-01T00:00:01.000Z',
          threadId: 'main',
          finishReason: 'tool_calls',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'thread.created',
          id: 'tc-1',
          title: 'worker',
          createdAt: '2026-01-01T00:00:02.000Z',
          threadId: subThread,
          agentInfo: { type: 'dynamic', name: 'worker', input: 'worker' },
          parent: { threadId: 'main', toolCallId: 'call-sub' },
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm-before',
          content: 'thinking',
          toolCalls: [],
          createdAt: '2026-01-01T00:00:03.000Z',
          threadId: subThread,
          finishReason: 'stop',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.approval_required',
          id: 'ar-1',
          createdAt: '2026-01-01T00:00:03.500Z',
          threadId: subThread,
          toolCalls: [{ id: 'call-x', sourceEventId: 'm-before' }],
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-paused',
          state: { status: 'paused' },
          createdAt: '2026-01-01T00:00:03.502Z',
          threadId: null,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'user.tool_approval',
          id: 'ua-1',
          toolCallId: 'call-x',
          approval: { status: 'allow' },
          createdAt: '2026-01-01T00:00:10.000Z',
          threadId: subThread,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-running',
          state: { status: 'running' },
          createdAt: '2026-01-01T00:00:10.100Z',
          threadId: null,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm-after',
          content: 'done',
          toolCalls: [],
          createdAt: '2026-01-01T00:00:11.000Z',
          threadId: subThread,
          finishReason: 'stop',
        },
      },
    ]);
    const segments = buildSessionTimelineSegments(turns);
    const pause = segments.find(segment => segment.isPauseChip && segment.threadId === subThread);
    assert.ok(pause != null);
    const activity = segments.filter(
      segment =>
        segment.threadId === subThread &&
        !segment.isPauseChip &&
        !segment.isPauseSpan &&
        !segment.isMarker &&
        segment.type !== 'sub_agent',
    );
    for (const bar of activity) {
      const overlapsPause: boolean = bar.startMs < pause.endMs && bar.endMs > pause.startMs;
      assert.equal(overlapsPause, false, `${bar.id} overlaps pause`);
    }
    const laidOut = applyPauseChipLayout({ segments, pauseChipMs: 5_000 });
    const pauseLaid = laidOut.find(segment => segment.isPauseChip && segment.threadId === subThread);
    assert.ok(pauseLaid != null);
    const activityLaid = laidOut.filter(
      segment =>
        segment.threadId === subThread &&
        !segment.isPauseChip &&
        !segment.isPauseSpan &&
        !segment.isMarker &&
        segment.type !== 'sub_agent',
    );
    for (const bar of activityLaid) {
      const overlapsHatch: boolean = bar.startMs < pauseLaid.endMs && bar.endMs > pauseLaid.startMs;
      assert.equal(overlapsHatch, false, `${bar.id} overlaps hatch after layout`);
    }
  });

  it('abuts sub-agent activity to the pause chip (no gap before hatch)', () => {
    const subThread = 'sub-abut';
    const turns = buildSessionTurnViews([
      created({ turnId: 't1', createdAt: '2026-01-01T00:00:00.000Z' }),
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm-main',
          content: '',
          toolCalls: [
            {
              id: 'call-sub',
              type: 'function',
              function: { name: 'create_sub_agent', arguments: '{"name":"worker"}' },
            },
          ],
          createdAt: '2026-01-01T00:00:01.000Z',
          threadId: 'main',
          finishReason: 'tool_calls',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'thread.created',
          id: 'tc-1',
          title: 'worker',
          createdAt: '2026-01-01T00:00:02.000Z',
          threadId: subThread,
          agentInfo: { type: 'dynamic', name: 'worker', input: 'worker' },
          parent: { threadId: 'main', toolCallId: 'call-sub' },
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm-sub-prev',
          content: '',
          toolCalls: [
            {
              id: 'call-list',
              type: 'function',
              function: { name: 'list_tools', arguments: '{}' },
            },
          ],
          createdAt: '2026-01-01T00:00:03.000Z',
          threadId: subThread,
          finishReason: 'tool_calls',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.response',
          id: 'tr-list',
          toolCallId: 'call-list',
          content: 'ok',
          createdAt: '2026-01-01T00:00:04.000Z',
          threadId: subThread,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm-sub-approve',
          content: '',
          toolCalls: [
            {
              id: 'call-delete',
              type: 'function',
              function: {
                name: 'call_tool',
                arguments: JSON.stringify({ mcp_server: 'linear', tool_name: 'delete_comment', input: {} }),
              },
            },
          ],
          createdAt: '2026-01-01T00:00:05.000Z',
          threadId: subThread,
          finishReason: 'tool_calls',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.approval_required',
          id: 'ar-1',
          createdAt: '2026-01-01T00:00:05.500Z',
          threadId: subThread,
          toolCalls: [{ id: 'call-delete', sourceEventId: 'm-sub-approve' }],
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-paused',
          state: { status: 'paused' },
          createdAt: '2026-01-01T00:00:05.502Z',
          threadId: null,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'user.tool_approval',
          id: 'ua-1',
          toolCallId: 'call-delete',
          approval: { status: 'allow' },
          createdAt: '2026-01-01T00:00:12.000Z',
          threadId: subThread,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-running',
          state: { status: 'running' },
          createdAt: '2026-01-01T00:00:12.100Z',
          threadId: null,
        },
      },
    ]);
    const segments = buildSessionTimelineSegments(turns);
    // Painted hatch is the wait span (starts at approval_required); chip is layout-only.
    const span = segments.find(segment => segment.isPauseSpan && segment.threadId === subThread);
    const modelBar = segments.find(segment => segment.id === 'm-sub-approve');
    assert.ok(span != null);
    assert.ok(modelBar != null);
    assert.equal(modelBar.endMs, span.startMs);
    // After chip expansion the bar must still meet the hatch (no pixel gap).
    const laidOut = applyPauseChipLayout({ segments, pauseChipMs: 5_000 });
    const spanLaid = laidOut.find(segment => segment.isPauseSpan && segment.threadId === subThread);
    const modelLaid = laidOut.find(segment => segment.id === 'm-sub-approve');
    assert.ok(spanLaid != null);
    assert.ok(modelLaid != null);
    assert.equal(modelLaid.endMs, spanLaid.startMs);
  });

  it('fills hatch on a still-waiting sub-agent while the turn runs after a sibling approve', () => {
    const subA = 'sub-first';
    const subB = 'sub-stranded';
    const turns = buildSessionTurnViews([
      created({ turnId: 't1', createdAt: '2026-01-01T00:00:00.000Z' }),
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm-main',
          content: '',
          toolCalls: [
            {
              id: 'call-a',
              type: 'function',
              function: { name: 'create_sub_agent', arguments: '{"name":"a"}' },
            },
            {
              id: 'call-b',
              type: 'function',
              function: { name: 'create_sub_agent', arguments: '{"name":"b"}' },
            },
          ],
          createdAt: '2026-01-01T00:00:01.000Z',
          threadId: 'main',
          finishReason: 'tool_calls',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'thread.created',
          id: 'tc-a',
          title: 'a',
          createdAt: '2026-01-01T00:00:02.000Z',
          threadId: subA,
          agentInfo: { type: 'dynamic', name: 'a', input: 'a' },
          parent: { threadId: 'main', toolCallId: 'call-a' },
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'thread.created',
          id: 'tc-b',
          title: 'b',
          createdAt: '2026-01-01T00:00:02.000Z',
          threadId: subB,
          agentInfo: { type: 'dynamic', name: 'b', input: 'b' },
          parent: { threadId: 'main', toolCallId: 'call-b' },
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.approval_required',
          id: 'ar-a',
          createdAt: '2026-01-01T00:00:03.000Z',
          threadId: subA,
          toolCalls: [{ id: 'call-tool-a', sourceEventId: 'm-a' }],
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.approval_required',
          id: 'ar-b',
          createdAt: '2026-01-01T00:00:03.100Z',
          threadId: subB,
          toolCalls: [{ id: 'call-tool-b', sourceEventId: 'm-b' }],
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-paused-1',
          state: { status: 'paused' },
          createdAt: '2026-01-01T00:00:03.200Z',
          threadId: null,
        },
      },
      // Approve only subA — turn runs; subB still waiting.
      {
        turnId: 't1',
        event: {
          type: 'user.tool_approval',
          id: 'ua-a',
          toolCallId: 'call-tool-a',
          approval: { status: 'allow' },
          createdAt: '2026-01-01T00:00:10.000Z',
          threadId: subA,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-running-1',
          state: { status: 'running' },
          createdAt: '2026-01-01T00:00:10.100Z',
          threadId: null,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.response',
          id: 'tr-a',
          toolCallId: 'call-tool-a',
          content: '{"ok":true}',
          createdAt: '2026-01-01T00:00:15.000Z',
          threadId: subA,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'thread.done',
          id: 'td-a',
          title: 'a',
          createdAt: '2026-01-01T00:00:16.000Z',
          threadId: subA,
          state: { status: 'completed' },
        },
      },
      // Later pause for subB only.
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-paused-2',
          state: { status: 'paused' },
          createdAt: '2026-01-01T00:00:20.000Z',
          threadId: null,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'user.tool_approval',
          id: 'ua-b',
          toolCallId: 'call-tool-b',
          approval: { status: 'allow' },
          createdAt: '2026-01-01T00:00:25.000Z',
          threadId: subB,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-running-2',
          state: { status: 'running' },
          createdAt: '2026-01-01T00:00:25.100Z',
          threadId: null,
        },
      },
    ]);
    const segments = buildSessionTimelineSegments(turns);
    const spanB = segments.find(segment => segment.isPauseSpan && segment.threadId === subB);
    assert.ok(spanB != null);
    // Full approval wait (paused + running), not only turn-running slices.
    assert.ok(spanB.endMs > spanB.startMs);
    assert.ok((spanB.wallDurationMs ?? 0) >= 20_000);
    // Chip on B is layout-only; span paints the hatch.
    const chipB = segments.find(segment => segment.isPauseChip && segment.threadId === subB);
    assert.ok(chipB != null);
    assert.equal(chipB.isCompressionOnly, true);
    // A also gets a wait span for its own approval→approve window.
    assert.equal(segments.filter(segment => segment.isPauseSpan && segment.threadId === subA).length, 1);
  });

  it('starts each sub-agent pause hatch at that thread approval_required', () => {
    const subEarly = 'sub-early-approval';
    const subLate = 'sub-late-approval';
    const turns = buildSessionTurnViews([
      created({ turnId: 't1', createdAt: '2026-01-01T00:00:00.000Z' }),
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm-main',
          content: '',
          toolCalls: [
            {
              id: 'call-early',
              type: 'function',
              function: { name: 'create_sub_agent', arguments: '{"name":"early"}' },
            },
            {
              id: 'call-late',
              type: 'function',
              function: { name: 'create_sub_agent', arguments: '{"name":"late"}' },
            },
          ],
          createdAt: '2026-01-01T00:00:01.000Z',
          threadId: 'main',
          finishReason: 'tool_calls',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'thread.created',
          id: 'tc-early',
          title: 'early',
          createdAt: '2026-01-01T00:00:02.000Z',
          threadId: subEarly,
          agentInfo: { type: 'dynamic', name: 'early', input: 'early' },
          parent: { threadId: 'main', toolCallId: 'call-early' },
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'thread.created',
          id: 'tc-late',
          title: 'late',
          createdAt: '2026-01-01T00:00:02.000Z',
          threadId: subLate,
          agentInfo: { type: 'dynamic', name: 'late', input: 'late' },
          parent: { threadId: 'main', toolCallId: 'call-late' },
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm-early',
          content: 'early plan',
          toolCalls: [{ id: 'tool-early', type: 'function', function: { name: 'x', arguments: '{}' } }],
          createdAt: '2026-01-01T00:00:03.000Z',
          threadId: subEarly,
          finishReason: 'tool_calls',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.approval_required',
          id: 'ar-early',
          createdAt: '2026-01-01T00:00:03.100Z',
          threadId: subEarly,
          toolCalls: [{ id: 'tool-early', sourceEventId: 'm-early' }],
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm-late',
          content: 'late plan',
          toolCalls: [{ id: 'tool-late', type: 'function', function: { name: 'x', arguments: '{}' } }],
          createdAt: '2026-01-01T00:00:05.000Z',
          threadId: subLate,
          finishReason: 'tool_calls',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.approval_required',
          id: 'ar-late',
          createdAt: '2026-01-01T00:00:05.100Z',
          threadId: subLate,
          toolCalls: [{ id: 'tool-late', sourceEventId: 'm-late' }],
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-paused',
          state: { status: 'paused' },
          createdAt: '2026-01-01T00:00:05.200Z',
          threadId: null,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'user.tool_approval',
          id: 'ua-early',
          toolCallId: 'tool-early',
          approval: { status: 'allow' },
          createdAt: '2026-01-01T00:00:20.000Z',
          threadId: subEarly,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'user.tool_approval',
          id: 'ua-late',
          toolCallId: 'tool-late',
          approval: { status: 'allow' },
          createdAt: '2026-01-01T00:00:20.000Z',
          threadId: subLate,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-running',
          state: { status: 'running' },
          createdAt: '2026-01-01T00:00:20.100Z',
          threadId: null,
        },
      },
    ]);

    const segments = buildSessionTimelineSegments(turns);
    const spanEarly = segments.find(segment => segment.isPauseSpan && segment.threadId === subEarly);
    const spanLate = segments.find(segment => segment.isPauseSpan && segment.threadId === subLate);
    assert.ok(spanEarly != null);
    assert.ok(spanLate != null);
    // Late approval_required → hatch starts later; shorter wall wait.
    assert.ok(spanLate.startMs > spanEarly.startMs);
    assert.ok((spanLate.wallDurationMs ?? 0) < (spanEarly.wallDurationMs ?? 0));
    // Late agent keeps model time until its own approval (not clipped to the early one).
    const lateModel = segments.find(
      segment => segment.threadId === subLate && segment.type === 'model' && segment.description === 'late plan',
    );
    assert.ok(lateModel != null);
    assert.ok(lateModel.endMs >= spanLate.startMs - 1);
  });

  it('keeps one continuous wait span (no chip→gap→span hole) while a sibling runs', () => {
    const subA = 'sub-cont-a';
    const subB = 'sub-cont-b';
    const turns = buildSessionTurnViews([
      created({ turnId: 't1', createdAt: '2026-01-01T00:00:00.000Z' }),
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm-main',
          content: '',
          toolCalls: [
            {
              id: 'call-a',
              type: 'function',
              function: { name: 'create_sub_agent', arguments: '{"name":"a"}' },
            },
            {
              id: 'call-b',
              type: 'function',
              function: { name: 'create_sub_agent', arguments: '{"name":"b"}' },
            },
          ],
          createdAt: '2026-01-01T00:00:01.000Z',
          threadId: 'main',
          finishReason: 'tool_calls',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'thread.created',
          id: 'tc-a',
          title: 'a',
          createdAt: '2026-01-01T00:00:02.000Z',
          threadId: subA,
          agentInfo: { type: 'dynamic', name: 'a', input: 'a' },
          parent: { threadId: 'main', toolCallId: 'call-a' },
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'thread.created',
          id: 'tc-b',
          title: 'b',
          createdAt: '2026-01-01T00:00:02.000Z',
          threadId: subB,
          agentInfo: { type: 'dynamic', name: 'b', input: 'b' },
          parent: { threadId: 'main', toolCallId: 'call-b' },
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.approval_required',
          id: 'ar-a',
          createdAt: '2026-01-01T00:00:03.000Z',
          threadId: subA,
          toolCalls: [{ id: 'call-tool-a', sourceEventId: 'm-a' }],
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.approval_required',
          id: 'ar-b',
          createdAt: '2026-01-01T00:00:03.100Z',
          threadId: subB,
          toolCalls: [{ id: 'call-tool-b', sourceEventId: 'm-b' }],
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-paused-1',
          state: { status: 'paused' },
          createdAt: '2026-01-01T00:00:03.200Z',
          threadId: null,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'user.tool_approval',
          id: 'ua-a',
          toolCallId: 'call-tool-a',
          approval: { status: 'allow' },
          createdAt: '2026-01-01T00:00:10.000Z',
          threadId: subA,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-running-1',
          state: { status: 'running' },
          createdAt: '2026-01-01T00:00:10.100Z',
          threadId: null,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.response',
          id: 'tr-a',
          toolCallId: 'call-tool-a',
          content: '{"ok":true}',
          createdAt: '2026-01-01T00:00:15.000Z',
          threadId: subA,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'thread.done',
          id: 'td-a',
          title: 'a',
          createdAt: '2026-01-01T00:00:16.000Z',
          threadId: subA,
          state: { status: 'completed' },
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-paused-2',
          state: { status: 'paused' },
          createdAt: '2026-01-01T00:00:20.000Z',
          threadId: null,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'user.tool_approval',
          id: 'ua-b',
          toolCallId: 'call-tool-b',
          approval: { status: 'allow' },
          createdAt: '2026-01-01T00:00:25.000Z',
          threadId: subB,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-running-2',
          state: { status: 'running' },
          createdAt: '2026-01-01T00:00:25.100Z',
          threadId: null,
        },
      },
    ]);

    const segments = buildSessionTimelineSegments(turns);
    const spansB = segments.filter(segment => segment.isPauseSpan && segment.threadId === subB);
    // One continuous span for the whole wait — not separate paused/running pieces.
    assert.equal(spansB.length, 1);
    assert.equal(spansB[0]?.isCompressionOnly, undefined);
    assert.ok((spansB[0]?.wallDurationMs ?? 0) >= 20_000);
    const required = segments.find(segment => segment.id === 'ar-b');
    const approved = segments.find(segment => segment.id === 'ua-b');
    assert.equal(required?.pauseSpanEdge, 'start');
    assert.equal(approved?.pauseSpanEdge, 'end');
    assert.equal(required?.pauseSpanId, spansB[0]?.id);
    assert.equal(approved?.pauseSpanId, spansB[0]?.id);
  });

  it('closes sibling waits on a matching user.tool_approval_policy (allow_session)', () => {
    const subA = 'sub-policy-a';
    const subB = 'sub-policy-b';
    const saveComment = (id: string) => ({
      id,
      type: 'function' as const,
      function: {
        name: 'call_tool',
        arguments: JSON.stringify({ mcp_server: 'linear', tool_name: 'save_comment', input: {} }),
      },
    });
    const turns = buildSessionTurnViews([
      created({ turnId: 't1', createdAt: '2026-01-01T00:00:00.000Z' }),
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm-main',
          content: '',
          toolCalls: [
            {
              id: 'call-a',
              type: 'function',
              function: { name: 'create_sub_agent', arguments: '{"name":"a"}' },
            },
            {
              id: 'call-b',
              type: 'function',
              function: { name: 'create_sub_agent', arguments: '{"name":"b"}' },
            },
          ],
          createdAt: '2026-01-01T00:00:01.000Z',
          threadId: 'main',
          finishReason: 'tool_calls',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'thread.created',
          id: 'tc-a',
          title: 'a',
          createdAt: '2026-01-01T00:00:02.000Z',
          threadId: subA,
          agentInfo: { type: 'dynamic', name: 'a', input: 'a' },
          parent: { threadId: 'main', toolCallId: 'call-a' },
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'thread.created',
          id: 'tc-b',
          title: 'b',
          createdAt: '2026-01-01T00:00:02.000Z',
          threadId: subB,
          agentInfo: { type: 'dynamic', name: 'b', input: 'b' },
          parent: { threadId: 'main', toolCallId: 'call-b' },
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm-a',
          content: '',
          toolCalls: [saveComment('tool-a')],
          createdAt: '2026-01-01T00:00:03.000Z',
          threadId: subA,
          finishReason: 'tool_calls',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm-b',
          content: '',
          toolCalls: [saveComment('tool-b')],
          createdAt: '2026-01-01T00:00:03.050Z',
          threadId: subB,
          finishReason: 'tool_calls',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.approval_required',
          id: 'ar-a',
          createdAt: '2026-01-01T00:00:03.100Z',
          threadId: subA,
          toolCalls: [{ id: 'tool-a', sourceEventId: 'm-a' }],
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.approval_required',
          id: 'ar-b',
          createdAt: '2026-01-01T00:00:03.150Z',
          threadId: subB,
          toolCalls: [{ id: 'tool-b', sourceEventId: 'm-b' }],
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-paused',
          state: { status: 'paused' },
          createdAt: '2026-01-01T00:00:03.200Z',
          threadId: null,
        },
      },
      // A approved once; B is covered by the allow_session policy — no per-call approval for B.
      {
        turnId: 't1',
        event: {
          type: 'user.tool_approval',
          id: 'ua-a',
          toolCallId: 'tool-a',
          approval: { status: 'allow' },
          createdAt: '2026-01-01T00:00:10.000Z',
          threadId: subA,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'user.tool_approval_policy',
          id: 'policy',
          policies: [
            {
              serverName: 'linear',
              name: 'save_comment',
              policy: { type: 'allow_session', expireAt: '2026-01-01T00:10:10.000Z' },
            },
          ],
          createdAt: '2026-01-01T00:00:10.000Z',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-running',
          state: { status: 'running' },
          createdAt: '2026-01-01T00:00:10.100Z',
          threadId: null,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.response',
          id: 'tr-b',
          toolCallId: 'tool-b',
          content: '{"ok":true}',
          createdAt: '2026-01-01T00:00:12.000Z',
          threadId: subB,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm-b2',
          content: 'resumed b',
          toolCalls: [],
          createdAt: '2026-01-01T00:00:13.000Z',
          threadId: subB,
          finishReason: 'stop',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'thread.done',
          id: 'td-b',
          title: 'b',
          createdAt: '2026-01-01T00:00:14.000Z',
          threadId: subB,
          state: { status: 'completed' },
        },
      },
    ]);

    const segments = buildSessionTimelineSegments(turns);
    const spanB = segments.find(segment => segment.isPauseSpan && segment.threadId === subB);
    assert.ok(spanB != null);
    // Wait ends at the policy (≈6.85s), not at thread.done — and is painted.
    assert.equal(spanB.isCompressionOnly, undefined);
    assert.ok((spanB.wallDurationMs ?? 0) >= 6_000 && (spanB.wallDurationMs ?? 0) < 8_000);
    // B's approval-gated tool bar still starts at the resume, not at the original request.
    const toolB = segments.find(segment => segment.type === 'tool_call' && segment.threadId === subB);
    assert.ok(toolB != null);
    assert.ok(toolB.startMs >= spanB.endMs - 1);
  });

  it('does not stretch a waiting sibling model through later wait spans after a shared pause', () => {
    const subA = 'sub-no-stretch-a';
    const subB = 'sub-no-stretch-b';
    const turns = buildSessionTurnViews([
      created({ turnId: 't1', createdAt: '2026-01-01T00:00:00.000Z' }),
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm-main',
          content: '',
          toolCalls: [
            {
              id: 'call-a',
              type: 'function',
              function: { name: 'create_sub_agent', arguments: '{"name":"a"}' },
            },
            {
              id: 'call-b',
              type: 'function',
              function: { name: 'create_sub_agent', arguments: '{"name":"b"}' },
            },
          ],
          createdAt: '2026-01-01T00:00:01.000Z',
          threadId: 'main',
          finishReason: 'tool_calls',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'thread.created',
          id: 'tc-a',
          title: 'a',
          createdAt: '2026-01-01T00:00:02.000Z',
          threadId: subA,
          agentInfo: { type: 'dynamic', name: 'a', input: 'a' },
          parent: { threadId: 'main', toolCallId: 'call-a' },
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'thread.created',
          id: 'tc-b',
          title: 'b',
          createdAt: '2026-01-01T00:00:02.000Z',
          threadId: subB,
          agentInfo: { type: 'dynamic', name: 'b', input: 'b' },
          parent: { threadId: 'main', toolCallId: 'call-b' },
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm-a1',
          content: 'planning a',
          toolCalls: [{ id: 'tool-a', type: 'function', function: { name: 'x', arguments: '{}' } }],
          createdAt: '2026-01-01T00:00:03.000Z',
          threadId: subA,
          finishReason: 'tool_calls',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm-b1',
          content: 'planning b',
          toolCalls: [{ id: 'tool-b', type: 'function', function: { name: 'x', arguments: '{}' } }],
          createdAt: '2026-01-01T00:00:03.050Z',
          threadId: subB,
          finishReason: 'tool_calls',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.approval_required',
          id: 'ar-a',
          createdAt: '2026-01-01T00:00:03.100Z',
          threadId: subA,
          toolCalls: [{ id: 'tool-a', sourceEventId: 'm-a1' }],
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.approval_required',
          id: 'ar-b',
          createdAt: '2026-01-01T00:00:03.150Z',
          threadId: subB,
          toolCalls: [{ id: 'tool-b', sourceEventId: 'm-b1' }],
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-paused-1',
          state: { status: 'paused' },
          createdAt: '2026-01-01T00:00:03.200Z',
          threadId: null,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'user.tool_approval',
          id: 'ua-a',
          toolCallId: 'tool-a',
          approval: { status: 'allow' },
          createdAt: '2026-01-01T00:00:10.000Z',
          threadId: subA,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-running-1',
          state: { status: 'running' },
          createdAt: '2026-01-01T00:00:10.100Z',
          threadId: null,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.response',
          id: 'tr-a',
          toolCallId: 'tool-a',
          content: '{"ok":true}',
          createdAt: '2026-01-01T00:00:12.000Z',
          threadId: subA,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm-a2',
          content: 'resumed a',
          toolCalls: [],
          createdAt: '2026-01-01T00:00:13.000Z',
          threadId: subA,
          finishReason: 'stop',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'thread.done',
          id: 'td-a',
          title: 'a',
          createdAt: '2026-01-01T00:00:14.000Z',
          threadId: subA,
          state: { status: 'completed' },
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-paused-2',
          state: { status: 'paused' },
          createdAt: '2026-01-01T00:00:14.100Z',
          threadId: null,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'user.tool_approval',
          id: 'ua-b',
          toolCallId: 'tool-b',
          approval: { status: 'allow' },
          createdAt: '2026-01-01T00:00:20.000Z',
          threadId: subB,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-running-2',
          state: { status: 'running' },
          createdAt: '2026-01-01T00:00:20.100Z',
          threadId: null,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.response',
          id: 'tr-b',
          toolCallId: 'tool-b',
          content: '{"ok":true}',
          createdAt: '2026-01-01T00:00:22.000Z',
          threadId: subB,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm-b2',
          content: 'resumed b',
          toolCalls: [],
          createdAt: '2026-01-01T00:00:23.000Z',
          threadId: subB,
          finishReason: 'stop',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'thread.done',
          id: 'td-b',
          title: 'b',
          createdAt: '2026-01-01T00:00:24.000Z',
          threadId: subB,
          state: { status: 'completed' },
        },
      },
    ]);

    const segments = buildSessionTimelineSegments(turns);
    const bModels = segments.filter(segment => segment.threadId === subB && segment.type === 'model');
    assert.equal(bModels.length, 2);
    const prePause = bModels.find(segment => segment.description === 'planning b');
    const postResume = bModels.find(segment => segment.description === 'resumed b');
    assert.ok(prePause != null);
    assert.ok(postResume != null);
    const waitSpan = segments.find(segment => segment.isPauseSpan && segment.threadId === subB);
    assert.ok(waitSpan != null);
    // Pre-pause model must end at/before the shared chip — not through the wait span.
    assert.ok(prePause.endMs <= waitSpan.startMs + 1);
    assert.ok(prePause.endMs < postResume.startMs);
    // While A runs, B shows hatch (not a copy of A's model window).
    assert.equal(waitSpan.isCompressionOnly, undefined);
  });

  it('emits a sub-agent model bar for tool-only messages so the lane meets the pause chip', () => {
    const subThread = 'sub-tool-only';
    const turns = buildSessionTurnViews([
      created({ turnId: 't1', createdAt: '2026-01-01T00:00:00.000Z' }),
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm-main',
          content: '',
          toolCalls: [
            {
              id: 'call-sub',
              type: 'function',
              function: { name: 'create_sub_agent', arguments: '{"name":"worker"}' },
            },
          ],
          createdAt: '2026-01-01T00:00:01.000Z',
          threadId: 'main',
          finishReason: 'tool_calls',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'thread.created',
          id: 'tc-1',
          title: 'worker',
          createdAt: '2026-01-01T00:00:02.000Z',
          threadId: subThread,
          agentInfo: { type: 'dynamic', name: 'worker', input: 'worker' },
          parent: { threadId: 'main', toolCallId: 'call-sub' },
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm-sub-prev',
          content: '',
          toolCalls: [
            {
              id: 'call-list',
              type: 'function',
              function: { name: 'list_tools', arguments: '{}' },
            },
          ],
          createdAt: '2026-01-01T00:00:03.000Z',
          threadId: subThread,
          finishReason: 'tool_calls',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.response',
          id: 'tr-list',
          toolCallId: 'call-list',
          content: 'ok',
          createdAt: '2026-01-01T00:00:04.000Z',
          threadId: subThread,
        },
      },
      // Tool-only model message that triggers approval — previously skipped on sub-agents.
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm-sub-approve',
          content: '',
          toolCalls: [
            {
              id: 'call-delete',
              type: 'function',
              function: {
                name: 'call_tool',
                arguments: JSON.stringify({ mcp_server: 'linear', tool_name: 'delete_comment', input: {} }),
              },
            },
          ],
          createdAt: '2026-01-01T00:00:05.000Z',
          threadId: subThread,
          finishReason: 'tool_calls',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.approval_required',
          id: 'ar-1',
          createdAt: '2026-01-01T00:00:05.001Z',
          threadId: subThread,
          toolCalls: [{ id: 'call-delete', sourceEventId: 'm-sub-approve' }],
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-paused',
          state: { status: 'paused' },
          createdAt: '2026-01-01T00:00:05.002Z',
          threadId: null,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'user.tool_approval',
          id: 'ua-1',
          toolCallId: 'call-delete',
          approval: { status: 'allow' },
          createdAt: '2026-01-01T00:00:12.000Z',
          threadId: subThread,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-running',
          state: { status: 'running' },
          createdAt: '2026-01-01T00:00:12.100Z',
          threadId: null,
        },
      },
    ]);
    const segments = buildSessionTimelineSegments(turns);
    const pause = segments.find(segment => segment.isPauseChip && segment.threadId === subThread);
    const modelBar = segments.find(segment => segment.id === 'm-sub-approve');
    const prevTool = segments.find(segment => segment.id === 'm-sub-prev-call-list');
    assert.ok(pause != null);
    assert.ok(modelBar != null);
    assert.ok(prevTool != null);
    assert.equal(modelBar.type, 'model');
    assert.equal(modelBar.threadId, subThread);
    // Model covers previous tool → approval request (closes the old empty gap before hatch).
    assert.equal(modelBar.startMs, prevTool.endMs);
    assert.ok(pause.startMs - modelBar.endMs <= 50);
  });

  it('starts the pause chip at early approval_required before turn.update paused', () => {
    const subA = 'sub-early';
    const subB = 'sub-late';
    const turns = buildSessionTurnViews([
      created({ turnId: 't1', createdAt: '2026-01-01T00:00:00.000Z' }),
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm-main',
          content: '',
          toolCalls: [
            {
              id: 'call-a',
              type: 'function',
              function: { name: 'create_sub_agent', arguments: '{"name":"a"}' },
            },
            {
              id: 'call-b',
              type: 'function',
              function: { name: 'create_sub_agent', arguments: '{"name":"b"}' },
            },
          ],
          createdAt: '2026-01-01T00:00:01.000Z',
          threadId: 'main',
          finishReason: 'tool_calls',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'thread.created',
          id: 'tc-a',
          title: 'a',
          createdAt: '2026-01-01T00:00:02.000Z',
          threadId: subA,
          agentInfo: { type: 'dynamic', name: 'a', input: 'a' },
          parent: { threadId: 'main', toolCallId: 'call-a' },
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'thread.created',
          id: 'tc-b',
          title: 'b',
          createdAt: '2026-01-01T00:00:02.000Z',
          threadId: subB,
          agentInfo: { type: 'dynamic', name: 'b', input: 'b' },
          parent: { threadId: 'main', toolCallId: 'call-b' },
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.approval_required',
          id: 'ar-a',
          createdAt: '2026-01-01T00:00:05.000Z',
          threadId: subA,
          toolCalls: [{ id: 'call-tool-a', sourceEventId: 'm-a' }],
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.approval_required',
          id: 'ar-b',
          createdAt: '2026-01-01T00:00:12.000Z',
          threadId: subB,
          toolCalls: [{ id: 'call-tool-b', sourceEventId: 'm-b' }],
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-paused',
          state: { status: 'paused' },
          createdAt: '2026-01-01T00:00:12.050Z',
          threadId: null,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'user.tool_approval',
          id: 'ua-a',
          toolCallId: 'call-tool-a',
          approval: { status: 'allow' },
          createdAt: '2026-01-01T00:00:20.000Z',
          threadId: subA,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-running',
          state: { status: 'running' },
          createdAt: '2026-01-01T00:00:20.100Z',
          threadId: null,
        },
      },
    ]);
    const segments = buildSessionTimelineSegments(turns);
    const pauses = segments.filter(segment => segment.isPauseChip);
    assert.deepEqual(pauses.map(segment => segment.threadId).sort(), [subA, subB].sort());
    // Shared chip starts at turn.update paused; per-lane wait spans cover earlier approvals.
    const spanA = segments.find(segment => segment.isPauseSpan && segment.threadId === subA);
    const spanB = segments.find(segment => segment.isPauseSpan && segment.threadId === subB);
    assert.ok(spanA != null);
    assert.ok(spanB != null);
    // Early approval_required → hatch starts earlier than the later sibling.
    assert.ok(spanA.startMs < spanB.startMs);
    // Chip wall is the turn.pause window only (not pulled back to the earliest sub approval).
    assert.ok(pauses.every(pause => pause.wallDurationMs != null && pause.wallDurationMs < 10_000));
  });

  it('closes an open pause with injected nowMs', () => {
    const turns = buildSessionTurnViews([
      created({ turnId: 't1', createdAt: '2026-01-01T00:00:00.000Z' }),
      {
        turnId: 't1',
        event: {
          type: 'tool.approval_required',
          id: 'ar1',
          createdAt: '2026-01-01T00:00:01.000Z',
          threadId: 'main',
          toolCalls: [{ id: 'call-1', sourceEventId: 'm1' }],
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-paused',
          state: { status: 'paused' },
          createdAt: '2026-01-01T00:00:01.000Z',
          threadId: null,
        },
      },
    ]);
    assert.equal(sessionHasOpenPause(turns), true);
    const nowMs = Date.parse('2026-01-03T00:00:01.000Z');
    const segments = buildSessionTimelineSegments(turns, { nowMs });
    const pause = segments.find(segment => segment.isPauseChip);
    assert.equal(pause?.description, 'Paused');
    assert.equal(pause?.wallDurationMs, 2 * 86_400_000);
    assert.equal(formatTimelineDuration(pause?.wallDurationMs ?? 0), '2d');
    const later = buildSessionTimelineSegments(turns, { nowMs: nowMs + 60_000 });
    assert.equal(later.find(segment => segment.isPauseChip)?.wallDurationMs, 2 * 86_400_000 + 60_000);
  });

  it('sessionHasOpenPause is false after resume or turn.done', () => {
    const paused = buildSessionTurnViews([
      created({ turnId: 't1', createdAt: '2026-01-01T00:00:00.000Z' }),
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-paused',
          state: { status: 'paused' },
          createdAt: '2026-01-01T00:00:01.000Z',
          threadId: null,
        },
      },
    ]);
    assert.equal(sessionHasOpenPause(paused), true);
    const resumed = buildSessionTurnViews([
      created({ turnId: 't1', createdAt: '2026-01-01T00:00:00.000Z' }),
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-paused',
          state: { status: 'paused' },
          createdAt: '2026-01-01T00:00:01.000Z',
          threadId: null,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-running',
          state: { status: 'running' },
          createdAt: '2026-01-01T00:00:02.000Z',
          threadId: null,
        },
      },
    ]);
    assert.equal(sessionHasOpenPause(resumed), false);
  });

  it('sessionHasOpenPause stays true while a sibling sub-agent is still waiting', () => {
    const turns = buildSessionTurnViews([
      created({ turnId: 't1', createdAt: '2026-01-01T00:00:00.000Z' }),
      {
        turnId: 't1',
        event: {
          type: 'tool.approval_required',
          id: 'ar-b',
          createdAt: '2026-01-01T00:00:03.000Z',
          threadId: 'sub-b',
          toolCalls: [{ id: 'tool-b', sourceEventId: 'm-b' }],
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-paused',
          state: { status: 'paused' },
          createdAt: '2026-01-01T00:00:03.100Z',
          threadId: null,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'user.tool_approval',
          id: 'ua-a',
          toolCallId: 'tool-a',
          approval: { status: 'allow' },
          createdAt: '2026-01-01T00:00:10.000Z',
          threadId: 'sub-a',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-running',
          state: { status: 'running' },
          createdAt: '2026-01-01T00:00:10.100Z',
          threadId: null,
        },
      },
    ]);
    assert.equal(sessionHasOpenPause(turns), true);
    const early = buildSessionTimelineSegments(turns, { nowMs: Date.parse('2026-01-01T00:01:00.000Z') });
    const later = buildSessionTimelineSegments(turns, { nowMs: Date.parse('2026-01-01T00:02:00.000Z') });
    const earlySpan = early.find(segment => segment.isPauseSpan && segment.threadId === 'sub-b');
    const laterSpan = later.find(segment => segment.isPauseSpan && segment.threadId === 'sub-b');
    assert.ok(earlySpan != null && laterSpan != null);
    assert.ok((laterSpan.wallDurationMs ?? 0) > (earlySpan.wallDurationMs ?? 0));

    const waitingOf = (timeline: ReturnType<typeof buildSessionTimelineSegments>) =>
      buildSessionMetrics({ turns, segments: timeline }).timeBreakdown.find(item => item.label === 'waiting on human')
        ?.value;
    const earlyChip = early.find(segment => segment.isPauseChip);
    assert.ok((waitingOf(early) ?? 0) > (earlyChip?.wallDurationMs ?? 0));
    assert.equal(waitingOf(early), earlySpan.wallDurationMs);
    assert.ok((waitingOf(later) ?? 0) > (waitingOf(early) ?? 0));

    const pauseRows = segmentsForTurnTooltip(early).filter(segment => segment.isPauseChip || segment.isPauseSpan);
    assert.equal(pauseRows.length, 1);
    assert.equal(pauseRows[0]?.wallDurationMs, earlySpan.wallDurationMs);
  });

  it('anchors approval_required 1ms before paused and emits a post-pause tool bar without user.tool_approval', () => {
    const turns = buildSessionTurnViews([
      created({ turnId: 't1', createdAt: '2026-01-01T00:00:00.000Z' }),
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm1',
          content: '',
          toolCalls: [
            {
              id: 'call-1',
              type: 'function',
              function: {
                name: 'call_tool',
                arguments: JSON.stringify({ mcp_server: 'linear', tool_name: 'save_comment', input: {} }),
              },
            },
          ],
          createdAt: '2026-01-01T00:00:03.000Z',
          threadId: 'main',
          finishReason: 'tool_calls',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.approval_required',
          id: 'ar1',
          createdAt: '2026-01-01T00:00:03.001Z',
          threadId: 'main',
          toolCalls: [{ id: 'call-1', sourceEventId: 'm1' }],
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-paused',
          state: { status: 'paused' },
          createdAt: '2026-01-01T00:00:03.002Z',
          threadId: null,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'user.tool_approval_policy',
          id: 'up1',
          policies: [{ serverName: 'linear', name: 'save_comment', policy: { type: 'allow_session' } }],
          createdAt: '2026-01-01T00:00:06.000Z',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'tu-running',
          state: { status: 'running' },
          createdAt: '2026-01-01T00:00:06.010Z',
          threadId: null,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.response',
          id: 'tr1',
          toolCallId: 'call-1',
          content: '{"ok":true}',
          createdAt: '2026-01-01T00:00:07.500Z',
          threadId: 'main',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm2',
          content: 'Added comment',
          createdAt: '2026-01-01T00:00:08.000Z',
          threadId: 'main',
          finishReason: 'stop',
        },
      },
      done({ turnId: 't1', createdAt: '2026-01-01T00:00:08.100Z' }),
    ]);

    const segments = buildSessionTimelineSegments(turns);
    const pause = segments.find(segment => segment.isPauseChip);
    assert.ok(pause);
    assert.equal(pause?.description, 'Paused');

    const approvalRequired = segments.find(segment => segment.title === 'tool.approval_required');
    assert.equal(approvalRequired?.startMs, pause?.startMs);
    assert.equal(approvalRequired?.pauseOffsetMs, 0);

    const policy = segments.find(segment => segment.title === 'user.tool_approval_policy');
    assert.ok((policy?.pauseOffsetMs ?? 0) > 0);
    assert.equal(policy?.startMs, pause?.startMs);

    const postApprovalTool = segments.find(segment => segment.type === 'tool_call' && segment.id.includes('call-1'));
    assert.ok(postApprovalTool);
    assert.equal(postApprovalTool?.startMs, pause?.startMs);
    assert.ok((postApprovalTool?.endMs ?? 0) > (postApprovalTool?.startMs ?? 0));
  });
});

describe('buildSessionMetrics', () => {
  it('counts a shared sub-agent pause once', () => {
    const turns = buildSessionTurnViews([created({ turnId: 't1', createdAt: '2026-01-01T00:00:00.000Z' })]);
    const chip = {
      id: 'pause',
      type: 'waiting_on_human' as const,
      title: 'turn.paused',
      description: 'Paused',
      startMs: 1_000,
      endMs: 1_000,
      turnIndex: 0,
      threadId: 'sub-a',
      isPauseChip: true,
      wallDurationMs: 10_000,
    };
    const segments = [
      chip,
      { ...chip, id: 'pause-b', threadId: 'sub-b' },
      {
        ...chip,
        id: 'span-a',
        threadId: 'sub-a',
        isPauseChip: undefined,
        isPauseSpan: true,
        wallDurationMs: 10_000,
      },
      {
        ...chip,
        id: 'span-b',
        threadId: 'sub-b',
        isPauseChip: undefined,
        isPauseSpan: true,
        wallDurationMs: 10_000,
      },
    ];
    const metrics = buildSessionMetrics({ turns, segments });
    const waiting = metrics.timeBreakdown.find(item => item.label === 'waiting on human');
    assert.equal(waiting?.value, 10_000);
  });

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

  it('emits a cancelled marker with reason and does not count it as an error', () => {
    const turns = buildSessionTurnViews([
      created({ turnId: 't1', createdAt: '2026-01-01T00:00:00.000Z' }),
      done({
        turnId: 't1',
        createdAt: '2026-01-01T00:00:05.000Z',
        status: 'cancelled',
        reason: 'client-cancelled',
      }),
    ]);
    const segments = buildSessionTimelineSegments(turns);
    const cancelled = segments.find(segment => segment.title === 'turn.cancelled');
    assert.equal(cancelled?.type, 'system');
    assert.equal(cancelled?.description, 'client-cancelled');
    assert.equal(cancelled?.isMarker, true);
    const metrics = buildSessionMetrics({ turns, segments });
    assert.equal(metrics.errors, 0);
  });

  it('emits a thread.error marker for failed sub-agents and counts it in errors', () => {
    const turns = buildSessionTurnViews([
      created({ turnId: 't1', createdAt: '2026-01-01T00:00:00.000Z' }),
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'model-1',
          threadId: 'main',
          content: 'spawn',
          createdAt: '2026-01-01T00:00:01.000Z',
          toolCalls: [
            {
              id: 'call-sub',
              type: 'function',
              function: { name: 'create_sub_agent', arguments: '{}' },
            },
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
          type: 'thread.done',
          id: 'thread-done',
          threadId: 'child',
          title: 'Researcher',
          createdAt: '2026-01-01T00:00:04.000Z',
          state: { status: 'error', error: 'sub-agent blew up' },
        },
      },
      done({ turnId: 't1', createdAt: '2026-01-01T00:00:05.000Z' }),
    ]);

    const segments = buildSessionTimelineSegments(turns);
    const threadError = segments.find(segment => segment.title === 'thread.error');
    assert.equal(threadError?.type, 'error');
    assert.equal(threadError?.description, 'sub-agent blew up');
    assert.equal(threadError?.threadId, 'child');
    const metrics = buildSessionMetrics({ turns, segments });
    assert.equal(metrics.errors, 1);
  });

  it('closes unfinished sub-agent bars at turn.done when thread.done is missing', () => {
    const turns = buildSessionTurnViews([
      created({ turnId: 't1', createdAt: '2026-01-01T00:00:00.000Z' }),
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'model-1',
          threadId: 'main',
          content: 'spawn',
          createdAt: '2026-01-01T00:00:01.000Z',
          toolCalls: [
            {
              id: 'call-sub',
              type: 'function',
              function: { name: 'create_sub_agent', arguments: '{}' },
            },
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
          type: 'model.message',
          id: 'child-model',
          threadId: 'child',
          content: 'working',
          createdAt: '2026-01-01T00:00:02.000Z',
          toolCalls: [
            {
              id: 'call-exec',
              type: 'function',
              function: { name: 'exec', arguments: '{}' },
            },
          ],
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.response',
          id: 'tool-1',
          threadId: 'child',
          toolCallId: 'call-exec',
          content: 'ok',
          createdAt: '2026-01-01T00:00:04.000Z',
        },
      },
      done({
        turnId: 't1',
        createdAt: '2026-01-01T00:00:05.000Z',
        status: 'cancelled',
        reason: 'client-cancelled',
      }),
    ]);

    const segments = buildSessionTimelineSegments(turns);
    const subAgent = segments.find(segment => segment.type === 'sub_agent');
    assert.ok(subAgent);
    assert.equal(subAgent.isMarker, false);
    assert.equal(subAgent.startMs, 1_100);
    assert.equal(subAgent.endMs, 5_000);
    assert.ok(segments.some(segment => segment.threadId === 'child' && segment.type === 'tool_call'));
  });

  it('suppresses abort-shaped thread.error on cancelled turns and does not count it', () => {
    const turns = buildSessionTurnViews([
      created({ turnId: 't1', createdAt: '2026-01-01T00:00:00.000Z' }),
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'model-1',
          threadId: 'main',
          content: 'spawn',
          createdAt: '2026-01-01T00:00:01.000Z',
          toolCalls: [
            {
              id: 'call-sub',
              type: 'function',
              function: { name: 'create_sub_agent', arguments: '{}' },
            },
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
          type: 'thread.done',
          id: 'thread-done',
          threadId: 'child',
          title: 'Researcher',
          createdAt: '2026-01-01T00:00:04.000Z',
          state: { status: 'error', error: 'LLM stream aborted' },
        },
      },
      done({
        turnId: 't1',
        createdAt: '2026-01-01T00:00:05.000Z',
        status: 'cancelled',
        reason: 'client-cancelled',
      }),
    ]);

    const segments = buildSessionTimelineSegments(turns);
    assert.equal(
      segments.find(segment => segment.title === 'thread.error'),
      undefined,
    );
    const cancelled = segments.find(segment => segment.title === 'turn.cancelled');
    assert.equal(cancelled?.description, 'client-cancelled');
    const metrics = buildSessionMetrics({ turns, segments });
    assert.equal(metrics.errors, 0);
  });

  it('keeps aggregate cost undefined when no turn reports cost', () => {
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
            metrics: {
              totalTokens: 80,
              totalInputTokens: 50,
              totalOutputTokens: 30,
              totalCacheReadTokens: 0,
              totalCacheWriteTokens: 0,
              totalReasoningTokens: 0,
            },
          },
          createdAt: '2026-01-01T00:00:02.000Z',
          threadId: null,
        },
      },
    ]);

    const metrics = buildSessionMetrics({ turns, segments: buildSessionTimelineSegments(turns) });
    assert.equal(metrics.totalCostUsd, undefined);
  });

  it('uses sessionMetrics for duration and cost; turn count always from events', () => {
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
          createdAt: '2026-01-01T00:00:02.000Z',
          threadId: null,
        },
      },
    ]);
    const metrics = buildSessionMetrics({
      turns,
      segments: buildSessionTimelineSegments(turns),
      sessionMetrics: { totalDurationMs: 81_715, totalCostInUsd: 0.3106 },
    });
    assert.equal(metrics.totalTurns, 1);
    assert.equal(metrics.wallTimeMs, 81_715);
    assert.equal(metrics.totalCostUsd, 0.3106);
    assert.equal(metrics.totalTokens, 80);
  });

  it('counts turns and tool calls from non-renderable resume turns', () => {
    const turns = buildSessionTurnViews([
      created({
        turnId: 'auth',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
      {
        turnId: 'auth',
        event: {
          type: 'model.message',
          id: 'auth-model',
          threadId: 'main',
          createdAt: '2026-01-01T00:00:01.000Z',
          content: '',
          toolCalls: [{ id: 'call-auth', type: 'function', function: { name: 'list_tools', arguments: '{}' } }],
        },
      },
      {
        turnId: 'auth',
        event: {
          type: 'tool.response',
          id: 'auth-resp',
          threadId: 'main',
          createdAt: '2026-01-01T00:00:01.500Z',
          toolCallId: 'call-auth',
          content: 'ok',
        },
      },
      {
        turnId: 'auth',
        event: {
          type: 'turn.done',
          id: 'auth-done',
          state: {
            status: 'done',
            completedAt: '2026-01-01T00:00:02.000Z',
            output: null,
            requiredActions: [],
            metrics: {
              totalTokens: 100,
              totalCostInUsd: 0.01,
              totalInputTokens: 80,
              totalOutputTokens: 20,
              totalCacheReadTokens: 0,
              totalCacheWriteTokens: 0,
              totalReasoningTokens: 0,
            },
          },
          createdAt: '2026-01-01T00:00:02.000Z',
          threadId: null,
        },
      },
      {
        turnId: 'resume',
        event: {
          type: 'turn.created',
          id: 'resume-created',
          turnId: 'resume',
          previousTurnId: 'auth',
          state: { status: 'running' },
          createdAt: '2026-01-01T00:00:03.000Z',
          threadId: null,
        },
      },
      {
        turnId: 'resume',
        event: {
          type: 'model.message',
          id: 'resume-model',
          threadId: 'main',
          createdAt: '2026-01-01T00:00:04.000Z',
          content: '',
          toolCalls: [
            { id: 'call-a', type: 'function', function: { name: 'exec', arguments: '{}' } },
            { id: 'call-b', type: 'function', function: { name: 'call_tool', arguments: '{}' } },
          ],
        },
      },
      {
        turnId: 'resume',
        event: {
          type: 'tool.response',
          id: 'resume-resp-a',
          threadId: 'main',
          createdAt: '2026-01-01T00:00:05.000Z',
          toolCallId: 'call-a',
          content: 'a',
        },
      },
      {
        turnId: 'resume',
        event: {
          type: 'tool.response',
          id: 'resume-resp-b',
          threadId: 'main',
          createdAt: '2026-01-01T00:00:05.500Z',
          toolCallId: 'call-b',
          content: 'b',
        },
      },
      {
        turnId: 'resume',
        event: {
          type: 'turn.done',
          id: 'resume-done',
          state: {
            status: 'done',
            completedAt: '2026-01-01T00:00:06.000Z',
            output: null,
            requiredActions: [],
            metrics: {
              totalTokens: 900,
              totalCostInUsd: 0.09,
              totalInputTokens: 700,
              totalOutputTokens: 200,
              totalCacheReadTokens: 0,
              totalCacheWriteTokens: 0,
              totalReasoningTokens: 0,
            },
          },
          createdAt: '2026-01-01T00:00:06.000Z',
          threadId: null,
        },
      },
    ]);

    assert.equal(turns.length, 2);
    assert.equal(turns[0]?.renderable, true);
    assert.equal(turns[1]?.renderable, false);

    const segments = buildSessionTimelineSegments(turns);
    assert.equal(
      segments.filter(segment => segment.type === 'user').length,
      1,
      'non-renderable resume turns must not emit phantom user markers',
    );
    assert.equal(segments.filter(segment => segment.type === 'user')[0]?.turnIndex, 0);
    assert.ok(
      segments.every(segment => segment.turnIndex === 0),
      'resume-turn activity stays on the same timeline band as the user turn',
    );
    assert.deepEqual(
      segments.filter(segment => segment.title === 'turn.done').map(segment => segment.id),
      ['resume-turn.done'],
      'auth turn.done is omitted so it does not cover the resume model/tool bars',
    );
    // Auth's last bar ends at +1.5s; resume wall-clock starts later — compression removes the idle.
    const resumeModel = segments.find(segment => segment.id === 'resume-model');
    assert.equal(resumeModel?.startMs, 1_500);
    const metrics = buildSessionMetrics({ turns, segments });
    assert.equal(metrics.totalTurns, 2);
    assert.equal(metrics.sessionTotalTurns, undefined);
    assert.equal(metrics.toolCalls, 3);
    assert.equal(metrics.totalTokens, 1000);
    assert.deepEqual(
      metrics.costPerTurn.map(row => row.label),
      ['T1'],
    );
    assert.ok(Math.abs((metrics.costPerTurn[0]?.value ?? 0) - 0.1) < 1e-9);

    const withSessionTotal = buildSessionMetrics({
      turns,
      segments,
      sessionMetrics: { totalTurns: 4, totalDurationMs: 6_000 },
    });
    assert.equal(withSessionTotal.totalTurns, 2);
    assert.equal(withSessionTotal.sessionTotalTurns, 4);

    const matchedSessionTotal = buildSessionMetrics({
      turns,
      segments,
      sessionMetrics: { totalTurns: 2, totalDurationMs: 6_000 },
    });
    assert.equal(matchedSessionTotal.sessionTotalTurns, undefined);
  });
});
