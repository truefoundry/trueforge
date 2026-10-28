import { AgentSpecSchema } from '@truefoundry/trueforge-core/agent-session';
import type { AgentInfo, ILLM } from '@truefoundry/trueforge-core/core';
import { createLogger } from 'winston';
import { TrueFoundryTurnResourceResolver } from '../../../src/truefoundry/TrueFoundryTurnResourceResolver';
import type { TfgToolName } from '../../../src/truefoundry/tfgTools';

const unusedLlm: ILLM = {
  create: () => {
    throw new Error('unused');
  },
  createNonStream: () => Promise.reject(new Error('unused')),
};

function resolverWith(enabledTools: readonly TfgToolName[]): TrueFoundryTurnResourceResolver {
  return new TrueFoundryTurnResourceResolver({
    enabledTools,
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
  it('mounts ask_user_secret on the root thread only', async () => {
    const resolver = resolverWith(['ask_user_secret']);
    const tracing = resolver.createTracing();
    const signal = new AbortController().signal;

    const root = await resolver.resolveAgentDefinition({ spec, signal, tracing });
    const nested = await resolver.resolveAgentDefinition({ spec, signal, tracing, agent_info: child });

    expect(
      root.extraCapabilities?.flatMap(capability => capability.systemToolSets ?? []).map(toolSet => toolSet.name),
    ).toEqual(['ask-user-secret']);
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
