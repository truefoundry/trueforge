import { AgentSpecSchema } from '@truefoundry/trueforge-core/agent-session';
import type { AgentInfo, ILLM } from '@truefoundry/trueforge-core/core';
import { createLogger } from 'winston';
import { TrueFoundryTurnResourceResolver } from '../../../src/truefoundry/TrueFoundryTurnResourceResolver';
import { parseTfgTools, type InlineTool } from '../../../src/truefoundry/inlineTools';

const unusedLlm: ILLM = {
  create: () => {
    throw new Error('unused');
  },
  createNonStream: () => Promise.reject(new Error('unused')),
};

const askUserSecret = parseTfgTools(
  JSON.stringify([
    {
      name: 'ask_user_secret',
      description: 'Collect a secret.',
      inputSchema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
    },
  ]),
);

function resolverWith(tools: readonly InlineTool[]): TrueFoundryTurnResourceResolver {
  return new TrueFoundryTurnResourceResolver({
    tools,
    deps: {
      llm: () =>
        Promise.resolve({
          modelClient: unusedLlm,
          defaultModelParams: {},
          providerType: undefined,
        }),
      mcp: () => Promise.reject(new Error('unused')),
      mcpRequestTimeoutMs: 1000,
      mcpConnectTimeoutMs: 1000,
      logger: createLogger({ silent: true }),
    },
  });
}

const spec = AgentSpecSchema.parse({ model: { name: 'provider/model' } });
const child: AgentInfo = { type: 'dynamic', name: 'child', input: 'do the task' };

describe('TrueFoundryTurnResourceResolver', () => {
  it('mounts header tools on the root thread only', async () => {
    const resolver = resolverWith(askUserSecret);
    const tracing = resolver.createTracing();
    const signal = new AbortController().signal;

    const root = await resolver.resolveAgentDefinition({ spec, signal, tracing });
    const nested = await resolver.resolveAgentDefinition({ spec, signal, tracing, agent_info: child });

    expect(
      root.extraCapabilities?.flatMap(capability => capability.systemToolSets ?? []).map(toolSet => toolSet.name),
    ).toEqual(['x-tfg-tools']);
    expect(nested.extraCapabilities).toBeUndefined();
  });

  it('mounts nothing when the header listed no tools', async () => {
    const resolver = resolverWith([]);
    const resolved = await resolver.resolveAgentDefinition({
      spec,
      signal: new AbortController().signal,
      tracing: resolver.createTracing(),
    });

    expect(resolved.extraCapabilities).toBeUndefined();
  });
});
