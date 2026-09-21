import { describe, expect, it } from 'vitest';

import { ROOT_THREAD_ID } from '../src/constants.js';
import { TOOL_APPROVAL_THREAD_ID_CUSTOM_KEY, toolApprovalStatus } from '../src/toolApproval.js';
import { TOOL_RESPONSE_THREAD_ID_CUSTOM_KEY, toolResponseStatus } from '../src/toolResponse.js';
import type { TurnStreamUpdate } from '../src/turnStreamUpdate.js';
import { requiredActionsFromActiveUpdate } from '../src/useTrueForgeAgentMessages.js';

/**
 * Regression coverage for the live-stream pause path: when a turn pauses at a
 * tool approval or an `ask_user_question` (`tool.response_required`),
 * `commitActiveStream` fabricates a synthetic `TurnStateDone`. Its
 * `requiredActions` are reconstructed here from the paused update. If they were
 * dropped (as they were before the fix), the committed assistant message would
 * lose its `requires-action` status and the resume turn would never be sent.
 */
describe('requiredActionsFromActiveUpdate', () => {
  it('reconstructs a tool.response_required pause (ask_user_question)', () => {
    const update: TurnStreamUpdate = {
      content: [],
      status: toolResponseStatus(),
      metadata: {
        custom: { [TOOL_RESPONSE_THREAD_ID_CUSTOM_KEY]: ROOT_THREAD_ID },
      },
    };

    expect(requiredActionsFromActiveUpdate(update)).toEqual([
      expect.objectContaining({
        type: 'tool.response_required',
        threadId: ROOT_THREAD_ID,
        toolCalls: [],
      }),
    ]);
  });

  it('reconstructs a tool.approval_required pause', () => {
    const update: TurnStreamUpdate = {
      content: [],
      status: toolApprovalStatus(),
      metadata: {
        custom: { [TOOL_APPROVAL_THREAD_ID_CUSTOM_KEY]: 'sub-agent-1' },
      },
    };

    expect(requiredActionsFromActiveUpdate(update)).toEqual([
      expect.objectContaining({
        type: 'tool.approval_required',
        threadId: 'sub-agent-1',
        toolCalls: [],
      }),
    ]);
  });

  it('reconstructs both approval and response pauses in one turn', () => {
    const update: TurnStreamUpdate = {
      content: [],
      status: toolApprovalStatus(),
      metadata: {
        custom: {
          [TOOL_APPROVAL_THREAD_ID_CUSTOM_KEY]: ROOT_THREAD_ID,
          [TOOL_RESPONSE_THREAD_ID_CUSTOM_KEY]: 'sub-agent-1',
        },
      },
    };

    const actions = requiredActionsFromActiveUpdate(update);
    expect(actions?.map(action => action.type)).toEqual(['tool.approval_required', 'tool.response_required']);
  });

  it('reconstructs an mcp.auth_required pause', () => {
    const mcpServers = [{ id: 'gh', name: 'GitHub', authUrl: 'https://auth' }];
    const update: TurnStreamUpdate = {
      content: [],
      metadata: { custom: { pendingMcpAuth: true, mcpServers } },
    };

    expect(requiredActionsFromActiveUpdate(update)).toEqual([
      expect.objectContaining({ type: 'mcp.auth_required', mcpServers }),
    ]);
  });

  it('returns no actions for a completed (non-paused) update', () => {
    const update: TurnStreamUpdate = {
      content: [],
      metadata: {
        custom: { [TOOL_RESPONSE_THREAD_ID_CUSTOM_KEY]: ROOT_THREAD_ID },
      },
    };

    expect(requiredActionsFromActiveUpdate(update)).toEqual([]);
  });
});
