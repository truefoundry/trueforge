/**
 * Lifecycle hooks through the real AgentThread tool flow. Regression coverage
 * for deferred tools: a call routed through the call_tool meta-tool must reach
 * hooks with the REAL underlying tool identity (the DeferredTool's underlying
 * servers are decorated at construction) AND as the meta-invocation itself
 * (the proxy is decorated too, covering list_tools/get_tool_info/…).
 */
import {
  lifecycleHooks,
  type LifecycleHookRunner,
  type LifecycleHookToolCall,
  type LifecycleHookToolResult,
} from '../../../src/core/capabilities/builtins/LifecycleHooks';
import type { ILLM } from '../../../src/core/llm/ILLM';
import type { ExtendedChatCompletionChunk, RawAssistantMessageWithUsage } from '../../../src/core/llm/LLMTypes';
import { getEmptyUsage } from '../../../src/core/llm/LLMTypes';
import { toolResultResponse, type IToolSet, type ListToolsResponse } from '../../../src/core/mcp/IMCPServer';
import { AgentThread } from '../../../src/core/runtime/AgentThread';
import { NOOP_AGENT_TRACING } from '../../../src/core/tracing/NoopAgentTracing';
import { makeSilentLogger } from '../harnessMocks';

const silentLogger = makeSilentLogger();

function makeDeferredServer(): IToolSet & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    name: 'srv',
    id: 'srv',
    preload: false,
    hasPreloadedTools: false,
    listTools: (): Promise<ListToolsResponse> =>
      Promise.resolve({
        result: {
          tools: [
            { name: 'real_tool', description: 'does the thing', inputSchema: { type: 'object' }, preload: false },
          ],
        },
        wasInitialized: undefined,
      }),
    callTool: params => {
      calls.push(params.name);
      return Promise.resolve(toolResultResponse({ text: 'did it' }));
    },
    toolCallInfo: params =>
      Promise.resolve({
        type: 'mcp',
        mcp_server_id: 'srv',
        mcp_server_name: 'srv',
        original_tool_name: params.name,
      }),
  };
}

function makeRecordingRunner(): LifecycleHookRunner & {
  preCalls: LifecycleHookToolCall[];
  postCalls: LifecycleHookToolResult[];
} {
  const preCalls: LifecycleHookToolCall[] = [];
  const postCalls: LifecycleHookToolResult[] = [];
  return {
    preCalls,
    postCalls,
    preToolUse: call => {
      preCalls.push(call);
      return Promise.resolve({ status: 'allow' });
    },
    postToolUse: result => {
      postCalls.push(result);
      return Promise.resolve();
    },
  };
}

// eslint-disable-next-line @typescript-eslint/require-await -- async generator fixture, not awaiting I/O
async function* callToolStream(): AsyncGenerator<ExtendedChatCompletionChunk, RawAssistantMessageWithUsage, unknown> {
  const args = JSON.stringify({ mcp_server: 'srv', tool_name: 'real_tool', input: { x: 1 } });
  yield {
    id: 'chunk-1',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test-model',
    choices: [
      {
        index: 0,
        delta: {
          role: 'assistant',
          tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'call_tool', arguments: args } }],
        },
        finish_reason: 'tool_calls',
      },
    ],
  };
  return {
    output: {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'call_tool', arguments: args } }],
    },
    usage: getEmptyUsage(),
    finish_reason: 'tool_calls',
  };
}

// eslint-disable-next-line @typescript-eslint/require-await -- async generator fixture, not awaiting I/O
async function* finalStream(): AsyncGenerator<ExtendedChatCompletionChunk, RawAssistantMessageWithUsage, unknown> {
  yield {
    id: 'chunk-2',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test-model',
    choices: [{ index: 0, delta: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
  };
  return { output: { role: 'assistant', content: 'done' }, usage: getEmptyUsage(), finish_reason: 'stop' };
}

describe('lifecycleHooks through the AgentThread tool flow', () => {
  it('a deferred call_tool dispatch hooks both the meta-invocation and the real underlying tool', async () => {
    const modelClient: ILLM = {
      create: jest
        .fn()
        .mockImplementationOnce(() => callToolStream())
        .mockImplementation(() => finalStream()),
      createNonStream: jest.fn(),
    };
    const server = makeDeferredServer();
    const runner = makeRecordingRunner();

    const thread = new AgentThread({
      threadId: 'main',
      title: 'Main',
      tracing: NOOP_AGENT_TRACING,
      logger: silentLogger,
      definition: {
        modelClient,
        instruction: 'test',
        toolSets: [server],
      },
      context: [{ role: 'user', content: 'hi' }],
      capabilities: [lifecycleHooks({ runner, events: { preToolUse: true, postToolUse: true } })],
    });

    for await (const event of thread.execute({ signal: new AbortController().signal })) {
      void event;
    }

    // The underlying tool executed once; pre fires outermost-first (meta then
    // real), post fires as each call resolves (real then meta).
    expect(server.calls).toEqual(['real_tool']);
    expect(runner.preCalls).toEqual([
      { toolName: 'call_tool', toolInput: { mcp_server: 'srv', tool_name: 'real_tool', input: { x: 1 } } },
      { toolName: 'real_tool', toolInput: { x: 1 } },
    ]);
    expect(runner.postCalls.map(post => post.toolName)).toEqual(['real_tool', 'call_tool']);
    expect(runner.postCalls[0]?.isError).toBe(false);
  });
});
