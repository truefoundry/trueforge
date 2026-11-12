import { TRUEFORGE_MCP_ID, TurnResourceResolver } from '../../src/agent-session/TurnResourceResolver';
import type { AgentSpec } from '../../src/agent-session/schemas/agentSpec';
import type { AgentCapability, AgentInfo } from '../../src/core';
import { makeAgentSpec, makeMockILLM, makeSilentLogger } from './testHelpers';

const child: AgentInfo = { type: 'dynamic', name: 'child', input: 'do the task' };

function resolverWith(
  input: {
    rootCapabilities?: () => readonly AgentCapability[];
  } = {},
): TurnResourceResolver {
  return new TurnResourceResolver({
    llm: () =>
      Promise.resolve({
        modelClient: makeMockILLM(),
        defaultModelParams: {},
        providerType: undefined,
      }),
    mcp: () => Promise.resolve(undefined),
    mcpRequestTimeoutMs: 1_000,
    mcpConnectTimeoutMs: 1_000,
    logger: makeSilentLogger(),
    ...input,
  });
}

describe('TurnResourceResolver rootCapabilities', () => {
  it('mounts them on the main thread and skips child threads', async () => {
    const capability: AgentCapability = {};
    let calls = 0;
    const resolver = resolverWith({
      rootCapabilities: () => {
        calls += 1;
        return [capability];
      },
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
    const resolver = resolverWith({ rootCapabilities: () => [] });
    const resolved = await resolver.resolveAgentDefinition({
      spec: makeAgentSpec(),
      signal: new AbortController().signal,
      tracing: resolver.createTracing(),
    });

    expect(resolved.extraCapabilities).toBeUndefined();
  });

  it('mounts the TrueForge MCP on root and child threads', async () => {
    const resolver = new TurnResourceResolver({
      llm: () =>
        Promise.resolve({
          modelClient: makeMockILLM(),
          defaultModelParams: {},
          providerType: undefined,
        }),
      mcp: id =>
        Promise.resolve(
          id === TRUEFORGE_MCP_ID
            ? {
                url: 'http://internal.example/mcp',
                name: TRUEFORGE_MCP_ID,
                description: 'TrueForge management',
              }
            : undefined,
        ),
      mcpRequestTimeoutMs: 1_000,
      mcpConnectTimeoutMs: 1_000,
      logger: makeSilentLogger(),
    });
    const tracing = resolver.createTracing();
    const signal = new AbortController().signal;
    const spec = makeAgentSpec();

    const root = await resolver.resolveAgentDefinition({ spec, signal, tracing });
    const nested = await resolver.resolveAgentDefinition({ spec, signal, tracing, agent_info: child });

    expect(root.extraCapabilities?.[0]?.systemToolSets?.[0]?.id).toBe(TRUEFORGE_MCP_ID);
    expect(nested.extraCapabilities?.[0]?.systemToolSets?.[0]?.id).toBe(TRUEFORGE_MCP_ID);
    expect(root.extraCapabilities?.[0]?.systemToolSets?.[0]?.name).toBe(TRUEFORGE_MCP_ID);
  });

  it('keeps direct capability sources distinct from configured MCPs with the same display name', async () => {
    const resolver = new TurnResourceResolver({
      llm: () =>
        Promise.resolve({
          modelClient: makeMockILLM(),
          defaultModelParams: {},
          providerType: undefined,
        }),
      mcp: id =>
        Promise.resolve(
          id === TRUEFORGE_MCP_ID
            ? {
                url: 'http://internal.example/mcp',
                name: TRUEFORGE_MCP_ID,
                description: 'TrueForge management',
              }
            : {
                url: 'https://configured.example/mcp',
                name: 'trueforge-mcp',
                description: 'Configured server',
              },
        ),
      mcpRequestTimeoutMs: 1_000,
      mcpConnectTimeoutMs: 1_000,
      logger: makeSilentLogger(),
    });
    const spec: AgentSpec = {
      ...makeAgentSpec(),
      mcp_servers: [
        {
          name: 'trueforge-mcp',
          enable_tools: ['@all'],
          disable_tools: [],
          preload_tools: [],
          require_approval_for_tools: [],
          preload: false,
        },
      ],
    };

    const resolved = await resolver.resolveAgentDefinition({
      spec,
      signal: new AbortController().signal,
      tracing: resolver.createTracing(),
    });

    expect(resolved.definition.toolSets?.[0]?.id).toBe('trueforge-mcp');
    expect(resolved.extraCapabilities?.[0]?.systemToolSets?.[0]?.id).toBe(TRUEFORGE_MCP_ID);
    expect(resolved.extraCapabilities?.[0]?.systemToolSets?.[0]?.name).toBe(TRUEFORGE_MCP_ID);
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
