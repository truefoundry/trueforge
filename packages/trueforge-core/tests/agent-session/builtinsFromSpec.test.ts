import { builtinsFromSpec } from '../../src/agent-session/builtinsFromSpec';
import { AgentSpecSchema } from '../../src/agent-session/schemas/agentSpec';
import {
  GET_OPENUI_INSTRUCTIONS_TOOL_NAME,
  OPENUI_SERVER_ID,
  buildOpenUIInstruction,
} from '../../src/core/capabilities/builtins/OpenUI';
import type { AgentDefinition } from '../../src/core/runtime/AgentDefinition';
import { NOOP_AGENT_TRACING } from '../../src/core/tracing/NoopAgentTracing';
import { makeMockILLM, makeSilentLogger } from '../core/harnessMocks';

function makeDefinition(): AgentDefinition {
  return {
    modelClient: makeMockILLM(),
  };
}

function runBuiltins(input: {
  spec: ReturnType<typeof AgentSpecSchema.parse>;
  isChild?: boolean;
}): ReturnType<typeof builtinsFromSpec> {
  return builtinsFromSpec({
    spec: input.spec,
    definition: makeDefinition(),
    isChild: input.isChild ?? false,
    sandboxAvailable: false,
    tracing: NOOP_AGENT_TRACING,
    logger: makeSilentLogger(),
  });
}

function hasOpenUITool(capabilities: ReturnType<typeof builtinsFromSpec>): boolean {
  return capabilities.some(cap => cap.systemToolSets?.some(ts => ts.name === OPENUI_SERVER_ID));
}

function hasCompactionProcessor(capabilities: ReturnType<typeof builtinsFromSpec>): boolean {
  return capabilities.some(cap => (cap.preLLMProcessors?.length ?? 0) > 0);
}

describe('builtinsFromSpec compaction', () => {
  it('enables compaction by default', () => {
    const capabilities = runBuiltins({
      spec: AgentSpecSchema.parse({ model: { name: 'provider/model' } }),
    });
    expect(hasCompactionProcessor(capabilities)).toBe(true);
  });

  it('disables compaction from the context-management Agent Spec setting', () => {
    const capabilities = runBuiltins({
      spec: AgentSpecSchema.parse({
        model: { name: 'provider/model' },
        config: { context_management: { compaction: { enabled: false } } },
      }),
    });
    expect(hasCompactionProcessor(capabilities)).toBe(false);
  });
});

describe('builtinsFromSpec generative_ui', () => {
  it('enables OpenUI with preload false when generative_ui is omitted', () => {
    const capabilities = runBuiltins({
      spec: AgentSpecSchema.parse({ model: { name: 'provider/model' } }),
    });
    expect(hasOpenUITool(capabilities)).toBe(true);
    const openUICap = capabilities.find(cap => cap.systemToolSets?.some(ts => ts.name === OPENUI_SERVER_ID));
    expect(openUICap?.instructionBuilders?.[0]).not.toBe(buildOpenUIInstruction);
    expect(openUICap?.instructionBuilders).toHaveLength(1);
  });

  it('disables OpenUI when generative_ui.enabled is false', () => {
    const capabilities = runBuiltins({
      spec: AgentSpecSchema.parse({
        model: { name: 'provider/model' },
        config: { generative_ui: { enabled: false } },
      }),
    });
    expect(hasOpenUITool(capabilities)).toBe(false);
  });

  it('never enables OpenUI on child threads', () => {
    const capabilities = runBuiltins({
      spec: AgentSpecSchema.parse({ model: { name: 'provider/model' } }),
      isChild: true,
    });
    expect(hasOpenUITool(capabilities)).toBe(false);
  });

  it('registers get_openui_instructions for root threads', async () => {
    const capabilities = runBuiltins({
      spec: AgentSpecSchema.parse({ model: { name: 'provider/model' } }),
    });
    const toolSet = capabilities
      .flatMap(cap => [...(cap.systemToolSets ?? [])])
      .find(ts => ts.name === OPENUI_SERVER_ID);
    const listed = await toolSet?.listTools();
    if (!listed || 'authRequired' in listed) {
      throw new Error('expected listTools result');
    }
    expect(listed.result.tools.map(t => t.name)).toEqual([GET_OPENUI_INSTRUCTIONS_TOOL_NAME]);
  });
});
