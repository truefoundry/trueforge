import type { ILLM, LLMCreateParamsStreaming } from '../../../src/core/llm/ILLM';
import type {
  ExtendedChatCompletionChunk,
  InternalEnrichedAssistantMessage,
  RawAssistantMessageWithUsage,
} from '../../../src/core/llm/LLMTypes';
import { getEmptyUsage } from '../../../src/core/llm/LLMTypes';
import { ResponseFormatSchema, toOpenAIResponseFormat } from '../../../src/core/llm/responseFormat';
import { toOpenAIChatMessage } from '../../../src/core/llm/toOpenAIChatMessage';
import { AgentThread } from '../../../src/core/runtime/AgentThread';
import { NOOP_AGENT_TRACING } from '../../../src/core/tracing/NoopAgentTracing';
import { makeSilentLogger } from '../harnessMocks';

const toolInfo = {
  type: 'mcp' as const,
  mcp_server_id: 'srv',
  mcp_server_name: 'srv',
  original_tool_name: 'do_thing',
};

/** Assert extension fields that sit outside the OpenAI SDK message type. */
function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function makeAssistantWithReplayFields(): InternalEnrichedAssistantMessage {
  return {
    role: 'assistant',
    content: 'hello',
    thinking_blocks: [
      { type: 'thinking', thinking: 'step one', signature: 'sig-1' },
      { type: 'redacted_thinking', data: 'redacted-blob' },
    ],
    reasoning_content: 'plain reasoning',
    source: 'anthropic/anthropic/opus',
    tool_calls: [
      {
        id: 'call-1',
        type: 'function',
        function: { name: 'do_thing', arguments: '{}' },
        provider_specific_fields: { thought_signature: 'gemini-sig' },
        tool_info: toolInfo,
      },
    ],
  };
}

describe('toOpenAIChatMessage', () => {
  it('preserves thinking_blocks, reasoning_content, and tool-call provider_specific_fields; strips only tool_info', () => {
    const msg = makeAssistantWithReplayFields();
    const mapped = asRecord(toOpenAIChatMessage(msg));

    expect(mapped['role']).toBe('assistant');
    expect(mapped['content']).toBe('hello');
    expect(mapped['thinking_blocks']).toEqual(msg.thinking_blocks);
    expect(mapped['reasoning_content']).toBe('plain reasoning');
    expect(mapped['source']).toBe('anthropic/anthropic/opus');

    const toolCalls = mapped['tool_calls'] as Record<string, unknown>[];
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({
      id: 'call-1',
      type: 'function',
      function: { name: 'do_thing', arguments: '{}' },
      provider_specific_fields: { thought_signature: 'gemini-sig' },
    });
    expect(toolCalls[0]).not.toHaveProperty('tool_info');
  });

  it('omits the tool_calls key when tool_calls is empty or undefined', () => {
    const emptyCalls: InternalEnrichedAssistantMessage = {
      role: 'assistant',
      content: 'no tools',
      thinking_blocks: [{ type: 'thinking', thinking: 't', signature: 's' }],
      tool_calls: [],
    };
    const omitted: InternalEnrichedAssistantMessage = {
      role: 'assistant',
      content: 'no tools',
      reasoning_content: 'r',
    };

    const mappedEmpty = asRecord(toOpenAIChatMessage(emptyCalls));
    const mappedOmitted = asRecord(toOpenAIChatMessage(omitted));

    expect(mappedEmpty).not.toHaveProperty('tool_calls');
    expect(mappedEmpty['thinking_blocks']).toEqual(emptyCalls.thinking_blocks);
    expect(mappedOmitted).not.toHaveProperty('tool_calls');
    expect(mappedOmitted['reasoning_content']).toBe('r');
  });

  it('leaves user and tool messages content intact', () => {
    expect(toOpenAIChatMessage({ role: 'user', content: 'hi' })).toEqual({
      role: 'user',
      content: 'hi',
    });
    expect(toOpenAIChatMessage({ role: 'tool', tool_call_id: 'call-1', content: 'result' })).toEqual({
      role: 'tool',
      tool_call_id: 'call-1',
      content: 'result',
    });
  });
});

