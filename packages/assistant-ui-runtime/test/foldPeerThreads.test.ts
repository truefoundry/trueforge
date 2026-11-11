import { describe, expect, it } from 'vitest';
import type { ModelMessageEvent, ThreadCreatedEvent, TurnEvent } from '../src/server/index.js';
import { EVENT_TYPE, TOOL_APPROVAL_POLICY_ACTION_TYPE } from '../src/server/index.js';

import { ROOT_THREAD_ID } from '../src/constants.js';
import { CONTEXT_COMPACTION_DATA_NAME } from '../src/contextCompaction.js';
import {
  applyApprovalPoliciesToFold,
  buildRootAssistantContent,
  buildRootAssistantContentForIds,
  buildRootAssistantFoldForIds,
  earliestOpenModelMessageId,
  ingestStreamEvent,
  ingestTurnEvent,
  PeerThreadFoldState,
  recordToolApprovalInFold,
  recordToolResponseInFold,
  resolveToolApprovalPolicyTarget,
} from '../src/foldPeerThreads.js';

const createdAt = new Date().toISOString();

function modelMessage(event: Omit<ModelMessageEvent, 'type' | 'createdAt'>): ModelMessageEvent {
  return { type: 'model.message', createdAt, ...event };
}

function threadCreated(event: Omit<ThreadCreatedEvent, 'type' | 'createdAt'>): ThreadCreatedEvent {
  return { type: 'thread.created', createdAt, ...event };
}

