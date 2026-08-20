import {
  lifecycleHooks,
  type LifecycleHookRunner,
  type LifecycleHookToolCall,
  type LifecycleHookToolResult,
} from '../../../../src/core/capabilities/builtins/LifecycleHooks';
import type { ApprovalDecision } from '../../../../src/core/events/schema';
import {
  isCallToolResponseResult,
  toolResultResponse,
  type CallToolResponse,
  type IToolSet,
  type ListToolsResponse,
} from '../../../../src/core/mcp/IMCPServer';

function makeInnerToolSet(overrides?: { callTool?: IToolSet['callTool'] }): IToolSet {
  return {
    name: 'inner',
    id: 'inner-id',
    description: 'inner description',
    preload: true,
    hasPreloadedTools: true,
    listTools: (): Promise<ListToolsResponse> => Promise.resolve({ result: { tools: [] }, wasInitialized: undefined }),
    callTool:
      overrides?.callTool ??
      ((): Promise<CallToolResponse> => Promise.resolve(toolResultResponse({ text: 'inner result' }))),
    toolCallInfo: () => Promise.reject(new Error('not used in this test')),
  };
}

function makeRunner(overrides?: {
  preDecision?: ApprovalDecision;
}): LifecycleHookRunner & { preCalls: LifecycleHookToolCall[]; postCalls: LifecycleHookToolResult[] } {
  const preCalls: LifecycleHookToolCall[] = [];
  const postCalls: LifecycleHookToolResult[] = [];
  return {
    preCalls,
    postCalls,
    preToolUse: call => {
      preCalls.push(call);
      return Promise.resolve(overrides?.preDecision ?? { status: 'allow' });
    },
    postToolUse: result => {
      postCalls.push(result);
      return Promise.resolve();
    },
  };
}

const BOTH_EVENTS = { preToolUse: true, postToolUse: true };

