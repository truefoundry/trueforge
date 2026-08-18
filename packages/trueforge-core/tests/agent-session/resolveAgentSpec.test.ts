import { AgentSpecSchema } from '../../src/agent-session/schemas/agentSpec';
import { EventType } from '../../src/agent-session/schemas/events';
import { Sessions } from '../../src/agent-session/Sessions';
import { InMemorySessionStore } from '../../src/agent-session/store/InMemorySessionStore';
import { TurnResourceResolver } from '../../src/agent-session/TurnResourceResolver';
import { makeAgentSpec, makeMockILLM, makeSilentLogger, makeTestResolver, mintTestTurnId } from './testHelpers';

describe('TurnResourceResolver.resolveAgentSpec', () => {
  it('fails closed when deps.agent is not wired for a named lookup', async () => {
    const resolver = new TurnResourceResolver({
      llm: () => Promise.resolve({ modelClient: makeMockILLM(), defaultModelParams: {} }),
      mcp: () => Promise.reject(new Error('unused')),
      mcpRequestTimeoutMs: 1_000,
      mcpConnectTimeoutMs: 1_000,
      logger: makeSilentLogger(),
    });

    await expect(resolver.resolveAgentSpec({ agent_id: 'missing' })).rejects.toThrow(/no agent lookup configured/);
  });
});

describe('TurnResourceResolver.resolveAgentDefinition', () => {
  it.each([
    {
      name: 'uses the resolved model default when the agent omits max_tokens',
      resolvedModelParams: { max_tokens: 4096 },
      agentModelParams: undefined,
      expected: 4096,
    },
    {
      name: 'lets the agent max_tokens override the resolved model default',
      resolvedModelParams: { max_tokens: 4096 },
      agentModelParams: { max_tokens: 8192 },
      expected: 8192,
    },
  ])('$name', async ({ resolvedModelParams, agentModelParams, expected }) => {
    const resolver = new TurnResourceResolver({
      llm: () =>
        Promise.resolve({
          modelClient: makeMockILLM(),
          defaultModelParams: resolvedModelParams,
        }),
      mcp: () => Promise.reject(new Error('unused')),
      mcpRequestTimeoutMs: 1_000,
      mcpConnectTimeoutMs: 1_000,
      logger: makeSilentLogger(),
    });
    const spec = AgentSpecSchema.parse({
      model: {
        name: 'provider/model',
        ...(agentModelParams === undefined ? {} : { params: agentModelParams }),
      },
    });

    const { definition } = await resolver.resolveAgentDefinition({
      spec,
      signal: new AbortController().signal,
      tracing: resolver.createTracing(),
    });

    expect(definition.modelParams?.['max_tokens']).toBe(expected);
  });
});

describe('SessionHandle.createTurn named resolve', () => {
  it('loads the live AgentSpec through resolver.agent for ref sessions', async () => {
    const store = new InMemorySessionStore();
    const sessions = new Sessions({ sessionStore: store });
    const session = await sessions.create({
      tenant_id: 'tenant-1',
      session_id: 's-named',
      created_by: 'user-1',
      agent: { type: 'reference', id: 'agent-abc', name: null },
    });

    const live = makeAgentSpec({ instructions: 'from-registry' });
    const agent = jest.fn().mockResolvedValue(live);
    const turn = await session.createTurn({
      turn_id: mintTestTurnId(),
      input: [{ type: EventType.USER_MESSAGE, content: 'hi' }],
      previous_turn_id: 'none',
      signal: new AbortController().signal,
      resolver: makeTestResolver({ agent }),
    });

    expect(turn.state.status).toBe('running');
    expect(agent).toHaveBeenCalledWith('agent-abc');
  });
});