describe('foldPeerThreads', () => {
  it('ignores an unfinished shell from another turn when choosing the resume cursor', () => {
    const state = new PeerThreadFoldState();
    ingestTurnEvent(state, modelMessage({ id: 'm-old', threadId: ROOT_THREAD_ID, content: 'stuck' }), 'turn-old');
    ingestTurnEvent(state, modelMessage({ id: 'm-new', threadId: ROOT_THREAD_ID, content: '' }), 'turn-new');

    expect(earliestOpenModelMessageId(state, 'turn-new')).toBe('m-new');
  });

  it('keeps a finished model message when its shell is replayed', () => {
    const state = new PeerThreadFoldState();
    const finished = modelMessage({
      id: 'm-done',
      threadId: ROOT_THREAD_ID,
      content: '',
      finishReason: 'tool_calls',
      toolCalls: [
        {
          id: 'call-1',
          type: 'function',
          function: { name: 'save', arguments: '{"title":"full"}' },
        },
      ],
    });
    ingestStreamEvent(state, finished, 'turn-1');
    ingestStreamEvent(state, modelMessage({ id: 'm-done', threadId: ROOT_THREAD_ID, content: '' }), 'turn-1');

    const stored = state.threads.get(ROOT_THREAD_ID)?.events.get('m-done');
    expect(stored?.type === 'model.message' ? stored.toolCalls?.[0]?.function.arguments : undefined).toBe(
      '{"title":"full"}',
    );
  });

  it('ignores sandbox.created (no threadId, not foldable) without crashing', () => {
    const state = new PeerThreadFoldState();
    const sandboxEvent = {
      type: 'sandbox.created' as const,
      id: 'sandbox-evt',
      createdAt,
      sandboxId: 'sbx-123',
    } as unknown as TurnEvent;

    expect(() => ingestTurnEvent(state, sandboxEvent)).not.toThrow();
    expect(ingestStreamEvent(state, sandboxEvent)).toBe(false);
    expect(buildRootAssistantContent(state)).toEqual([]);
  });

  it('anchors root content on main without inference', () => {
    const state = new PeerThreadFoldState();

    const rootMessage: TurnEvent = modelMessage({
      id: 'm1',
      threadId: ROOT_THREAD_ID,
      content: 'hello',
    });

    ingestTurnEvent(state, rootMessage);

    expect(buildRootAssistantContent(state)).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('replaces an already-ingested model.message shell on inclusive replay', () => {
    const state = new PeerThreadFoldState();
    ingestStreamEvent(
      state,
      modelMessage({
        id: 'm1',
        threadId: ROOT_THREAD_ID,
        content: 'partial',
      }),
    );
    expect(buildRootAssistantContent(state)).toEqual([{ type: 'text', text: 'partial' }]);

    expect(
      ingestStreamEvent(
        state,
        modelMessage({
          id: 'm1',
          threadId: ROOT_THREAD_ID,
          content: 'fresh',
        }),
      ),
    ).toBe(true);
    expect(buildRootAssistantContent(state)).toEqual([{ type: 'text', text: 'fresh' }]);
  });

  it('captures sub-agent title from thread.created and tags nested messages', () => {
    const state = new PeerThreadFoldState();

    ingestTurnEvent(
      state,
      modelMessage({
        id: 'root-msg',
        threadId: ROOT_THREAD_ID,
        toolCalls: [
          {
            id: 'spawn-1',
            type: 'function',
            function: { name: 'create_sub_agent', arguments: '{}' },
            toolInfo: { type: 'trueforge-system', name: 'create_sub_agent' },
          },
        ],
      }),
    );

    ingestTurnEvent(
      state,
      threadCreated({
        id: 't-created',
        threadId: 'child-1',
        title: 'Research agent',
        agentInfo: { type: 'dynamic', name: 'researcher', input: 'do research' },
        parent: { threadId: ROOT_THREAD_ID, toolCallId: 'spawn-1' },
      }),
    );

    ingestTurnEvent(
      state,
      modelMessage({
        id: 'child-msg',
        threadId: 'child-1',
        content: 'working',
      }),
    );

    const parts = buildRootAssistantContent(state);
    const spawn = parts.find(part => part.type === 'tool-call');
    expect(spawn?.type).toBe('tool-call');
    if (spawn?.type !== 'tool-call') {
      return;
    }

    expect(spawn.artifact).toEqual({
      subAgents: [
        {
          threadId: 'child-1',
          title: 'Research agent',
          agentInfo: {
            type: 'dynamic',
            name: 'researcher',
            input: 'do research',
          },
        },
      ],
    });

    const nested = spawn.messages?.[0];
    expect(nested?.metadata.custom['subAgent']).toEqual({
      threadId: 'child-1',
      title: 'Research agent',
      name: 'researcher',
      input: 'do research',
    });
  });

  it('attaches sub-agent artifact from thread.created before child model messages arrive', () => {
    const state = new PeerThreadFoldState();

    ingestTurnEvent(
      state,
      modelMessage({
        id: 'root-msg',
        threadId: ROOT_THREAD_ID,
        toolCalls: [
          {
            id: 'spawn-1',
            type: 'function',
            function: { name: 'create_sub_agent', arguments: '{}' },
            toolInfo: { type: 'trueforge-system', name: 'create_sub_agent' },
          },
        ],
      }),
    );

    ingestTurnEvent(
      state,
      threadCreated({
        id: 't-created',
        threadId: 'child-1',
        title: 'gateway-usage-7d',
        agentInfo: {
          type: 'dynamic',
          name: 'gateway-usage-7d',
          input: 'run queries',
        },
        parent: { threadId: ROOT_THREAD_ID, toolCallId: 'spawn-1' },
      }),
    );

    const parts = buildRootAssistantContent(state);
    const spawn = parts.find(part => part.type === 'tool-call');
    expect(spawn?.type).toBe('tool-call');
    if (spawn?.type !== 'tool-call') {
      return;
    }

    expect(spawn.messages).toBeUndefined();
    expect(spawn.artifact).toEqual({
      subAgents: [
        {
          threadId: 'child-1',
          title: 'gateway-usage-7d',
          agentInfo: {
            type: 'dynamic',
            name: 'gateway-usage-7d',
            input: 'run queries',
          },
        },
      ],
    });
  });

  it('classifies stream events by thread id', () => {
    const state = new PeerThreadFoldState();
    expect(
      ingestStreamEvent(
        state,
        threadCreated({
          id: 'e1',
          threadId: 'child-1',
          title: 'Child',
          agentInfo: { type: 'dynamic', name: 'child', input: 'x' },
          parent: { threadId: ROOT_THREAD_ID, toolCallId: 'tc' },
        }),
      ),
    ).toBe(true);
    expect(state.threads.get('child-1')?.title).toBe('Child');
  });

  it('ingests tool.response_required and marks tool calls as pending responses', () => {
    const state = new PeerThreadFoldState();

    ingestTurnEvent(
      state,
      modelMessage({
        id: 'model-1',
        threadId: ROOT_THREAD_ID,
        toolCalls: [
          {
            id: 'question-1',
            type: 'function',
            function: {
              name: 'ask_user_question',
              arguments: JSON.stringify({
                question: 'Pick one',
                options: ['A', 'B'],
              }),
            },
            toolInfo: { type: 'trueforge-system', name: 'ask_user_question' },
          },
        ],
      }),
    );

    ingestTurnEvent(state, {
      type: 'tool.response_required',
      id: 'resp-req-1',
      createdAt,
      threadId: ROOT_THREAD_ID,
      toolCalls: [{ id: 'question-1', sourceEventId: 'model-1' }],
    });

    const bucket = state.threads.get(ROOT_THREAD_ID)!;
    expect(bucket.pendingResponses.get('question-1')).toMatchObject({
      id: 'question-1',
      sourceEventId: 'model-1',
      question: 'Pick one',
      options: ['A', 'B'],
    });

    const parts = buildRootAssistantContent(state);
    const toolCall = parts.find(part => part.type === 'tool-call');
    expect(toolCall?.type).toBe('tool-call');
    if (toolCall?.type !== 'tool-call') {
      return;
    }
    expect(toolCall.interrupt).toEqual({
      type: 'human',
      payload: { question: 'Pick one', options: ['A', 'B'] },
    });
  });

  it('recordToolResponseInFold clears pending and attaches result', () => {
    const state = new PeerThreadFoldState();

    ingestTurnEvent(
      state,
      modelMessage({
        id: 'model-1',
        threadId: ROOT_THREAD_ID,
        toolCalls: [
          {
            id: 'question-1',
            type: 'function',
            function: {
              name: 'ask_user_question',
              arguments: JSON.stringify({
                question: 'Pick one',
                options: ['A', 'B'],
              }),
            },
            toolInfo: { type: 'trueforge-system', name: 'ask_user_question' },
          },
        ],
      }),
    );

    ingestTurnEvent(state, {
      type: 'tool.response_required',
      id: 'resp-req-1',
      createdAt,
      threadId: ROOT_THREAD_ID,
      toolCalls: [{ id: 'question-1', sourceEventId: 'model-1' }],
    });

    recordToolResponseInFold(state, {
      toolCallId: 'question-1',
      content: 'A',
    });

    const bucket = state.threads.get(ROOT_THREAD_ID)!;
    expect(bucket.pendingResponses.has('question-1')).toBe(false);
    expect(bucket.toolResults.get('question-1')).toBe('A');

    const toolCall = buildRootAssistantContent(state).find(part => part.type === 'tool-call');
    expect(toolCall?.type).toBe('tool-call');
    if (toolCall?.type !== 'tool-call') {
      return;
    }
    expect(toolCall.result).toBe('A');
    expect(toolCall.interrupt).toBeUndefined();
  });

  it('ingests tool.response and clears pending ask-user state', () => {
    const state = new PeerThreadFoldState();

    ingestTurnEvent(
      state,
      modelMessage({
        id: 'model-1',
        threadId: ROOT_THREAD_ID,
        toolCalls: [
          {
            id: 'question-1',
            type: 'function',
            function: {
              name: 'ask_user_question',
              arguments: JSON.stringify({
                question: 'Pick one',
                options: ['A', 'B'],
              }),
            },
            toolInfo: { type: 'trueforge-system', name: 'ask_user_question' },
          },
        ],
      }),
    );

    ingestTurnEvent(state, {
      type: 'tool.response_required',
      id: 'resp-req-1',
      createdAt,
      threadId: ROOT_THREAD_ID,
      toolCalls: [{ id: 'question-1', sourceEventId: 'model-1' }],
    });

    ingestTurnEvent(state, {
      type: 'tool.response',
      id: 'resp-1',
      createdAt,
      threadId: ROOT_THREAD_ID,
      toolCallId: 'question-1',
      content: 'A',
    });

    const bucket = state.threads.get(ROOT_THREAD_ID)!;
    expect(bucket.pendingResponses.has('question-1')).toBe(false);
    expect(bucket.toolResults.get('question-1')).toBe('A');

    const toolCall = buildRootAssistantContent(state).find(part => part.type === 'tool-call');
    expect(toolCall?.type).toBe('tool-call');
    if (toolCall?.type !== 'tool-call') {
      return;
    }
    expect(toolCall.result).toBe('A');
    expect(toolCall.interrupt).toBeUndefined();
  });

  function seedPendingApproval(): PeerThreadFoldState {
    const state = new PeerThreadFoldState();
    ingestTurnEvent(
      state,
      modelMessage({
        id: 'model-1',
        threadId: ROOT_THREAD_ID,
        toolCalls: [
          {
            id: 'tool-1',
            type: 'function',
            function: { name: 'run_shell', arguments: '{}' },
            toolInfo: {
              type: 'mcp',
              name: 'run_shell',
              serverId: 'srv-1',
              serverName: 'shell',
            },
          },
        ],
      }),
    );
    ingestTurnEvent(state, {
      type: 'tool.approval_required',
      id: 'appr-req-1',
      createdAt,
      threadId: ROOT_THREAD_ID,
      toolCalls: [{ id: 'tool-1', sourceEventId: 'model-1' }],
    });
    return state;
  }

  it('recordToolApprovalInFold resolves a pending approval on allow', () => {
    const state = seedPendingApproval();
    const bucket = state.threads.get(ROOT_THREAD_ID)!;
    expect(bucket.pendingApprovals.has('tool-1')).toBe(true);

    recordToolApprovalInFold(state, { toolCallId: 'tool-1', approved: true });

    // Once decided, the approval must leave the pending set so the turn is
    // not re-paused (and the user re-prompted) for it after resume.
    expect(bucket.pendingApprovals.has('tool-1')).toBe(false);

    const toolCall = buildRootAssistantContent(state).find(part => part.type === 'tool-call');
    if (toolCall?.type !== 'tool-call') {
      throw new Error('expected a tool-call part');
    }
    expect(toolCall.approval?.approved).toBe(true);
  });

  it('resolves MCP policy targets on root and nested threads', () => {
    const state = seedPendingApproval();
    ingestTurnEvent(
      state,
      modelMessage({
        id: 'nested-model',
        threadId: 'child-1',
        toolCalls: [
          {
            id: 'nested-tool',
            type: 'function',
            function: { name: 'create_issue', arguments: '{}' },
            toolInfo: {
              type: 'mcp',
              name: 'create_issue',
              serverId: 'github-id',
              serverName: 'github',
            },
          },
        ],
      }),
    );

    expect(resolveToolApprovalPolicyTarget({ state, threadId: ROOT_THREAD_ID, toolCallId: 'tool-1' })).toEqual({
      serverName: 'shell',
      name: 'run_shell',
    });
    expect(resolveToolApprovalPolicyTarget({ state, threadId: 'child-1', toolCallId: 'nested-tool' })).toEqual({
      serverName: 'github',
      name: 'create_issue',
    });
  });

  it('resolves deferred call_tool policy targets from call arguments', () => {
    const state = new PeerThreadFoldState();
    ingestTurnEvent(
      state,
      modelMessage({
        id: 'deferred-model',
        threadId: ROOT_THREAD_ID,
        toolCalls: [
          {
            id: 'toolu_deferred',
            type: 'function',
            function: {
              name: 'call_tool',
              arguments: JSON.stringify({
                mcp_server: 'linear',
                tool_name: 'save_comment',
                input: { issueId: 'FRONTEN-2512', body: 'test 2' },
              }),
            },
            toolInfo: { type: 'truefoundry-system', name: 'call_tool' },
          },
        ],
      }),
    );

    expect(
      resolveToolApprovalPolicyTarget({
        state,
        threadId: ROOT_THREAD_ID,
        toolCallId: 'toolu_deferred',
      }),
    ).toEqual({ serverName: 'linear', name: 'save_comment' });
  });

  it('does not append subscribe deltas onto a finished history model.message', () => {
    const args = JSON.stringify({
      mcp_server: 'linear',
      tool_name: 'save_comment',
      input: { issueId: 'FRONTEN-2512', body: 'test 2' },
    });
    const state = new PeerThreadFoldState();
    ingestTurnEvent(
      state,
      modelMessage({
        id: 'deferred-model',
        threadId: ROOT_THREAD_ID,
        content: 'creating the comment',
        finishReason: 'tool_calls',
        toolCalls: [
          {
            id: 'toolu_deferred',
            type: 'function',
            function: { name: 'call_tool', arguments: args },
            toolInfo: { type: 'truefoundry-system', name: 'call_tool' },
          },
        ],
      }),
    );
    ingestStreamEvent(state, {
      type: 'model.message.delta',
      id: 'deferred-model',
      createdAt,
      threadId: ROOT_THREAD_ID,
      content: 'creating the comment',
      toolCalls: [{ index: 0, function: { arguments: args } }],
    });

    const stored = state.threads.get(ROOT_THREAD_ID)?.events.get('deferred-model');
    expect(stored?.type).toBe('model.message');
    if (stored?.type !== 'model.message') {
      return;
    }
    expect(stored.content).toBe('creating the comment');
    expect(stored.toolCalls?.[0]?.function.arguments).toBe(args);
    expect(
      resolveToolApprovalPolicyTarget({
        state,
        threadId: ROOT_THREAD_ID,
        toolCallId: 'toolu_deferred',
      }),
    ).toEqual({ serverName: 'linear', name: 'save_comment' });
  });

  it('still merges live deltas until finishReason is set', () => {
    const state = new PeerThreadFoldState();
    ingestStreamEvent(
      state,
      modelMessage({
        id: 'live-model',
        threadId: ROOT_THREAD_ID,
        toolCalls: [
          {
            id: 'toolu_live',
            type: 'function',
            function: { name: 'call_tool', arguments: '' },
            toolInfo: { type: 'truefoundry-system', name: 'call_tool' },
          },
        ],
      }),
    );
    ingestStreamEvent(state, {
      type: 'model.message.delta',
      id: 'live-model',
      createdAt,
      threadId: ROOT_THREAD_ID,
      content: 'creating',
      toolCalls: [
        {
          index: 0,
          function: {
            arguments: JSON.stringify({ mcp_server: 'linear', tool_name: 'save_comment' }),
          },
        },
      ],
    });

    const stored = state.threads.get(ROOT_THREAD_ID)?.events.get('live-model');
    expect(stored?.type).toBe('model.message');
    if (stored?.type !== 'model.message') {
      return;
    }
    expect(stored.content).toBe('creating');
    expect(stored.toolCalls?.[0]?.function.arguments).toBe(
      JSON.stringify({ mcp_server: 'linear', tool_name: 'save_comment' }),
    );
  });

  it('clears sibling pending approvals covered by a session policy', () => {
    const state = new PeerThreadFoldState();
    ingestTurnEvent(
      state,
      modelMessage({
        id: 'deferred-model',
        threadId: ROOT_THREAD_ID,
        toolCalls: [
          {
            id: 'tool-a',
            type: 'function',
            function: {
              name: 'call_tool',
              arguments: JSON.stringify({
                mcp_server: 'linear',
                tool_name: 'save_comment',
                input: { issueId: 'A' },
              }),
            },
            toolInfo: { type: 'truefoundry-system', name: 'call_tool' },
          },
          {
            id: 'tool-b',
            type: 'function',
            function: {
              name: 'call_tool',
              arguments: JSON.stringify({
                mcp_server: 'linear',
                tool_name: 'save_comment',
                input: { issueId: 'B' },
              }),
            },
            toolInfo: { type: 'truefoundry-system', name: 'call_tool' },
          },
        ],
      }),
    );
    ingestTurnEvent(state, {
      type: 'tool.approval_required',
      id: 'appr-req-both',
      createdAt,
      threadId: ROOT_THREAD_ID,
      toolCalls: [
        { id: 'tool-a', sourceEventId: 'deferred-model' },
        { id: 'tool-b', sourceEventId: 'deferred-model' },
      ],
    });

    applyApprovalPoliciesToFold(state, [
      { serverName: 'linear', name: 'save_comment', policy: { type: TOOL_APPROVAL_POLICY_ACTION_TYPE.ALLOW_SESSION } },
    ]);

    const bucket = state.threads.get(ROOT_THREAD_ID);
    expect(bucket?.pendingApprovals.size).toBe(0);
    expect(bucket?.approvalDecisions.get('tool-a')?.approved).toBe(true);
    expect(bucket?.approvalDecisions.get('tool-b')?.approved).toBe(true);
  });

  it('deduplicates persisted inbound events replayed after POST', () => {
    const state = seedPendingApproval();
    const event = {
      type: 'user.tool_approval' as const,
      id: 'user-approval-1',
      createdAt: new Date().toISOString(),
      threadId: ROOT_THREAD_ID,
      toolCallId: 'tool-1',
      approval: { status: 'allow' as const },
    };

    ingestTurnEvent(state, event);
    ingestTurnEvent(state, event);

    const bucket = state.threads.get(ROOT_THREAD_ID);
    expect(bucket?.pendingApprovals.has('tool-1')).toBe(false);
    expect(bucket?.approvalDecisions.size).toBe(1);
    expect(state.ingestedEventIds.has('user-approval-1')).toBe(true);
    expect(state.ingestedEventIds.size).toBe(3);
  });

  it('deduplicates fold-neutral MCP and approval-policy events without creating buckets', () => {
    const state = new PeerThreadFoldState();
    const events: TurnEvent[] = [
      {
        type: EVENT_TYPE.USER_MCP_AUTH_CONTINUE,
        id: 'mcp-continue-1',
        createdAt,
      },
      {
        type: EVENT_TYPE.USER_TOOL_APPROVAL_POLICY,
        id: 'policy-1',
        createdAt,
        policies: [
          {
            serverName: 'github',
            name: 'create_issue',
            policy: { type: TOOL_APPROVAL_POLICY_ACTION_TYPE.ALLOW_SESSION },
          },
        ],
      },
    ];

    for (const event of [...events, ...events]) {
      ingestTurnEvent(state, event);
    }

    expect(state.threads.size).toBe(0);
    expect(state.ingestedEventIds).toEqual(new Set(['mcp-continue-1', 'policy-1']));
  });

  it('recordToolApprovalInFold synthesizes an error result on deny', () => {
    const state = seedPendingApproval();

    recordToolApprovalInFold(state, {
      toolCallId: 'tool-1',
      approved: false,
      reason: 'not allowed',
    });

    const bucket = state.threads.get(ROOT_THREAD_ID)!;
    expect(bucket.pendingApprovals.has('tool-1')).toBe(false);

    const toolCall = buildRootAssistantContent(state).find(part => part.type === 'tool-call');
    if (toolCall?.type !== 'tool-call') {
      throw new Error('expected a tool-call part');
    }
    expect(toolCall.approval?.approved).toBe(false);
    expect(toolCall.isError).toBe(true);
    expect(toolCall.result).toEqual({ error: 'not allowed' });
  });

  it('gives create_sub_agent a truthy result after empty tool.response so aui marks it complete', () => {
    const state = new PeerThreadFoldState();

    ingestTurnEvent(
      state,
      modelMessage({
        id: 'root-msg',
        threadId: ROOT_THREAD_ID,
        toolCalls: [
          {
            id: 'spawn-1',
            type: 'function',
            function: { name: 'create_sub_agent', arguments: '{}' },
            toolInfo: { type: 'trueforge-system', name: 'create_sub_agent' },
          },
          {
            id: 'spawn-2',
            type: 'function',
            function: { name: 'create_sub_agent', arguments: '{}' },
            toolInfo: { type: 'trueforge-system', name: 'create_sub_agent' },
          },
        ],
      }),
    );
    ingestTurnEvent(
      state,
      threadCreated({
        id: 't-created-1',
        threadId: 'child-1',
        title: 'Done agent',
        agentInfo: { type: 'dynamic', name: 'done', input: 'finish' },
        parent: { threadId: ROOT_THREAD_ID, toolCallId: 'spawn-1' },
      }),
    );
    ingestTurnEvent(
      state,
      modelMessage({
        id: 'child-1-msg',
        threadId: 'child-1',
        content: 'done',
      }),
    );
    ingestTurnEvent(state, {
      type: 'thread.done',
      id: 't-done-1',
      threadId: 'child-1',
      createdAt,
      state: { status: 'done' },
    });
    // Orchestrator closes create_sub_agent with empty content; payload is on send_to_parent.
    ingestTurnEvent(state, {
      type: 'tool.response',
      id: 'tr-1',
      threadId: ROOT_THREAD_ID,
      createdAt,
      toolCallId: 'spawn-1',
      content: '',
    });

    const parts = buildRootAssistantContent(state).filter(part => part.type === 'tool-call');
    const done = parts.find(part => part.type === 'tool-call' && part.toolCallId === 'spawn-1');
    const open = parts.find(part => part.type === 'tool-call' && part.toolCallId === 'spawn-2');
    expect(done?.type).toBe('tool-call');
    expect(open?.type).toBe('tool-call');
    if (done?.type !== 'tool-call' || open?.type !== 'tool-call') {
      return;
    }
    expect(done.result).toBeTruthy();
    expect(open.result).toBeUndefined();
    expect(done.messages?.[0]?.status).toEqual({ type: 'complete', reason: 'stop' });
  });

  it('marks nested sub-agent incomplete when thread.done is error', () => {
    const state = new PeerThreadFoldState();

    ingestTurnEvent(
      state,
      modelMessage({
        id: 'root-msg',
        threadId: ROOT_THREAD_ID,
        toolCalls: [
          {
            id: 'spawn-1',
            type: 'function',
            function: { name: 'create_sub_agent', arguments: '{}' },
            toolInfo: { type: 'trueforge-system', name: 'create_sub_agent' },
          },
        ],
      }),
    );
    ingestTurnEvent(
      state,
      threadCreated({
        id: 't-created',
        threadId: 'child-1',
        title: 'Research agent',
        agentInfo: { type: 'dynamic', name: 'researcher', input: 'do research' },
        parent: { threadId: ROOT_THREAD_ID, toolCallId: 'spawn-1' },
      }),
    );
    ingestTurnEvent(
      state,
      modelMessage({
        id: 'child-msg',
        threadId: 'child-1',
        content: 'working',
      }),
    );
    ingestTurnEvent(state, {
      type: 'thread.done',
      id: 't-done',
      threadId: 'child-1',
      createdAt,
      state: { status: 'error', error: 'sub-agent blew up' },
    });

    const spawn = buildRootAssistantContent(state).find(part => part.type === 'tool-call');
    expect(spawn?.type).toBe('tool-call');
    if (spawn?.type !== 'tool-call') return;
    expect(spawn.messages?.[0]?.status).toEqual({
      type: 'incomplete',
      reason: 'error',
      error: 'sub-agent blew up',
    });
  });

  it('marks unfinished nested sub-agent cancelled when parent turn is cancelled', () => {
    const state = new PeerThreadFoldState();

    ingestTurnEvent(
      state,
      modelMessage({
        id: 'root-msg',
        threadId: ROOT_THREAD_ID,
        toolCalls: [
          {
            id: 'spawn-1',
            type: 'function',
            function: { name: 'create_sub_agent', arguments: '{}' },
            toolInfo: { type: 'trueforge-system', name: 'create_sub_agent' },
          },
        ],
      }),
    );
    ingestTurnEvent(
      state,
      threadCreated({
        id: 't-created',
        threadId: 'child-1',
        title: 'Research agent',
        agentInfo: { type: 'dynamic', name: 'researcher', input: 'do research' },
        parent: { threadId: ROOT_THREAD_ID, toolCallId: 'spawn-1' },
      }),
    );
    ingestTurnEvent(
      state,
      modelMessage({
        id: 'child-msg',
        threadId: 'child-1',
        content: 'working',
      }),
    );

    state.parentTerminalStatus = 'cancelled';
    const spawn = buildRootAssistantContent(state).find(part => part.type === 'tool-call');
    expect(spawn?.type).toBe('tool-call');
    if (spawn?.type !== 'tool-call') return;
    expect(spawn.messages?.[0]?.status).toEqual({ type: 'incomplete', reason: 'cancelled' });
  });

  it('marks abort-shaped thread.done error as cancelled when parent turn is cancelled', () => {
    const state = new PeerThreadFoldState();

    ingestTurnEvent(
      state,
      modelMessage({
        id: 'root-msg',
        threadId: ROOT_THREAD_ID,
        toolCalls: [
          {
            id: 'spawn-1',
            type: 'function',
            function: { name: 'create_sub_agent', arguments: '{}' },
            toolInfo: { type: 'trueforge-system', name: 'create_sub_agent' },
          },
        ],
      }),
    );
    ingestTurnEvent(
      state,
      threadCreated({
        id: 't-created',
        threadId: 'child-1',
        title: 'Research agent',
        agentInfo: { type: 'dynamic', name: 'researcher', input: 'do research' },
        parent: { threadId: ROOT_THREAD_ID, toolCallId: 'spawn-1' },
      }),
    );
    ingestTurnEvent(
      state,
      modelMessage({
        id: 'child-msg',
        threadId: 'child-1',
        content: 'working',
      }),
    );
    ingestTurnEvent(state, {
      type: 'thread.done',
      id: 't-done',
      threadId: 'child-1',
      createdAt,
      state: { status: 'error', error: 'LLM stream aborted' },
    });

    state.parentTerminalStatus = 'cancelled';
    const spawn = buildRootAssistantContent(state).find(part => part.type === 'tool-call');
    expect(spawn?.type).toBe('tool-call');
    if (spawn?.type !== 'tool-call') return;
    expect(spawn.messages?.[0]?.status).toEqual({ type: 'incomplete', reason: 'cancelled' });
  });

  it('keeps non-abort thread.done error when parent turn is cancelled', () => {
    const state = new PeerThreadFoldState();

    ingestTurnEvent(
      state,
      modelMessage({
        id: 'root-msg',
        threadId: ROOT_THREAD_ID,
        toolCalls: [
          {
            id: 'spawn-1',
            type: 'function',
            function: { name: 'create_sub_agent', arguments: '{}' },
            toolInfo: { type: 'trueforge-system', name: 'create_sub_agent' },
          },
        ],
      }),
    );
    ingestTurnEvent(
      state,
      threadCreated({
        id: 't-created',
        threadId: 'child-1',
        title: 'Research agent',
        agentInfo: { type: 'dynamic', name: 'researcher', input: 'do research' },
        parent: { threadId: ROOT_THREAD_ID, toolCallId: 'spawn-1' },
      }),
    );
    ingestTurnEvent(
      state,
      modelMessage({
        id: 'child-msg',
        threadId: 'child-1',
        content: 'working',
      }),
    );
    ingestTurnEvent(state, {
      type: 'thread.done',
      id: 't-done',
      threadId: 'child-1',
      createdAt,
      state: { status: 'error', error: 'sub-agent blew up' },
    });

    state.parentTerminalStatus = 'cancelled';
    const spawn = buildRootAssistantContent(state).find(part => part.type === 'tool-call');
    expect(spawn?.type).toBe('tool-call');
    if (spawn?.type !== 'tool-call') return;
    expect(spawn.messages?.[0]?.status).toEqual({
      type: 'incomplete',
      reason: 'error',
      error: 'sub-agent blew up',
    });
  });

  it('emits a running compaction data part before the following model message', () => {
    const state = new PeerThreadFoldState();
    const trigger = {
      type: 'context_threshold_exceeded' as const,
      contextTokens: 90_000,
      thresholdTokens: 80_000,
    };

    expect(
      ingestStreamEvent(state, {
        type: 'thread.context_compaction_started',
        id: 'comp-start',
        createdAt,
        threadId: ROOT_THREAD_ID,
        trigger,
      }),
    ).toBe(true);

    const running = buildRootAssistantContentForIds(state, []);
    expect(running).toEqual([
      {
        type: 'data',
        name: CONTEXT_COMPACTION_DATA_NAME,
        data: {
          status: 'running',
          started: {
            type: 'thread.context_compaction_started',
            id: 'comp-start',
            createdAt,
            threadId: ROOT_THREAD_ID,
            trigger,
          },
        },
      },
    ]);

    expect(
      ingestStreamEvent(state, {
        type: 'thread.context_compaction_finished',
        id: 'comp-finish',
        createdAt,
        threadId: ROOT_THREAD_ID,
        trigger,
        durationMs: 1200,
        usage: { inputTokens: 10, outputTokens: 20 },
      }),
    ).toBe(true);

    ingestTurnEvent(
      state,
      modelMessage({
        id: 'm-after',
        threadId: ROOT_THREAD_ID,
        content: 'after summary',
      }),
    );

    const complete = buildRootAssistantContentForIds(state, ['m-after']);
    expect(complete).toHaveLength(2);
    expect(complete[0]).toMatchObject({
      type: 'data',
      name: CONTEXT_COMPACTION_DATA_NAME,
      data: { status: 'complete' },
    });
    expect(complete[1]).toEqual({ type: 'text', text: 'after summary' });
  });

  it('marks unfinished compaction incomplete when the parent turn was cancelled', () => {
    const state = new PeerThreadFoldState();
    const trigger = {
      type: 'context_threshold_exceeded' as const,
      contextTokens: 90_000,
      thresholdTokens: 80_000,
    };

    ingestStreamEvent(state, {
      type: 'thread.context_compaction_started',
      id: 'comp-start',
      createdAt,
      threadId: ROOT_THREAD_ID,
      trigger,
    });

    state.parentTerminalStatus = 'cancelled';
    const parts = buildRootAssistantContentForIds(state, []);
    expect(parts).toEqual([
      {
        type: 'data',
        name: CONTEXT_COMPACTION_DATA_NAME,
        data: {
          status: 'incomplete',
          reason: 'cancelled',
          started: {
            type: 'thread.context_compaction_started',
            id: 'comp-start',
            createdAt,
            threadId: ROOT_THREAD_ID,
            trigger,
          },
        },
      },
    ]);
  });

  it('keeps an unpaired compaction after an earlier model message in scope', () => {
    const state = new PeerThreadFoldState();
    ingestTurnEvent(state, modelMessage({ id: 'm1', threadId: ROOT_THREAD_ID, content: 'before' }));
    ingestStreamEvent(state, {
      type: 'thread.context_compaction_started',
      id: 'comp-start',
      createdAt,
      threadId: ROOT_THREAD_ID,
      trigger: { type: 'context_threshold_exceeded', contextTokens: 90_000, thresholdTokens: 80_000 },
    });

    const parts = buildRootAssistantContentForIds(state, ['m1']);
    expect(parts).toHaveLength(2);
    expect(parts[1]).toMatchObject({ type: 'data', name: CONTEXT_COMPACTION_DATA_NAME, data: { status: 'running' } });
  });

  it('pairs compaction with the model message emitted after it even when ids sort the other way', () => {
    const state = new PeerThreadFoldState();
    const trigger = { type: 'context_threshold_exceeded' as const, contextTokens: 3460, thresholdTokens: 1000 };
    // Model message id is allocated before compaction runs, but it is emitted last.
    ingestTurnEvent(state, {
      ...modelMessage({ id: 'm-a', threadId: ROOT_THREAD_ID, content: 'after' }),
      createdAt: '2026-10-26T12:53:01.719Z',
    });
    ingestStreamEvent(state, {
      type: 'thread.context_compaction_started',
      id: 'comp-b',
      createdAt: '2026-10-26T12:52:52.306Z',
      threadId: ROOT_THREAD_ID,
      trigger,
    });
    ingestStreamEvent(state, {
      type: 'thread.context_compaction_finished',
      id: 'comp-c',
      createdAt: '2026-10-26T12:52:59.131Z',
      threadId: ROOT_THREAD_ID,
      trigger,
      durationMs: 6824,
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    const parts = buildRootAssistantContentForIds(state, ['m-a']);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatchObject({ type: 'data', name: CONTEXT_COMPACTION_DATA_NAME, data: { status: 'complete' } });
    expect(parts[1]).toEqual({ type: 'text', text: 'after' });
  });

  it('does not attach a later compaction to an already finished turn', () => {
    const state = new PeerThreadFoldState();
    ingestTurnEvent(state, {
      ...modelMessage({ id: 'm1', threadId: ROOT_THREAD_ID, content: 'turn one' }),
      createdAt: '2026-10-26T12:52:46.767Z',
    });
    ingestStreamEvent(state, {
      type: 'thread.context_compaction_started',
      id: 'comp-next',
      createdAt: '2026-10-26T12:52:52.306Z',
      threadId: ROOT_THREAD_ID,
      trigger: { type: 'context_threshold_exceeded', contextTokens: 3460, thresholdTokens: 1000 },
    });

    state.settledTurnCompletedAtMs = Date.parse('2026-10-26T12:52:46.773Z');
    expect(buildRootAssistantContentForIds(state, ['m1'])).toEqual([{ type: 'text', text: 'turn one' }]);
  });

  it('does not attach a later compaction to a finished turn that had no model message', () => {
    const state = new PeerThreadFoldState();
    ingestStreamEvent(state, {
      type: 'thread.context_compaction_started',
      id: 'comp-next',
      createdAt: '2026-10-26T12:52:52.306Z',
      threadId: ROOT_THREAD_ID,
      trigger: { type: 'context_threshold_exceeded', contextTokens: 3460, thresholdTokens: 1000 },
    });

    state.settledTurnCompletedAtMs = Date.parse('2026-10-26T12:52:46.773Z');
    expect(buildRootAssistantContentForIds(state, [])).toEqual([]);
  });

  it('maps toolCallIds to the model.message that first emitted them', () => {
    const state = new PeerThreadFoldState();
    ingestTurnEvent(
      state,
      modelMessage({
        id: 'm-batch',
        threadId: ROOT_THREAD_ID,
        toolCalls: [
          {
            id: 't1',
            type: 'function',
            function: { name: 'list_teams_for_user', arguments: '{}' },
          },
          {
            id: 't2',
            type: 'function',
            function: { name: 'get_manifest_json_schema', arguments: '{}' },
          },
          {
            id: 't3',
            type: 'function',
            function: { name: 'check_user_registration', arguments: '{}' },
          },
          {
            id: 'spawn-1',
            type: 'function',
            function: { name: 'create_sub_agent', arguments: '{}' },
            toolInfo: { type: 'trueforge-system', name: 'create_sub_agent' },
          },
        ],
      }),
    );
    ingestTurnEvent(
      state,
      modelMessage({
        id: 'm-later',
        threadId: ROOT_THREAD_ID,
        toolCalls: [
          {
            id: 't4',
            type: 'function',
            function: { name: 'validate_manifest', arguments: '{}' },
          },
        ],
      }),
    );

    const { parallelToolGroups } = buildRootAssistantFoldForIds(state, ['m-batch', 'm-later']);
    expect(parallelToolGroups).toEqual({
      t1: 'm-batch',
      t2: 'm-batch',
      t3: 'm-batch',
      'spawn-1': 'm-batch',
      t4: 'm-later',
    });
  });

  it('keeps the first model.message id when a toolCallId is re-emitted later', () => {
    const state = new PeerThreadFoldState();
    ingestTurnEvent(
      state,
      modelMessage({
        id: 'm-first',
        threadId: ROOT_THREAD_ID,
        toolCalls: [
          {
            id: 'tool-1',
            type: 'function',
            function: { name: 'search_docs', arguments: '{}' },
          },
        ],
      }),
    );
    ingestTurnEvent(
      state,
      modelMessage({
        id: 'm-resume',
        threadId: ROOT_THREAD_ID,
        toolCalls: [
          {
            id: 'tool-1',
            type: 'function',
            function: { name: 'search_docs', arguments: '{"q":"x"}' },
          },
        ],
      }),
    );

    const { parallelToolGroups, parts } = buildRootAssistantFoldForIds(state, ['m-first', 'm-resume']);
    expect(parallelToolGroups).toEqual({ 'tool-1': 'm-first' });
    expect(parts.filter(part => part.type === 'tool-call')).toHaveLength(1);
  });

  it('stamps parallelToolGroups onto nested sub-agent messages', () => {
    const state = new PeerThreadFoldState();
    ingestTurnEvent(
      state,
      modelMessage({
        id: 'root-msg',
        threadId: ROOT_THREAD_ID,
        toolCalls: [
          {
            id: 'spawn-1',
            type: 'function',
            function: { name: 'create_sub_agent', arguments: '{}' },
            toolInfo: { type: 'trueforge-system', name: 'create_sub_agent' },
          },
        ],
      }),
    );
    ingestTurnEvent(
      state,
      threadCreated({
        id: 't-created',
        threadId: 'child-1',
        title: 'Worker',
        agentInfo: { type: 'dynamic', name: 'worker', input: 'go' },
        parent: { threadId: ROOT_THREAD_ID, toolCallId: 'spawn-1' },
      }),
    );
    ingestTurnEvent(
      state,
      modelMessage({
        id: 'child-batch',
        threadId: 'child-1',
        toolCalls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'get_session_context', arguments: '{}' },
          },
          {
            id: 'c2',
            type: 'function',
            function: { name: 'get_manifest_json_schema', arguments: '{}' },
          },
        ],
      }),
    );

    const spawn = buildRootAssistantContent(state).find(part => part.type === 'tool-call');
    if (spawn?.type !== 'tool-call') {
      throw new Error('expected create_sub_agent tool-call');
    }
    const nested = spawn.messages?.[0];
    expect(nested?.metadata.custom['parallelToolGroups']).toEqual({
      c1: 'child-batch',
      c2: 'child-batch',
    });
  });
});
