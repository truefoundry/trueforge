import type { AgentCapability } from '../../src/core/capabilities/AgentCapability';
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
import type { ContextMessage } from '../../src/core/runtime/AgentThread.types';
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

function createTestSetup(options?: {
  iterationLimit?: number | undefined;
  toolSets?: IToolSet[] | undefined;
  capabilities?: AgentCapability[] | undefined;
  context?: ContextMessage[] | undefined;
  instruction?: string | undefined;
  mockLLM?: ILLM | undefined;
}) {
  const toolSet = options?.toolSets ?? [makeMockToolSet('mock_server', TOOL_NAME)];
  const llm: ILLM = options?.mockLLM ?? {
    create: jest.fn(),
    createNonStream: jest.fn(),
  };

  const thread = new AgentThread({
    definition: {
      modelClient: llm,
      instruction: options?.instruction ?? INSTRUCTION,
      ...(options?.iterationLimit !== undefined ? { iterationLimit: options.iterationLimit } : {}),
      ...(toolSet ? { toolSets: toolSet } : {}),
    },
    threadId: THREAD_ID,
    title: 'iteration-limit-test',
    ...(options?.context ? { context: options.context } : {}),
    ...(options?.capabilities ? { capabilities: options.capabilities } : {}),
    tracing: NOOP_AGENT_TRACING,
    logger: makeSilentLogger(),
  });

  const orchestrator = new AgentThreadOrchestrator({
    agentThreads: new Map([[thread.threadId, thread]]),
    createDynamicSubAgentThread: () => Promise.reject(new Error('unexpected sub-agent')),
    tracing: NOOP_AGENT_TRACING,
    logger: makeSilentLogger(),
  });

  return { thread, orchestrator, mockLLM: llm };
}

