import { MAIN_THREAD_ID } from '../../src/agent-session/models/TurnRecord';
import { AgentSpecSchema } from '../../src/agent-session/schemas/agentSpec';
import { EventType } from '../../src/agent-session/schemas/events';
import { Sessions } from '../../src/agent-session/Sessions';
import { InMemorySessionStore } from '../../src/agent-session/store/InMemorySessionStore';
import { TurnResourceResolver } from '../../src/agent-session/TurnResourceResolver';
import { RemoteMCP } from '../../src/core/mcp/RemoteMCP';
import { getEmptyCurrentContextUsage } from '../../src/core/runtime/contextUsage';
import { createEmptyAgentThreadMetrics } from '../../src/core/runtime/metrics';
import {
  makeAgentSpec,
  makeMockILLM,
  makePausedTurnState,
  makeSilentLogger,
  makeTestResolver,
  makeTurnUpdateEvent,
  mintTestTurnId,
  TEST_ACTIVE_EXECUTOR_ID,
} from './testHelpers';

describe('TurnResourceResolver.resolveAgentSpec', () => {
  it('fails closed when deps.agent is not wired for a named lookup', async () => {
    const resolver = new TurnResourceResolver({
      modelRouting: undefined,
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
    });

    await expect(resolver.resolveAgentSpec({ agent_id: 'missing' })).rejects.toThrow(/no agent lookup configured/);
  });
});

describe('TurnResourceResolver.resolveAgentDefinition', () => {
  it('allows existing model resolvers to omit an unknown context length', async () => {
    const resolver = new TurnResourceResolver({
      modelRouting: undefined,
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
    });

    const { model } = await resolver.resolveModel({
      spec: makeAgentSpec(),
      model: undefined,
      routingInput: undefined,
    });

    expect(model.properties).toBeUndefined();
  });

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
      modelRouting: undefined,
      llm: () =>
        Promise.resolve({
          modelClient: makeMockILLM(),
          defaultModelParams: resolvedModelParams,
          modelProperties: { contextLength: 128_000 },
          providerType: undefined,
        }),
      mcp: () => Promise.resolve(undefined),
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

    const { model } = await resolver.resolveModel({
      spec,
      model: undefined,
      routingInput: undefined,
    });

    expect(model.params?.['max_tokens']).toBe(expected);
    expect(model.name).toBe('provider/model');
    expect(model.properties?.contextLength).toBe(128_000);
  });

  it.each([
    {
      name: "runs another model on its own defaults, not the agent's params",
      resolvedModelParams: { max_tokens: 4096 },
      expected: { max_tokens: 4096 },
    },
    {
      name: "sends no max_tokens on another model whose limit isn't known",
      resolvedModelParams: {},
      expected: {},
    },
  ])('$name', async ({ resolvedModelParams, expected }) => {
    const resolver = new TurnResourceResolver({
      modelRouting: undefined,
      llm: () =>
        Promise.resolve({
          modelClient: makeMockILLM(),
          defaultModelParams: resolvedModelParams,
          providerType: undefined,
        }),
      mcp: () => Promise.resolve(undefined),
      mcpRequestTimeoutMs: 1_000,
      mcpConnectTimeoutMs: 1_000,
      logger: makeSilentLogger(),
    });
    const spec = AgentSpecSchema.parse({
      model: { name: 'provider/model', params: { max_tokens: 8192, temperature: 0.2, reasoning_effort: 'high' } },
    });

    const { model } = await resolver.resolveModel({
      spec,
      model: { name: 'provider/other', effort: null },
      routingInput: undefined,
    });

    expect(model.params).toEqual(expected);
  });

  it('resumes a subagent on the saved model and effort', async () => {
    const resolver = new TurnResourceResolver({
      modelRouting: undefined,
      llm: () =>
        Promise.resolve({
          modelClient: makeMockILLM(),
          defaultModelParams: { max_tokens: 4096, reasoning_effort: 'low' },
          providerType: undefined,
        }),
      mcp: () => Promise.resolve(undefined),
      mcpRequestTimeoutMs: 1_000,
      mcpConnectTimeoutMs: 1_000,
      logger: makeSilentLogger(),
    });
    const spec = AgentSpecSchema.parse({
      model: { name: 'provider/model', params: { max_tokens: 8192, reasoning_effort: 'high' } },
    });

    const { model } = await resolver.resolveModel({
      spec,
      model: { name: 'provider/routed', effort: 'medium' },
      routingInput: undefined,
    });

    expect(model.name).toBe('provider/routed');
    expect(model.params).toEqual({ max_tokens: 4096, reasoning_effort: 'medium' });
  });

  it('closes each RemoteMCP when the turn ends', async () => {
    const close = jest.spyOn(RemoteMCP.prototype, 'close').mockResolvedValue(undefined);
    const resolver = new TurnResourceResolver({
      modelRouting: undefined,
      llm: () =>
        Promise.resolve({
          modelClient: makeMockILLM(),
          defaultModelParams: {},
          providerType: undefined,
        }),
      mcp: id =>
        Promise.resolve(
          id === 'docs' ? { url: 'http://localhost', name: 'docs', description: 'Docs MCP server.' } : undefined,
        ),
      mcpRequestTimeoutMs: 1_000,
      mcpConnectTimeoutMs: 1_000,
      logger: makeSilentLogger(),
    });
    const spec = AgentSpecSchema.parse({
      model: { name: 'provider/model' },
      mcp_servers: [{ name: 'docs' }],
    });

    await resolver.resolveAgentDefinition({
      spec,
      signal: new AbortController().signal,
      tracing: resolver.createTracing(),
    });
    await resolver.close();
    await resolver.close();

    expect(close).toHaveBeenCalledTimes(1);
    close.mockRestore();
  });
});