describe('toOpenAIResponseFormat', () => {
  it('preserves passthrough extension fields at top level and inside json_schema', () => {
    const format = ResponseFormatSchema.parse({
      type: 'json_schema',
      vendor_ext: 1,
      json_schema: {
        name: 'x',
        schema: { type: 'object' },
        nested_ext: true,
      },
    });

    const mapped = asRecord(toOpenAIResponseFormat(format));
    expect(mapped['type']).toBe('json_schema');
    expect(mapped['vendor_ext']).toBe(1);

    const jsonSchema = asRecord(mapped['json_schema']);
    expect(jsonSchema['name']).toBe('x');
    expect(jsonSchema['nested_ext']).toBe(true);
  });

  it('preserves passthrough fields on text and json_object formats', () => {
    const text = ResponseFormatSchema.parse({ type: 'text', vendor_ext: 'a' });
    const jsonObject = ResponseFormatSchema.parse({ type: 'json_object', vendor_ext: 'b' });

    expect(asRecord(toOpenAIResponseFormat(text))['vendor_ext']).toBe('a');
    expect(asRecord(toOpenAIResponseFormat(jsonObject))['vendor_ext']).toBe('b');
  });
});

describe('AgentThread LLM request mapping (end-to-end)', () => {
  // eslint-disable-next-line @typescript-eslint/require-await -- async generator fixture, not awaiting I/O
  async function* finalAnswerStream(): AsyncGenerator<
    ExtendedChatCompletionChunk,
    RawAssistantMessageWithUsage,
    unknown
  > {
    yield {
      id: 'chunk-1',
      object: 'chat.completion.chunk',
      created: 0,
      model: 'test-model',
      choices: [{ index: 0, delta: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
    };
    return {
      output: { role: 'assistant', content: 'done' },
      usage: getEmptyUsage(),
      finish_reason: 'stop',
    };
  }

  it('forwards thinking_blocks, reasoning_content, and provider_specific_fields; strips tool_info', async () => {
    let capturedBody: LLMCreateParamsStreaming | undefined;
    const modelClient: ILLM = {
      create: jest.fn().mockImplementation((body: LLMCreateParamsStreaming) => {
        capturedBody = body;
        return finalAnswerStream();
      }),
      createNonStream: jest.fn(),
    };

    const assistant = makeAssistantWithReplayFields();
    const thread = new AgentThread({
      threadId: 'main',
      title: 'Main',
      tracing: NOOP_AGENT_TRACING,
      logger: makeSilentLogger(),
      definition: {
        modelClient,
        instruction: 'test',
        toolSets: [],
        responseFormat: ResponseFormatSchema.parse({
          type: 'json_schema',
          vendor_ext: 42,
          json_schema: { name: 'out', nested_ext: 'keep' },
        }),
      },
      // Prior-turn assistant in context — must be replayed with gateway semantics.
      context: [{ role: 'user', content: 'prev' }, assistant],
    });

    for await (const event of thread.execute({ signal: new AbortController().signal })) {
      void event;
    }

    expect(capturedBody).toBeDefined();
    const messages = capturedBody?.messages ?? [];
    const replayed = messages.map(m => asRecord(m)).find(m => m['role'] === 'assistant' && 'thinking_blocks' in m);
    expect(replayed).toBeDefined();
    expect(replayed?.['thinking_blocks']).toEqual(assistant.thinking_blocks);
    expect(replayed?.['reasoning_content']).toBe('plain reasoning');

    const toolCalls = replayed?.['tool_calls'] as Record<string, unknown>[] | undefined;
    expect(toolCalls?.[0]).toMatchObject({
      provider_specific_fields: { thought_signature: 'gemini-sig' },
    });
    expect(toolCalls?.[0]).not.toHaveProperty('tool_info');

    const responseFormat = asRecord(capturedBody?.response_format);
    expect(responseFormat['vendor_ext']).toBe(42);
    expect(asRecord(responseFormat['json_schema'])['nested_ext']).toBe('keep');
  });
});
