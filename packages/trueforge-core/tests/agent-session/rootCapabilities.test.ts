import { TurnResourceResolver } from '../../src/agent-session/TurnResourceResolver';
import type { AgentCapability, AgentInfo } from '../../src/core';
import { makeAgentSpec, makeMockILLM, makeSilentLogger } from './testHelpers';

const child: AgentInfo = { type: 'dynamic', name: 'child', input: 'do the task' };

function resolverWith(rootCapabilities?: () => readonly AgentCapability[]): TurnResourceResolver {
  return new TurnResourceResolver({
    llm: () =>
      Promise.resolve({
        modelClient: makeMockILLM(),
        defaultModelParams: {},
        providerType: undefined,
      }),
    mcp: () => Promise.reject(new Error('unused')),
    mcpRequestTimeoutMs: 1_000,
    mcpConnectTimeoutMs: 1_000,
    logger: makeSilentLogger(),
    ...(rootCapabilities === undefined ? {} : { rootCapabilities }),
  });
}

describe('TurnResourceResolver rootCapabilities', () => {
  it('mounts them on the main thread and skips child threads', async () => {
    const capability: AgentCapability = {};
    let calls = 0;
    const resolver = resolverWith(() => {
      calls += 1;
      return [capability];
    });
    const tracing = resolver.createTracing();
    const signal = new AbortController().signal;
    const spec = makeAgentSpec();

    const root = await resolver.resolveAgentDefinition({ spec, signal, tracing });
    const nested = await resolver.resolveAgentDefinition({ spec, signal, tracing, agent_info: child });

    expect(root.extraCapabilities).toEqual([capability]);
    expect(nested.extraCapabilities).toBeUndefined();
    expect(calls).toBe(1);
  });

  it('omits extraCapabilities when the list is empty', async () => {
    const resolver = resolverWith(() => []);
    const resolved = await resolver.resolveAgentDefinition({
      spec: makeAgentSpec(),
      signal: new AbortController().signal,
      tracing: resolver.createTracing(),
    });

    expect(resolved.extraCapabilities).toBeUndefined();
  });

  it('omits extraCapabilities when none are configured', async () => {
    const resolver = resolverWith();
    const resolved = await resolver.resolveAgentDefinition({
      spec: makeAgentSpec(),
      signal: new AbortController().signal,
      tracing: resolver.createTracing(),
    });

    expect(resolved.extraCapabilities).toBeUndefined();
  });
});
