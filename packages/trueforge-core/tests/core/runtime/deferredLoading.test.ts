import type { AgentCapability } from '../../../src/core/capabilities/AgentCapability';
import { currentDateTime } from '../../../src/core/capabilities/builtins/CurrentDateTime';
import { InstructionBuilder } from '../../../src/core/InstructionBuilder';
import type { ILLM } from '../../../src/core/llm/ILLM';
import type { IToolSet } from '../../../src/core/mcp/IMCPServer';
import { AgentThread } from '../../../src/core/runtime/AgentThread';
import {
  CALL_TOOL_NAME,
  DeferredTool,
  GET_TOOL_INFO_NAME,
  GET_TOOL_OUTPUT_SCHEMA_NAME,
  LIST_TOOLS_NAME,
} from '../../../src/core/runtime/DeferredTool';
import { NOOP_AGENT_TRACING } from '../../../src/core/tracing/NoopAgentTracing';
import '../harnessMocks';
import { makeMockIMCPServer, makeSilentLogger, TEST_MODEL_NAME } from '../harnessMocks';

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

  it('keeps same-named deferred servers independently addressable', () => {
    const text = deferredInstructionText([
      makeMockIMCPServer({ name: 'shared-name', description: 'system capability', preload: false }),
      makeMockIMCPServer({ name: 'shared-name', description: 'configured server', preload: false }),
    ]);

    expect(text).toContain('- shared-name: "system capability"');
    expect(text).toContain('- shared-name (2): "configured server"');
  });
});

const DEFERRED_DISCOVERY_TOOLS = [LIST_TOOLS_NAME, GET_TOOL_INFO_NAME, GET_TOOL_OUTPUT_SCHEMA_NAME, CALL_TOOL_NAME];

async function registeredToolNames(input: {
  capabilities?: readonly AgentCapability[];
  toolSets?: IToolSet[];
}): Promise<string[]> {
  const create = jest.fn<ILLM['create']>().mockImplementation(async function* () {
    return {
      output: { role: 'assistant', content: 'ok' },
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      finish_reason: 'stop',
    };
  });
  const thread = new AgentThread({
    threadId: 'main',
    title: 'Main',
    tracing: NOOP_AGENT_TRACING,
    logger: silentLogger,
    capabilities: input.capabilities,
    definition: {
      modelClient: { create, createNonStream: jest.fn() },
      modelName: TEST_MODEL_NAME,
      toolSets: input.toolSets ?? [],
    },
    context: [{ role: 'user', content: 'hi' }],
  });
  for await (const event of thread.execute({ signal: new AbortController().signal })) {
    void event;
  }
  const body = create.mock.calls[0]?.[0];
  return (body?.tools ?? []).flatMap(tool => (tool.type === 'function' ? [tool.function.name] : []));
}

describe('AgentThread deferred discovery registration', () => {
  it('does not register discovery tools when every server is preloaded', async () => {
    const names = await registeredToolNames({
      capabilities: [currentDateTime({ tracing: NOOP_AGENT_TRACING })],
    });

    expect(names).toContain('get_current_datetime');
    expect(names).not.toEqual(expect.arrayContaining(DEFERRED_DISCOVERY_TOOLS));
  });

  it('registers discovery tools when a system toolset is not preloaded', async () => {
    const names = await registeredToolNames({
      capabilities: [
        currentDateTime({ tracing: NOOP_AGENT_TRACING }),
        { systemToolSets: [makeMockIMCPServer({ name: 'trueforge-mcp', preload: false })] },
      ],
    });

    expect(names).toEqual(expect.arrayContaining(DEFERRED_DISCOVERY_TOOLS));
    expect(names).toContain('get_current_datetime');
  });
});