describe('orchestration: iteration limit and length error handling', () => {
  it('ephemerally includes wrap-up internal message on exactly the last 3 requests when iteration limit is 5', async () => {
    let callCounter = 0;
    const mockLLM: ILLM = {
      create: jest.fn().mockImplementation(() => {
        callCounter++;
        return mockToolCallStream(TOOL_NAME, `call-${String(callCounter)}`);
      }),
      createNonStream: jest.fn(),
    };

    const { thread, orchestrator } = createTestSetup({ iterationLimit: 5, mockLLM });

    const { result } = await runTurn({
      orchestrator,
      sendBatch: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
    });

    expect(result.root_agent_error?.error).toBe('You have reached iteration limit of 5, please request again');

    const inputs = llmCreateInputs(mockLLM).filter(hasMessagesArray);
    expect(inputs).toHaveLength(5);

    // Call 1 (index 0): no nudge
    expect(
      inputs[0]?.messages.some(m => typeof m.content === 'string' && m.content.includes('LLM calls remaining')),
    ).toBe(false);

    // Call 2 (index 1): no nudge
    expect(
      inputs[1]?.messages.some(m => typeof m.content === 'string' && m.content.includes('LLM calls remaining')),
    ).toBe(false);

    // Call 3 (index 2, 3 calls remaining including this one): wrap-up nudge present
    expect(
      inputs[2]?.messages.some(
        m =>
          typeof m.content === 'string' && m.content.includes('3 LLM calls remaining in this turn, including this one'),
      ),
    ).toBe(true);

    // Call 4 (index 3, 2 calls remaining including this one): wrap-up nudge present
    expect(
      inputs[3]?.messages.some(
        m =>
          typeof m.content === 'string' && m.content.includes('2 LLM calls remaining in this turn, including this one'),
      ),
    ).toBe(true);

    // Call 5 (index 4, 1 call remaining including this one): wrap-up nudge present
    expect(
      inputs[4]?.messages.some(
        m =>
          typeof m.content === 'string' && m.content.includes('1 LLM calls remaining in this turn, including this one'),
      ),
    ).toBe(true);

    // Verify warning is NOT in thread.toSnapshot().context
    const snapshotContext = thread.toSnapshot().context;
    const hasNudgeInSnapshot = snapshotContext.some(
      m => 'content' in m && typeof m.content === 'string' && m.content.includes('LLM calls remaining'),
    );
    expect(hasNudgeInSnapshot).toBe(false);
  });

  it('does not leak wrap-up message to snapshot context or follow-up turns until reserve', async () => {
    let callCounter = 0;
    const mockLLM: ILLM = {
      create: jest.fn().mockImplementation(() => {
        callCounter++;
        if (callCounter <= 4) {
          return mockToolCallStream(TOOL_NAME, `call-${String(callCounter)}`);
        }
        return textReplyStream('turn 1 done');
      }),
      createNonStream: jest.fn(),
    };

    const { thread: thread1, orchestrator: orchestrator1 } = createTestSetup({ iterationLimit: 5, mockLLM });

    await runTurn({
      orchestrator: orchestrator1,
      sendBatch: [{ type: EventType.USER_MESSAGE, content: 'turn 1' }],
    });

    const snapshotContext = thread1.toSnapshot().context;
    const hasNudgeInSnapshot = snapshotContext.some(
      m => 'content' in m && typeof m.content === 'string' && m.content.includes('LLM calls remaining'),
    );
    expect(hasNudgeInSnapshot).toBe(false);

    let turn2CallCounter = 0;
    const mockLLM2: ILLM = {
      create: jest.fn().mockImplementation(() => {
        turn2CallCounter++;
        return mockToolCallStream(TOOL_NAME, `turn2-call-${String(turn2CallCounter)}`);
      }),
      createNonStream: jest.fn(),
    };

    const { orchestrator: orchestrator2 } = createTestSetup({
      iterationLimit: 5,
      context: snapshotContext,
      mockLLM: mockLLM2,
    });

    await runTurn({
      orchestrator: orchestrator2,
      sendBatch: [{ type: EventType.USER_MESSAGE, content: 'turn 2' }],
    });

    const inputs2 = llmCreateInputs(mockLLM2).filter(hasMessagesArray);
    expect(inputs2).toHaveLength(5);

    // Turn 2 calls 1 & 2: NO warning
    expect(
      inputs2[0]?.messages.some(m => typeof m.content === 'string' && m.content.includes('LLM calls remaining')),
    ).toBe(false);
    expect(
      inputs2[1]?.messages.some(m => typeof m.content === 'string' && m.content.includes('LLM calls remaining')),
    ).toBe(false);

    // Turn 2 call 3: HAS warning with count 3
    expect(
      inputs2[2]?.messages.some(
        m =>
          typeof m.content === 'string' && m.content.includes('3 LLM calls remaining in this turn, including this one'),
      ),
    ).toBe(true);
  });

  it('retains wrap-up warning in request body when ContextCompaction overwrites context on reserve call', async () => {
    let callCounter = 0;
    const mockLLM: ILLM = {
      create: jest.fn().mockImplementation(() => {
        callCounter++;
        return mockToolCallStream(TOOL_NAME, `call-${String(callCounter)}`);
      }),
      createNonStream: jest.fn(),
    };

    const mockCompactionProcessor = {
      processPreLLM: jest.fn().mockImplementation(async function* () {
        // preLLM for call 3 runs when callCounter is 2 (from previous 2 completed calls)
        if (callCounter === 2) {
          yield {
            type: EventType.AGENT_CONTEXT_OVERWRITE,
            id: 'compaction-event',
            created_at: new Date().toISOString(),
            reason: 'compaction',
            context: [{ role: 'assistant', content: 'compacted context summary' }],
            current_context_usage: { prompt_tokens: 10, completion_tokens: 0 },
            usage: getEmptyUsage(),
          };
        }
      }),
    };

    const compactionCapability: AgentCapability = {
      preLLMProcessors: [mockCompactionProcessor],
    };

    const { orchestrator } = createTestSetup({
      iterationLimit: 5,
      mockLLM,
      capabilities: [compactionCapability],
    });

    await runTurn({
      orchestrator,
      sendBatch: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
    });

    const inputs = llmCreateInputs(mockLLM).filter(hasMessagesArray);
    expect(inputs).toHaveLength(5);

    // Call 3 (index 2): ContextCompaction ran in preLLM and overwrote context with 'compacted context summary'
    const call3Messages = inputs[2]?.messages ?? [];
    expect(
      call3Messages.some(m => typeof m.content === 'string' && m.content.includes('compacted context summary')),
    ).toBe(true);

    // AND the wrap-up warning is STILL present in call 3 request messages
    expect(
      call3Messages.some(
        m =>
          typeof m.content === 'string' && m.content.includes('3 LLM calls remaining in this turn, including this one'),
      ),
    ).toBe(true);
  });

  it('skips wrap-up message when iterationLimit is 1', async () => {
    const mockLLM: ILLM = {
      create: jest.fn().mockImplementation(() => mockToolCallStream(TOOL_NAME, 'call-1')),
      createNonStream: jest.fn(),
    };

    const { orchestrator } = createTestSetup({ iterationLimit: 1, mockLLM });

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

    const { orchestrator } = createTestSetup({ iterationLimit: 5, mockLLM });

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

    const { orchestrator } = createTestSetup({ mockLLM });

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

    const { orchestrator } = createTestSetup({ mockLLM });

    const { result } = await runTurn({
      orchestrator,
      sendBatch: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
    });

    expect(result.root_agent_error?.error).toBe('max_tokens breached');
  });
});
