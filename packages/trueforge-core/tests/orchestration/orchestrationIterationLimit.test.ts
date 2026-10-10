import { EventType } from '../../src/core/events/schema';
import type { ILLM } from '../../src/core/llm/ILLM';
import type {
  CompletionUsage,
  ExtendedChatCompletionChunk,
  RawAssistantMessageWithUsage,
} from '../../src/core/llm/LLMTypes';
import { getEmptyUsage } from '../../src/core/llm/LLMTypes';
import type { IToolSet } from '../../src/core/mcp/IMCPServer';
import { toolResultResponse } from '../../src/core/mcp/IMCPServer';
import { AgentThread } from '../../src/core/runtime/AgentThread';
import { AgentThreadOrchestrator } from '../../src/core/runtime/AgentThreadOrchestrator';
import { NOOP_AGENT_TRACING } from '../../src/core/tracing/NoopAgentTracing';
import { makeSilentLogger, OBJECT_INPUT_SCHEMA } from '../core/harnessMocks';
import { llmCreateInputs, runTurn, textReplyStream } from './helpers/helpers';

const THREAD_ID = 'main';
const INSTRUCTION = 'You are running in a test setup.';
const TOOL_NAME = 'test_tool';

function makeMockToolSet(name: string, toolName: string): IToolSet {
  return {
    name,
    id: name,
    preload: true,
    hasPreloadedTools: true,
    listTools: jest.fn().mockResolvedValue({
      result: {
        tools: [{ name: toolName, description: 'mock tool', inputSchema: OBJECT_INPUT_SCHEMA, preload: true }],
      },
    }),
    callTool: jest.fn().mockResolvedValue(toolResultResponse({ text: 'ok' })),
    toolCallInfo: jest.fn().mockResolvedValue({
      type: 'mcp',
      original_tool_name: toolName,
      mcp_server_id: name,
      mcp_server_name: name,
      is_approval_required: false,
      is_client_side: false,
    }),
    setApprovalPolicy: jest.fn(),
    getApprovalPolicies: jest.fn(() => ({})),
  };
}