describe('SessionHandle.createTurn named resolve', () => {
  it('loads the live AgentSpec through resolver.agent for ref sessions', async () => {
    const store = new InMemorySessionStore();
    const sessions = new Sessions({ sessionStore: store });
    const session = await sessions.create({
      tenant_id: 'tenant-1',
      session_id: 's-named',
      created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
      agent: { type: 'reference', id: 'agent-abc', name: null },
      external_id: null,
    });

    const live = makeAgentSpec({ instructions: 'from-registry' });
    const agent = jest.fn().mockResolvedValue(live);
    const turn = await session.createTurn({
      turn_id: mintTestTurnId(),
      active_executor_id: TEST_ACTIVE_EXECUTOR_ID,
      input: [{ type: EventType.USER_MESSAGE, content: 'hi' }],
      previous_turn_id: 'none',
      abortController: new AbortController(),
      resolver: makeTestResolver({ agent }),
    });

    expect(turn.state.status).toBe('running');
    expect(agent).toHaveBeenCalledWith('agent-abc');
  });
});

describe('SessionHandle rebuild', () => {
  it.each([
    {
      name: 'the model it ran on',
      saved: { name: 'acct/routed', effort: 'high' },
      expected: { name: 'acct/routed', effort: 'high' },
    },
    { name: 'the model it was asked for', saved: null, expected: { name: 'acct/requested', effort: null } },
  ])('brings a subagent back on $name when a paused turn is rebuilt', async ({ saved, expected }) => {
    const store = new InMemorySessionStore();
    const sessions = new Sessions({ sessionStore: store });
    const session = await sessions.create({
      tenant_id: 'tenant-1',
      session_id: 's-rebuild',
      created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
      agent: { type: 'inline', spec: makeAgentSpec() },
      external_id: null,
    });
    const turn1 = await session.createTurn({
      turn_id: mintTestTurnId(),
      active_executor_id: TEST_ACTIVE_EXECUTOR_ID,
      input: [{ type: EventType.USER_MESSAGE, content: 'hi' }],
      previous_turn_id: 'none',
      abortController: new AbortController(),
      resolver: makeTestResolver(),
    });
    await store.addThreads({
      active_executor_id: TEST_ACTIVE_EXECUTOR_ID,
      session_id: 's-rebuild',
      turn_id: turn1.id,
      threads: [
        {
          thread_id: 'child',
          context: [],
          current_context_usage: getEmptyCurrentContextUsage(),
          parent: { thread_id: MAIN_THREAD_ID, tool_call_id: 'tc1' },
          agent_info: { type: 'dynamic', name: 'child', input: 'task', model: 'acct/requested' },
          model: saved,
          completion: null,
          pending_mcp_auth: false,
          capability_state: null,
        },
      ],
    });
    const runningSince = (await store.getTurn({ session_id: 's-rebuild', turn_id: turn1.id }))?.snapshot.running_since;
    if (runningSince == null) {
      throw new Error('expected a running turn to pause');
    }
    const paused = makePausedTurnState();
    await store.updateTurnNonTerminalState({
      active_executor_id: TEST_ACTIVE_EXECUTOR_ID,
      session_id: 's-rebuild',
      turn_id: turn1.id,
      state: paused,
      turn_update_event: makeTurnUpdateEvent(paused),
      turn_metrics: {
        status: 'paused',
        observed_at: new Date(Date.parse(runningSince) + 1).toISOString(),
        metrics: createEmptyAgentThreadMetrics(),
      },
    });

    const resolver = makeTestResolver();
    const resolveAgentDefinition = jest.spyOn(resolver, 'resolveAgentDefinition');
    const resolveModel = jest.spyOn(resolver, 'resolveModel');
    const rebuilt = await session.rebuildTurn({
      turn_id: turn1.id,
      active_executor_id: TEST_ACTIVE_EXECUTOR_ID,
      abortController: new AbortController(),
      resolver,
    });
    for await (const event of rebuilt.stream()) {
      void event;
    }

    expect(resolveModel.mock.calls.map(([input]) => input)).toContainEqual(
      expect.objectContaining({ model: expected, routingInput: undefined }),
    );
    expect(resolveAgentDefinition.mock.calls.map(([input]) => input.agent_info)).toContainEqual(undefined);
  });
});
