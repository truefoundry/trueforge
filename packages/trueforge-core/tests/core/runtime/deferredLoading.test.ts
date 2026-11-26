import type { AgentCapability } from '../../../src/core/capabilities/AgentCapability';
import { currentDateTime } from '../../../src/core/capabilities/builtins/CurrentDateTime';
import { InstructionBuilder } from '../../../src/core/InstructionBuilder';
import type { LLMCreateParamsStreaming } from '../../../src/core/llm/ILLM';
import { isCallToolResponseResult, type IToolSet } from '../../../src/core/mcp/IMCPServer';
import { AgentThread } from '../../../src/core/runtime/AgentThread';
import {
  CALL_TOOL_NAME,
  DeferredTool,
  GET_TOOL_INFO_NAME,
  GET_TOOL_OUTPUT_SCHEMA_NAME,
  LIST_TOOLS_NAME,
} from '../../../src/core/runtime/DeferredTool';
import type { HarnessSandbox } from '../../../src/core/sandbox/Sandbox';
import { NOOP_AGENT_TRACING } from '../../../src/core/tracing/NoopAgentTracing';
import { textReplyStream } from '../../orchestration/helpers/helpers';
import '../harnessMocks';
import {
  makeMockIMCPServer,
  makeSilentLogger,
  makeStubPublicSandbox,
  OBJECT_INPUT_SCHEMA,
  TEST_MODEL_NAME,
} from '../harnessMocks';

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

  it('routes list_tools to the system vs user tool set by their distinct ids', async () => {
    const deferred = new DeferredTool(
      [
        makeMockIMCPServer({
          name: 'shared',
          id: 'built-in.shared',
          preload: false,
          tools: [{ name: 'system_tool', description: 'System', inputSchema: OBJECT_INPUT_SCHEMA, preload: false }],
        }),
        makeMockIMCPServer({
          name: 'shared',
          id: 'shared',
          preload: false,
          tools: [{ name: 'user_tool', description: 'User', inputSchema: OBJECT_INPUT_SCHEMA, preload: false }],
        }),
      ],
      { tracing: NOOP_AGENT_TRACING, logger: silentLogger },
    );

    const systemList = await deferred.callTool({ name: LIST_TOOLS_NAME, arguments: { mcp_server: 'built-in.shared' } });
    const userList = await deferred.callTool({ name: LIST_TOOLS_NAME, arguments: { mcp_server: 'shared' } });

    expect(isCallToolResponseResult(systemList)).toBe(true);
    expect(isCallToolResponseResult(userList)).toBe(true);
    if (!isCallToolResponseResult(systemList) || !isCallToolResponseResult(userList)) {
      return;
    }
    expect(systemList.result.content[0]).toEqual({ type: 'text', text: 'built-in.shared:\n  system_tool' });
    expect(userList.result.content[0]).toEqual({ type: 'text', text: 'shared:\n  user_tool' });
  });
});

const META_TOOL_NAMES = [LIST_TOOLS_NAME, GET_TOOL_INFO_NAME, GET_TOOL_OUTPUT_SCHEMA_NAME, CALL_TOOL_NAME];

/** Names of the tools the thread sends to the model on its first call. */
async function toolNamesSentToModel(input: {
  capabilities?: readonly AgentCapability[];
  toolSets?: IToolSet[];
  sandbox?: HarnessSandbox;
}): Promise<string[]> {
  const create = jest.fn().mockImplementation(() => textReplyStream('ok'));
  const thread = new AgentThread({
    threadId: 'main',
    title: 'Main',
    tracing: NOOP_AGENT_TRACING,
    logger: silentLogger,
    capabilities: input.capabilities,
    definition: {
      toolSets: input.toolSets ?? [],
    },
    resolveModel: () =>
      Promise.resolve({
        model: {
          client: { create, createNonStream: jest.fn() },
          name: TEST_MODEL_NAME,
        },
        routed: false,
      }),
    context: [{ role: 'user', content: 'hi' }],
    sandbox: input.sandbox,
  });
  for await (const event of thread.execute({ signal: new AbortController().signal })) {
    void event;
  }
  const body = create.mock.calls[0]?.[0] as LLMCreateParamsStreaming | undefined;
  return (body?.tools ?? []).flatMap(tool => (tool.type === 'function' ? [tool.function.name] : []));
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
    const names = await toolNamesSentToModel({
      toolSets,
      sandbox: sandbox ? makeStubPublicSandbox() : undefined,
    });
    for (const metaTool of META_TOOL_NAMES) {
      expect(names.includes(metaTool)).toBe(expected);
    }
  });

  it('still offers the preloaded tools when the meta tools are left out', async () => {
    const names = await toolNamesSentToModel({
      toolSets: [makeMockIMCPServer({ name: 'eager', preload: true })],
    });
    expect(names).toContain('tool_a');
  });

  it('offers them when a system toolset is not preloaded', async () => {
    const names = await toolNamesSentToModel({
      capabilities: [
        currentDateTime({ tracing: NOOP_AGENT_TRACING }),
        { systemToolSets: [makeMockIMCPServer({ name: 'trueforge:mcp', preload: false })] },
      ],
    });

    expect(names).toEqual(expect.arrayContaining(META_TOOL_NAMES));
    expect(names).toContain('get_current_datetime');
  });

  it('does not offer them for a sandbox with only preloaded builtins and no user MCP', async () => {
    const names = await toolNamesSentToModel({
      capabilities: [currentDateTime({ tracing: NOOP_AGENT_TRACING })],
      sandbox: makeStubPublicSandbox(),
    });

    expect(names).toContain('get_current_datetime');
    for (const metaTool of META_TOOL_NAMES) {
      expect(names.includes(metaTool)).toBe(false);
    }
  });
});
