import { InstructionBuilder } from '../../../src/core/InstructionBuilder';
import type { ILLM } from '../../../src/core/llm/ILLM';
import type { ExtendedChatCompletionChunk, RawAssistantMessageWithUsage } from '../../../src/core/llm/LLMTypes';
import { getEmptyUsage } from '../../../src/core/llm/LLMTypes';
import type { IToolSet } from '../../../src/core/mcp/IMCPServer';
import { AgentThread } from '../../../src/core/runtime/AgentThread';
import {
  DeferredTool,
  GET_TOOL_INFO_NAME,
  GET_TOOL_OUTPUT_SCHEMA_NAME,
  LIST_TOOLS_NAME,
} from '../../../src/core/runtime/DeferredTool';
import { NOOP_AGENT_TRACING } from '../../../src/core/tracing/NoopAgentTracing';
import '../harnessMocks';
import { makeMockIMCPServer, makeSilentLogger, makeStubPublicSandbox, TEST_MODEL_NAME } from '../harnessMocks';

const DEFERRED_TOOLS_INSTRUCTION = 'deferred-tools-instructions';

const silentLogger = makeSilentLogger();

function deferredInstructionText(servers: IToolSet[]): string {
  const builder = InstructionBuilder.createSystemPrompt('test');
  const capabilities = builder.beginSection('agent-capabilities');
  new DeferredTool(servers, { tracing: NOOP_AGENT_TRACING, logger: silentLogger }).buildInstruction(capabilities);
  return builder.build();
}

describe('DeferredTool deferred loading behavior', () => {
  it('includes preload:false servers in deferred-tools instructions', () => {
    const text = deferredInstructionText([
      makeMockIMCPServer({ name: 'eager-server', preload: true }),
      makeMockIMCPServer({ name: 'lazy-server', preload: false }),
    ]);
    expect(text).toContain(`<${DEFERRED_TOOLS_INSTRUCTION}>`);
    expect(text).toContain('lazy-server');
    expect(text).not.toContain('eager-server');
  });

  it('omits deferred-tools instructions when every server is preload:true', () => {
    const text = deferredInstructionText([makeMockIMCPServer({ name: 'all-eager', preload: true })]);
    expect(text).not.toContain(`<${DEFERRED_TOOLS_INSTRUCTION}>`);
  });

  it('lists preload:false servers even when hasPreloadedTools is true (selective preload)', () => {
    const text = deferredInstructionText([
      makeMockIMCPServer({
        name: 'partial-preload-server',
        preload: false,
        hasPreloadedTools: true,
        preloadTools: ['tool_a'],
      }),
    ]);
    expect(text).toContain('partial-preload-server');
  });

  it('lists preload:false with no preloads and omits preload:true', () => {
    const text = deferredInstructionText([
      makeMockIMCPServer({ name: 'lazy-empty', preload: false, hasPreloadedTools: false }),
      makeMockIMCPServer({ name: 'eager', preload: true, hasPreloadedTools: true }),
    ]);
    expect(text).toContain('lazy-empty');
    expect(text).not.toContain('eager');
  });
});

const META_TOOL_NAMES = [LIST_TOOLS_NAME, GET_TOOL_INFO_NAME, GET_TOOL_OUTPUT_SCHEMA_NAME, 'call_tool'];

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

/** Names of the tools the thread sends to the model on its first call. */
async function toolNamesSentToModel(toolSets: IToolSet[], withSandbox: boolean): Promise<string[]> {
  const create = jest.fn(() => finalAnswerStream());
  const modelClient: ILLM = { create, createNonStream: jest.fn() };
  const thread = new AgentThread({
    threadId: 'main',
    title: 'Main',
    tracing: NOOP_AGENT_TRACING,
    logger: silentLogger,
    definition: { modelClient, modelName: TEST_MODEL_NAME, instruction: 'test', toolSets },
    context: [{ role: 'user', content: 'hi' }],
    sandbox: withSandbox ? makeStubPublicSandbox() : undefined,
  });
  for await (const _event of thread.execute({ signal: new AbortController().signal })) {
    // drain
  }
  const [body] = create.mock.calls[0] as unknown as [{ tools?: { function: { name: string } }[] }];
  return (body.tools ?? []).map(tool => tool.function.name);
}

describe('AgentThread deferred meta tools', () => {
  it.each([
    { servers: 'every server preload:true', preloads: [true], sandbox: false, expected: false },
    { servers: 'a preload:false server', preloads: [false], sandbox: false, expected: true },
    { servers: 'preload:true and preload:false servers', preloads: [true, false], sandbox: false, expected: true },
    { servers: 'every server preload:true, with a sandbox', preloads: [true], sandbox: true, expected: true },
    { servers: 'no servers', preloads: [], sandbox: false, expected: false },
  ])('offers them for $servers: $expected', async ({ preloads, sandbox, expected }) => {
    const toolSets = preloads.map((preload, i) => makeMockIMCPServer({ name: `server-${i}`, preload }));
    const names = await toolNamesSentToModel(toolSets, sandbox);
    for (const metaTool of META_TOOL_NAMES) {
      expect(names.includes(metaTool)).toBe(expected);
    }
  });

  it('still offers the preloaded tools when the meta tools are left out', async () => {
    const names = await toolNamesSentToModel([makeMockIMCPServer({ name: 'eager', preload: true })], false);
    expect(names).toContain('tool_a');
  });
});
