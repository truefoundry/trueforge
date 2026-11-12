import { describe, expect, it } from 'vitest';
import { buildMcpAuthTextParts, withOptimisticMcpAuthContinue } from '../src/mcpAuth.js';
import { createEmptySessionSnapshot, replaceSessionSnapshot, STREAM_SEGMENT_STATUS } from '../src/sessionSnapshot.js';

const createdAt = new Date().toISOString();
const mcpServers = [{ id: 'pylon', name: 'pylon', authUrl: 'https://example.com/pylon' }];

describe('withOptimisticMcpAuthContinue', () => {
  it('wakes a paused MCP-only tip so Working can show immediately', () => {
    const snapshot = replaceSessionSnapshot(createEmptySessionSnapshot(), {
      pendingMcpAuth: {
        type: 'mcp.auth_required',
        id: 'mcp-1',
        createdAt,
        threadId: null,
        mcpServers,
      },
      runningTurn: {
        id: 'turn-1',
        sessionId: 'session-1',
        createdAt,
        state: { status: 'paused' },
      },
      activeStream: {
        turnId: 'turn-1',
        segmentStatus: STREAM_SEGMENT_STATUS.PAUSED,
        update: {
          content: [{ type: 'text', text: 'Need auth' }, ...buildMcpAuthTextParts()],
          status: { type: 'requires-action', reason: 'interrupt' },
          turnState: { status: 'paused' },
          metadata: {
            custom: { pendingMcpAuth: true, mcpServers },
          },
        },
      },
    });

    const next = withOptimisticMcpAuthContinue(snapshot);

    expect(next.pendingMcpAuth).toBeUndefined();
    expect(next.runningTurn?.state).toEqual({ status: 'running' });
    expect(next.activeStream?.segmentStatus).toBe(STREAM_SEGMENT_STATUS.OPEN);
    expect(next.activeStream?.update.status).toEqual({ type: 'running' });
    expect(next.activeStream?.update.turnState).toEqual({ status: 'running' });
    expect(next.activeStream?.update.metadata?.custom?.['pendingMcpAuth']).toBeUndefined();
    expect(next.activeStream?.update.content).toEqual([{ type: 'text', text: 'Need auth' }]);
  });
});
