import { EventType } from '../../src/agent-session/schemas/events';
import { Sessions } from '../../src/agent-session/Sessions';
import { InMemorySessionStore } from '../../src/agent-session/store/InMemorySessionStore';
import { TurnResourceResolver } from '../../src/agent-session/TurnResourceResolver';
import { NOOP_AGENT_TRACING } from '../../src/core/tracing/NoopAgentTracing';
import { makeAgentSpec, makeMockILLM, makeSilentLogger, makeTestResolver, mintTestTurnId } from './testHelpers';

describe('TurnResourceResolver.resolveAgentSpec', () => {
  const signal = new AbortController().signal;
  const tracing = NOOP_AGENT_TRACING;

  it('returns the inline agent_spec and caches it', async () => {
    const spec = makeAgentSpec({ instructions: 'inline' });
    const resolver = new TurnResourceResolver({
      llm: () => Promise.resolve(makeMockILLM()),
      mcp: () => Promise.reject(new Error('unused')),
      mcpRequestTimeoutMs: 1_000,
      mcpConnectTimeoutMs: 1_000,
      logger: makeSilentLogger(),
    });

    const first = await resolver.resolveAgentSpec({
      source: { type: 'inline', agent_spec: spec },
      signal,
      tracing,
    });
    const second = await resolver.resolveAgentSpec({
      source: { type: 'inline', agent_spec: makeAgentSpec({ instructions: 'other' }) },
      signal,
      tracing,
    });

    expect(first.instructions).toBe('inline');
    expect(second).toBe(first);
  });

  it('looks up named agents once and caches the live manifest', async () => {
    const live = makeAgentSpec({ instructions: 'live-named' });
    const agent = jest.fn().mockResolvedValue(live);
    const resolver = new TurnResourceResolver({
      llm: () => Promise.resolve(makeMockILLM()),
      mcp: () => Promise.reject(new Error('unused')),
      mcpRequestTimeoutMs: 1_000,
      mcpConnectTimeoutMs: 1_000,
      agent,
      logger: makeSilentLogger(),
    });

    const first = await resolver.resolveAgentSpec({
      source: { type: 'named', agent_id: 'agent-1' },
      signal,
      tracing,
    });
    const second = await resolver.resolveAgentSpec({
      source: { type: 'named', agent_id: 'agent-1' },
      signal,
      tracing,
    });

    expect(first.instructions).toBe('live-named');
    expect(second).toBe(first);
    expect(agent).toHaveBeenCalledTimes(1);
    expect(agent).toHaveBeenCalledWith('agent-1');
  });

  it('throws when named resolve has no agent lookup configured', async () => {
    const resolver = new TurnResourceResolver({
      llm: () => Promise.resolve(makeMockILLM()),
      mcp: () => Promise.reject(new Error('unused')),
      mcpRequestTimeoutMs: 1_000,
      mcpConnectTimeoutMs: 1_000,
      logger: makeSilentLogger(),
    });

    await expect(
      resolver.resolveAgentSpec({
        source: { type: 'named', agent_id: 'missing' },
        signal,
        tracing,
      }),
    ).rejects.toThrow(/no agent lookup configured/);
  });
});

describe('SessionHandle.createTurn named resolve', () => {
  it('resolves a named session via resolver.agent and runs createTurn', async () => {
    const store = new InMemorySessionStore();
    const sessions = new Sessions({ sessionStore: store });
    const session = await sessions.create({
      tenant_id: 'tenant-1',
      session_id: 's-named',
      agent_id: 'agent-abc',
      agent_spec: null,
    });

    const live = makeAgentSpec({ instructions: 'from-registry' });
    const agent = jest.fn().mockResolvedValue(live);
    const turn = await session.createTurn({
      turn_id: mintTestTurnId(),
      input: [{ type: EventType.USER_MESSAGE, content: 'hi' }],
      previous_turn_id: null,
      signal: new AbortController().signal,
      resolver: makeTestResolver({ agent }),
    });

    expect(turn.state.status).toBe('running');
    expect(agent).toHaveBeenCalledWith('agent-abc');
  });
});