// eslint-disable-next-line @typescript-eslint/require-await -- async generator fixture
async function* mockToolCallStream(toolName: string, callId: string) {
  yield {
    id: 'chunk-tool',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test-model',
    choices: [
      {
        index: 0,
        delta: {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: callId,
              type: 'function',
              function: {
                name: toolName,
                arguments: '{}',
              },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
  };

  return {
    output: {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: callId,
          type: 'function',
          function: {
            name: toolName,
            arguments: '{}',
          },
        },
      ],
    },
    usage: getEmptyUsage(),
    finish_reason: 'tool_calls',
  };
}

// eslint-disable-next-line @typescript-eslint/require-await -- async generator fixture
async function* lengthFinishStream(
  usage?: CompletionUsage,
): AsyncGenerator<ExtendedChatCompletionChunk, RawAssistantMessageWithUsage, unknown> {
  yield {
    id: 'chunk-length',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test-model',
    choices: [
      {
        index: 0,
        delta: { role: 'assistant', content: 'partial text' },
        finish_reason: 'length',
      },
    ],
    usage: usage ?? null,
  };

  return {
    output: { role: 'assistant', content: 'partial text' },
    usage: usage ?? getEmptyUsage(),
    finish_reason: 'length',
  };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasMessagesArray(value: unknown): value is { messages: { role: string; content?: unknown }[] } {
  return isJsonObject(value) && Array.isArray(value['messages']);
}

describe('orchestration: iteration limit and length error handling', () => {
  it('appends exactly one wrap-up internal message when iteration limit is 5 before the last reserve calls', async () => {
    let callCounter = 0;
    const toolSet = makeMockToolSet('mock_server', TOOL_NAME);
    const mockLLM: ILLM = {
      create: jest.fn().mockImplementation(() => {
        callCounter++;
        return mockToolCallStream(TOOL_NAME, `call-${callCounter}`);
      }),
      createNonStream: jest.fn(),
    };

    const thread = new AgentThread({
      definition: {
        modelClient: mockLLM,
        instruction: INSTRUCTION,
        iterationLimit: 5,
        toolSets: [toolSet],
      },
      threadId: THREAD_ID,
      title: 'iteration-limit-test',
      tracing: NOOP_AGENT_TRACING,
      logger: makeSilentLogger(),
    });

    const orchestrator = new AgentThreadOrchestrator({
      agentThreads: new Map([[thread.threadId, thread]]),
      createDynamicSubAgentThread: () => Promise.reject(new Error('unexpected sub-agent')),
      tracing: NOOP_AGENT_TRACING,
      logger: makeSilentLogger(),
    });

    const { result } = await runTurn({
      orchestrator,
      sendBatch: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
    });

    expect(result.root_agent_error?.error).toBe('You have reached iteration limit of 5, please request again');

    const inputs = llmCreateInputs(mockLLM).filter(hasMessagesArray);
    expect(inputs).toHaveLength(5);

    // Call 0 (iteration 0): no nudge
    expect(
      inputs[0]?.messages.some(m => typeof m.content === 'string' && m.content.includes('LLM calls remaining')),
    ).toBe(false);

    // Call 1 (iteration 1): no nudge
    expect(
      inputs[1]?.messages.some(m => typeof m.content === 'string' && m.content.includes('LLM calls remaining')),
    ).toBe(false);

    // Call 2 (iteration 2, remaining = 3 = reserve): wrap-up nudge fires!
    expect(
      inputs[2]?.messages.some(m => typeof m.content === 'string' && m.content.includes('3 LLM calls remaining')),
    ).toBe(true);

    // Calls 3 & 4: nudge remains in context
    expect(
      inputs[3]?.messages.some(m => typeof m.content === 'string' && m.content.includes('3 LLM calls remaining')),
    ).toBe(true);
    expect(
      inputs[4]?.messages.some(m => typeof m.content === 'string' && m.content.includes('3 LLM calls remaining')),
    ).toBe(true);
  });

  it('skips wrap-up message when iterationLimit is 1', async () => {
    const toolSet = makeMockToolSet('mock_server', TOOL_NAME);
    const mockLLM: ILLM = {
      create: jest.fn().mockImplementation(() => mockToolCallStream(TOOL_NAME, 'call-1')),
      createNonStream: jest.fn(),
    };

    const thread = new AgentThread({
      definition: {
        modelClient: mockLLM,
        instruction: INSTRUCTION,
        iterationLimit: 1,
        toolSets: [toolSet],
      },
      threadId: THREAD_ID,
      title: 'iteration-limit-1-test',
      tracing: NOOP_AGENT_TRACING,
      logger: makeSilentLogger(),
    });

    const orchestrator = new AgentThreadOrchestrator({
      agentThreads: new Map([[thread.threadId, thread]]),
      createDynamicSubAgentThread: () => Promise.reject(new Error('unexpected sub-agent')),
      tracing: NOOP_AGENT_TRACING,
      logger: makeSilentLogger(),
    });

    const { result } = await runTurn({
      orchestrator,
      sendBatch: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
    });

    expect(result.root_agent_error?.error).toBe('You have reached iteration limit of 1, please request again');

    const inputs = llmCreateInputs(mockLLM).filter(hasMessagesArray);
    expect(inputs).toHaveLength(1);
    expect(
      inputs[0]?.messages.some(m => typeof m.content === 'string' && m.content.includes('LLM calls remaining')),
    ).toBe(false);
  });

  it('skips wrap-up message when turn finishes before reserve', async () => {
    const mockLLM: ILLM = {
      create: jest.fn().mockImplementation(() => textReplyStream('quick reply')),
      createNonStream: jest.fn(),
    };

    const thread = new AgentThread({
      definition: {
        modelClient: mockLLM,
        instruction: INSTRUCTION,
        iterationLimit: 5,
      },
      threadId: THREAD_ID,
      title: 'early-finish-test',
      tracing: NOOP_AGENT_TRACING,
      logger: makeSilentLogger(),
    });

    const orchestrator = new AgentThreadOrchestrator({
      agentThreads: new Map([[thread.threadId, thread]]),
      createDynamicSubAgentThread: () => Promise.reject(new Error('unexpected sub-agent')),
      tracing: NOOP_AGENT_TRACING,
      logger: makeSilentLogger(),
    });

    const { result } = await runTurn({
      orchestrator,
      sendBatch: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
    });

    expect(result.root_agent_error).toBeUndefined();

    const inputs = llmCreateInputs(mockLLM).filter(hasMessagesArray);
    expect(inputs).toHaveLength(1);
    expect(
      inputs[0]?.messages.some(m => typeof m.content === 'string' && m.content.includes('LLM calls remaining')),
    ).toBe(false);
  });

  it('includes budget hint when finish_reason is length with large reasoning usage', async () => {
    const usage: CompletionUsage = {
      input_tokens: 100,
      output_tokens: 1000,
      total_tokens: 1100,
      reasoning_tokens: 800,
    };
    const mockLLM: ILLM = {
      create: jest.fn().mockImplementation(() => lengthFinishStream(usage)),
      createNonStream: jest.fn(),
    };

    const thread = new AgentThread({
      definition: {
        modelClient: mockLLM,
        instruction: INSTRUCTION,
      },
      threadId: THREAD_ID,
      title: 'reasoning-length-test',
      tracing: NOOP_AGENT_TRACING,
      logger: makeSilentLogger(),
    });

    const orchestrator = new AgentThreadOrchestrator({
      agentThreads: new Map([[thread.threadId, thread]]),
      createDynamicSubAgentThread: () => Promise.reject(new Error('unexpected sub-agent')),
      tracing: NOOP_AGENT_TRACING,
      logger: makeSilentLogger(),
    });

    const { result } = await runTurn({
      orchestrator,
      sendBatch: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
    });

    expect(result.root_agent_error?.error).toBe(
      'max_tokens breached: output budget was exhausted by reasoning tokens. Consider increasing model.params.max_tokens or adjusting reasoning_effort.',
    );
  });

  it('keeps old wording when finish_reason is length without reasoning usage', async () => {
    const usage: CompletionUsage = {
      input_tokens: 100,
      output_tokens: 1000,
      total_tokens: 1100,
    };
    const mockLLM: ILLM = {
      create: jest.fn().mockImplementation(() => lengthFinishStream(usage)),
      createNonStream: jest.fn(),
    };

    const thread = new AgentThread({
      definition: {
        modelClient: mockLLM,
        instruction: INSTRUCTION,
      },
      threadId: THREAD_ID,
      title: 'no-reasoning-length-test',
      tracing: NOOP_AGENT_TRACING,
      logger: makeSilentLogger(),
    });

    const orchestrator = new AgentThreadOrchestrator({
      agentThreads: new Map([[thread.threadId, thread]]),
      createDynamicSubAgentThread: () => Promise.reject(new Error('unexpected sub-agent')),
      tracing: NOOP_AGENT_TRACING,
      logger: makeSilentLogger(),
    });

    const { result } = await runTurn({
      orchestrator,
      sendBatch: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
    });

    expect(result.root_agent_error?.error).toBe('max_tokens breached');
  });

  it('resets iteration count per turn when fresh AgentThread is built from previous snapshot context', async () => {
    let callCounter = 0;
    const toolSet = makeMockToolSet('mock_server', TOOL_NAME);
    const mockLLM: ILLM = {
      create: jest.fn().mockImplementation(() => {
        callCounter++;
        // Turn 1 calls 1 & 2: return tool call
        if (callCounter <= 2) {
          return mockToolCallStream(TOOL_NAME, `call-${callCounter}`);
        }
        // Turn 1 call 3: finish turn 1
        if (callCounter === 3) {
          return textReplyStream('turn 1 done');
        }
        // Turn 2 calls 4 & 5: return tool call
        if (callCounter <= 5) {
          return mockToolCallStream(TOOL_NAME, `call-${callCounter}`);
        }
        // Turn 2 call 6: finish turn 2
        return textReplyStream('turn 2 done');
      }),
      createNonStream: jest.fn(),
    };

    const thread1 = new AgentThread({
      definition: {
        modelClient: mockLLM,
        instruction: INSTRUCTION,
        iterationLimit: 5,
        toolSets: [toolSet],
      },
      threadId: THREAD_ID,
      title: 'multi-turn-test',
      tracing: NOOP_AGENT_TRACING,
      logger: makeSilentLogger(),
    });

    const orchestrator1 = new AgentThreadOrchestrator({
      agentThreads: new Map([[thread1.threadId, thread1]]),
      createDynamicSubAgentThread: () => Promise.reject(new Error('unexpected sub-agent')),
      tracing: NOOP_AGENT_TRACING,
      logger: makeSilentLogger(),
    });

    // Turn 1
    await runTurn({
      orchestrator: orchestrator1,
      sendBatch: [{ type: EventType.USER_MESSAGE, content: 'turn 1' }],
    });

    // Turn 2: built from previous turn snapshot (mirroring SessionHandle.buildThread)
    const thread2 = new AgentThread({
      definition: {
        modelClient: mockLLM,
        instruction: INSTRUCTION,
        iterationLimit: 5,
        toolSets: [toolSet],
      },
      threadId: THREAD_ID,
      title: 'multi-turn-test',
      context: thread1.toSnapshot().context,
      tracing: NOOP_AGENT_TRACING,
      logger: makeSilentLogger(),
    });

    const orchestrator2 = new AgentThreadOrchestrator({
      agentThreads: new Map([[thread2.threadId, thread2]]),
      createDynamicSubAgentThread: () => Promise.reject(new Error('unexpected sub-agent')),
      tracing: NOOP_AGENT_TRACING,
      logger: makeSilentLogger(),
    });

    await runTurn({
      orchestrator: orchestrator2,
      sendBatch: [{ type: EventType.USER_MESSAGE, content: 'turn 2' }],
    });

    const inputs = llmCreateInputs(mockLLM).filter(hasMessagesArray);
    const countNudges = (msgList: { content?: unknown }[]) =>
      msgList.filter(m => typeof m.content === 'string' && m.content.includes('LLM calls remaining')).length;

    // Turn 1 calls 0 & 1: 0 nudge messages in context
    expect(countNudges(inputs[0]?.messages ?? [])).toBe(0);
    expect(countNudges(inputs[1]?.messages ?? [])).toBe(0);

    // Turn 1 call 2 (index 2): 1st wrap-up nudge added to context
    expect(countNudges(inputs[2]?.messages ?? [])).toBe(1);

    // Turn 2 call 0 & 1 (index 3 & 4): turn 2 starts (fresh instance starts at iterations = 0), carries 1st nudge from history
    expect(countNudges(inputs[3]?.messages ?? [])).toBe(1);
    expect(countNudges(inputs[4]?.messages ?? [])).toBe(1);

    // Turn 2 call 2 (index 5): 2nd wrap-up nudge added on turn 2 reserve step!
    expect(countNudges(inputs[5]?.messages ?? [])).toBe(2);
  });
});