describe('lifecycleHooks', () => {
  it('contributes nothing when no hook point is configured', () => {
    const capability = lifecycleHooks({ runner: makeRunner(), events: { preToolUse: false, postToolUse: false } });
    expect(capability.toolSetDecorators).toBeUndefined();
  });

  it('decorated toolset preserves identity members', () => {
    const capability = lifecycleHooks({ runner: makeRunner(), events: BOTH_EVENTS });
    const decorator = capability.toolSetDecorators?.[0];
    if (!decorator) {
      throw new Error('expected a decorator');
    }
    const wrapped = decorator(makeInnerToolSet());
    expect(wrapped.name).toBe('inner');
    expect(wrapped.id).toBe('inner-id');
    expect(wrapped.description).toBe('inner description');
    expect(wrapped.preload).toBe(true);
    expect(wrapped.hasPreloadedTools).toBe(true);
  });

  it('allow delegates and fires post with the raw result', async () => {
    const runner = makeRunner();
    const decorator = lifecycleHooks({ runner, events: BOTH_EVENTS }).toolSetDecorators?.[0];
    const wrapped = decorator?.(makeInnerToolSet());
    const response = await wrapped?.callTool({ name: 'do_thing', arguments: { key: 'value' } });

    expect(runner.preCalls).toEqual([{ toolName: 'do_thing', toolInput: { key: 'value' } }]);
    if (!response || !isCallToolResponseResult(response)) {
      throw new Error('expected a resolved tool result');
    }
    expect(response.result.content).toEqual([{ type: 'text', text: 'inner result' }]);
    expect(runner.postCalls).toHaveLength(1);
    expect(runner.postCalls[0]?.toolName).toBe('do_thing');
    expect(runner.postCalls[0]?.isError).toBe(false);
    expect(runner.postCalls[0]?.toolResponse).toBe(response.result);
  });

  it('deny blocks the call, returns an error tool result, and skips post', async () => {
    const runner = makeRunner({ preDecision: { status: 'deny', reason: 'policy says no' } });
    let innerCalled = false;
    const inner = makeInnerToolSet({
      callTool: () => {
        innerCalled = true;
        return Promise.resolve(toolResultResponse({ text: 'should not run' }));
      },
    });
    const wrapped = lifecycleHooks({ runner, events: BOTH_EVENTS }).toolSetDecorators?.[0]?.(inner);
    const response = await wrapped?.callTool({ name: 'do_thing', arguments: {} });

    expect(innerCalled).toBe(false);
    if (!response || !isCallToolResponseResult(response)) {
      throw new Error('expected a resolved tool result');
    }
    expect(response.result.isError).toBe(true);
    const text = response.result.content[0]?.type === 'text' ? response.result.content[0].text : '';
    expect(JSON.parse(text)).toEqual({ error: 'Tool call denied by pre_tool_use hook: policy says no' });
    expect(runner.postCalls).toHaveLength(0);
  });

  it('post-only configuration never calls preToolUse', async () => {
    const runner = makeRunner({ preDecision: { status: 'deny', reason: 'must not be consulted' } });
    const wrapped = lifecycleHooks({
      runner,
      events: { preToolUse: false, postToolUse: true },
    }).toolSetDecorators?.[0]?.(makeInnerToolSet());
    const response = await wrapped?.callTool({ name: 'do_thing', arguments: {} });

    expect(runner.preCalls).toHaveLength(0);
    expect(response !== undefined && isCallToolResponseResult(response)).toBe(true);
    expect(runner.postCalls).toHaveLength(1);
  });

  it('a user-denied re-dispatch is not hooked at all', async () => {
    const runner = makeRunner({ preDecision: { status: 'deny', reason: 'must not be consulted' } });
    // Mirrors ToolSet's user-denial short circuit: the inner synthesizes the
    // denial result without executing.
    const inner = makeInnerToolSet({
      callTool: () =>
        Promise.resolve(
          toolResultResponse({ text: JSON.stringify({ error: 'User denied tool call: nope' }), isError: true }),
        ),
    });
    const wrapped = lifecycleHooks({ runner, events: BOTH_EVENTS }).toolSetDecorators?.[0]?.(inner);
    const response = await wrapped?.callTool({ name: 'do_thing', arguments: {} }, { status: 'deny', reason: 'nope' });

    expect(runner.preCalls).toHaveLength(0);
    expect(runner.postCalls).toHaveLength(0);
    if (!response || !isCallToolResponseResult(response)) {
      throw new Error('expected the synthesized denial to pass through');
    }
    expect(response.result.isError).toBe(true);
  });

  it('an empty-string deny reason falls back to the default text', async () => {
    const runner = makeRunner({ preDecision: { status: 'deny', reason: '' } });
    const wrapped = lifecycleHooks({ runner, events: BOTH_EVENTS }).toolSetDecorators?.[0]?.(makeInnerToolSet());
    const response = await wrapped?.callTool({ name: 'do_thing', arguments: {} });
    if (!response || !isCallToolResponseResult(response)) {
      throw new Error('expected a resolved tool result');
    }
    const text = response.result.content[0]?.type === 'text' ? response.result.content[0].text : '';
    expect(JSON.parse(text)).toEqual({ error: 'Tool call denied by pre_tool_use hook: no reason provided' });
  });

  it('post does not fire for non-result sentinels (approval pause)', async () => {
    const runner = makeRunner();
    const inner = makeInnerToolSet({
      callTool: () =>
        Promise.resolve({
          approvalRequired: {
            tool_info: {
              type: 'mcp' as const,
              mcp_server_id: 'inner-id',
              mcp_server_name: 'inner',
              original_tool_name: 'do_thing',
              is_approval_required: true,
            },
          },
        }),
    });
    const wrapped = lifecycleHooks({ runner, events: BOTH_EVENTS }).toolSetDecorators?.[0]?.(inner);
    const response = await wrapped?.callTool({ name: 'do_thing', arguments: {} });

    expect(runner.preCalls).toHaveLength(1);
    expect(response !== undefined && 'approvalRequired' in response).toBe(true);
    expect(runner.postCalls).toHaveLength(0);
  });
});
