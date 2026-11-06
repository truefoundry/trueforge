import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import type { SessionEventItem } from '@/server/types.js';
import { buildSessionTimelineSegments } from '@/utils/buildSessionTimelineSegments.js';
import { formatReadableDurationMs } from '@/utils/sessionDisplayFormat.js';
import {
  applyPauseChipLayout,
  getTimelineLayout,
  getTurnGapAnchorMs,
  getTurnGapShiftsMs,
} from '@/utils/sessionEventTimelineChart.js';
import { buildSessionTurnViews } from '@/utils/sessionTurnViews.js';

describe('multi-day pause boundary', () => {
  it('does not stack a turn separator after a pause that ends a turn', () => {
    const events: SessionEventItem[] = [
      {
        turnId: 't1',
        event: {
          type: 'turn.created',
          id: 'c1',
          turnId: 't1',
          previousTurnId: null,
          input: [{ type: 'user.message', content: 'get todos' }],
          state: { status: 'running' },
          createdAt: '2026-10-12T09:06:48.425Z',
          threadId: null,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'model.message',
          id: 'm1',
          content: 'x',
          toolCalls: [{ id: 'call-1', type: 'function', function: { name: 'list_tools', arguments: '{}' } }],
          createdAt: '2026-10-12T09:06:51.540Z',
          threadId: 'main',
          finishReason: 'tool_calls',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'tool.response',
          id: 'tr1',
          toolCallId: 'call-1',
          content: 'Waiting',
          createdAt: '2026-10-12T09:06:51.552Z',
          threadId: 'main',
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'mcp.auth_required',
          id: 'auth1',
          createdAt: '2026-10-12T09:06:51.555Z',
          threadId: null,
          mcpServers: [{ id: 'linear', name: 'linear', authUrl: 'x' }],
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.update',
          id: 'p1',
          state: { status: 'paused' },
          createdAt: '2026-10-12T09:06:51.557Z',
          threadId: null,
        },
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.done',
          id: 'd1',
          state: {
            status: 'cancelled',
            reason: 'cancelled-for-next-turn',
            completedAt: '2026-10-15T04:35:23.472Z',
          },
          createdAt: '2026-10-15T04:35:23.472Z',
          threadId: null,
        },
      },
      {
        turnId: 't2',
        event: {
          type: 'turn.created',
          id: 'c2',
          turnId: 't2',
          previousTurnId: 't1',
          input: [{ type: 'user.message', content: 'Hello' }],
          state: { status: 'running' },
          createdAt: '2026-10-15T04:35:23.524Z',
          threadId: null,
        },
      },
      {
        turnId: 't2',
        event: {
          type: 'model.message',
          id: 'm2',
          content: 'Hi',
          createdAt: '2026-10-15T04:35:26.958Z',
          threadId: 'main',
          finishReason: 'stop',
        },
      },
    ];
    const segments = buildSessionTimelineSegments(buildSessionTurnViews(events));
    const pause = segments.find(s => s.isPauseChip);
    const layout = getTimelineLayout(segments);
    assert.ok(pause);
    assert.equal(layout.turnStartsMs[1], pause.startMs);

    const pauseStarts = segments.filter(s => s.isPauseChip).map(s => s.startMs);
    assert.deepEqual(getTurnGapAnchorMs({ turnRanges: layout.turnRanges, pauseChipStartsMs: pauseStarts }), []);
    const turnGapMs = 2_000;
    const shifts = getTurnGapShiftsMs({
      turnRanges: layout.turnRanges,
      pauseChipStartsMs: pauseStarts,
      turnGapMs,
    });
    assert.equal(shifts.get(0), 0);
    assert.equal(shifts.get(1), 0);

    const pauseChipMs = 5_000;
    const shifted = segments.map(s => {
      const shift = shifts.get(s.turnIndex) ?? 0;
      return { ...s, startMs: s.startMs + shift, endMs: s.endMs + shift };
    });
    const laid = applyPauseChipLayout({ segments: shifted, pauseChipMs });
    const pauseLaid = laid.find(s => s.isPauseChip);
    const t2User = laid.find(s => s.id.endsWith('-user') && s.turnIndex === 1);
    assert.ok(pauseLaid);
    assert.ok(t2User);
    // Next-turn user diamond sits at the chip’s right edge (not in an extra turn gap).
    assert.equal(t2User.startMs, pauseLaid.endMs);
  });

  it('formats durations with days after 24h', () => {
    assert.equal(formatReadableDurationMs(67 * 3_600_000 + 29 * 60_000 + 18_000), '2d 19h 29m 18s');
    assert.equal(formatReadableDurationMs(25 * 3_600_000), '1d 1h');
    assert.equal(formatReadableDurationMs(3_600_000), '1h');
  });
});
