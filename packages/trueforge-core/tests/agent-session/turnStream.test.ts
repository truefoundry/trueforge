import { EventType } from '../../src/agent-session/schemas/events';
import { CancellationReason } from '../../src/agent-session/schemas/turn';
import { Sessions } from '../../src/agent-session/Sessions';
import { InMemorySessionStore } from '../../src/agent-session/store/InMemorySessionStore';
import { TurnResourceResolver } from '../../src/agent-session/TurnResourceResolver';
import { RemoteMCP } from '../../src/core/mcp/RemoteMCP';
import { makeStubPublicSandbox } from '../core/harnessMocks';
import {
  emptyLlmStream,
  makeAgentSpec,
  makeMockILLM,
  makeSilentLogger,
  makeTestResolver,
  mintTestTurnId,
} from './testHelpers';

describe('TurnHandle.stream()', () => {
  const tenant = 'tenant-1';

  async function createSession() {
    const store = new InMemorySessionStore();
    const sessions = new Sessions({ sessionStore: store });
    const session = await sessions.create({
      tenant_id: tenant,
      session_id: 's1',
      created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
      agent: {
        type: 'inline',
        spec: makeAgentSpec({
          config: {
            sandbox: { enabled: true, file_downloads: true },
          },
        }),
      },
      external_id: null,
    });
    return { store, session };
  }

  it('run commits running turn; stream is sole terminal writer → done', async () => {
    const { store, session } = await createSession();
    const turn = await session.createTurn({
      turn_id: mintTestTurnId(),
      input: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
      previous_turn_id: 'none',
      signal: new AbortController().signal,
      resolver: makeTestResolver(),
    });
    expect(turn.state.status).toBe('running');

    const types: string[] = [];
    for await (const event of turn.stream()) {
      types.push(event.type);
    }
    expect(types[0]).toBe(EventType.TURN_CREATED);
    expect(types[types.length - 1]).toBe(EventType.TURN_DONE);
    expect(turn.state).toMatchObject({
      status: 'done',
      metrics: {},
    });
    if (turn.state.status === 'done') {
      // Token counts are always reported, so an unbilled turn aggregates to 0. Cost and the
      // cache counts stay undefined until a provider actually reports them.
      expect(turn.state.metrics?.total_input_tokens).toBe(0);
      expect(turn.state.metrics?.total_output_tokens).toBe(0);
      expect(turn.state.metrics?.total_tokens).toBe(0);
      expect(turn.state.metrics?.total_cache_read_tokens).toBeUndefined();
      expect(turn.state.metrics?.total_cost_in_usd).toBeUndefined();
    }

    const { data } = await turn.listEvents({ limit: 50 });
    expect(data.some(e => e.type === EventType.TURN_CREATED)).toBe(true);
    expect(data.some(e => e.type === EventType.TURN_DONE)).toBe(true);

    const stored = await store.getTurn({
      session_id: 's1',
      turn_id: turn.id,
    });
    expect(stored?.state.status).toBe('done');
  });

  it('persists final turn usage from orchestrator metrics', async () => {
    const { session } = await createSession();
    const turn = await session.createTurn({
      turn_id: 'turn-usage',
      input: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
      previous_turn_id: 'none',
      signal: new AbortController().signal,
      resolver: makeTestResolver({
        usage: {
          input_tokens: 12,
          output_tokens: 5,
          total_tokens: 17,
          cache_read_tokens: 4,
          reasoning_tokens: 3,
          cost_in_usd: 0.42,
        },
      }),
    });

    for await (const event of turn.stream()) void event;

    expect(turn.state).toMatchObject({
      status: 'done',
      metrics: {
        total_input_tokens: 12,
        total_output_tokens: 5,
        total_tokens: 17,
        total_cache_read_tokens: 4,
        total_reasoning_tokens: 3,
        total_cost_in_usd: 0.42,
      },
    });
  });

  it('isolates billable usage across turns (Turn 2 does not include Turn 1)', async () => {
    const { session } = await createSession();

    const turn1 = await session.createTurn({
      turn_id: 'turn-isolation-1',
      input: [{ type: EventType.USER_MESSAGE, content: 'turn one' }],
      previous_turn_id: 'none',
      signal: new AbortController().signal,
      resolver: makeTestResolver({
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          total_tokens: 150,
          cache_read_tokens: 20,
          cost_in_usd: 1.5,
        },
      }),
    });
    for await (const event of turn1.stream()) void event;
    expect(turn1.state).toMatchObject({
      status: 'done',
      metrics: {
        total_input_tokens: 100,
        total_output_tokens: 50,
        total_tokens: 150,
        total_cache_read_tokens: 20,
        total_cost_in_usd: 1.5,
      },
    });

    const turn2 = await session.createTurn({
      turn_id: 'turn-isolation-2',
      input: [{ type: EventType.USER_MESSAGE, content: 'turn two' }],
      previous_turn_id: 'auto',
      signal: new AbortController().signal,
      resolver: makeTestResolver({
        usage: {
          input_tokens: 7,
          output_tokens: 3,
          total_tokens: 10,
          cache_read_tokens: 1,
          cost_in_usd: 0.05,
        },
      }),
    });
    for await (const event of turn2.stream()) void event;

    expect(turn2.state).toMatchObject({
      status: 'done',
      metrics: {
        total_input_tokens: 7,
        total_output_tokens: 3,
        total_tokens: 10,
        total_cache_read_tokens: 1,
        total_cost_in_usd: 0.05,
      },
    });
    // Explicitly not a sum with turn 1.
    expect(turn2.state.status === 'done' && turn2.state.metrics).not.toMatchObject({
      total_input_tokens: 107,
      total_output_tokens: 53,
      total_tokens: 160,
      total_cost_in_usd: 1.55,
    });
  });

  it('persists cache-read tokens on turn usage', async () => {
    const { session } = await createSession();
    const turn = await session.createTurn({
      turn_id: 'turn-cache-read',
      input: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
      previous_turn_id: 'none',
      signal: new AbortController().signal,
      resolver: makeTestResolver({
        usage: {
          input_tokens: 12,
          output_tokens: 5,
          total_tokens: 17,
          cache_read_tokens: 4,
          cost_in_usd: 0.42,
        },
      }),
    });

    for await (const event of turn.stream()) void event;

    expect(turn.state).toMatchObject({
      status: 'done',
      metrics: { total_cache_read_tokens: 4 },
    });
  });

  it('background drain reaches terminal done', async () => {
    const { session } = await createSession();
    const turn = await session.createTurn({
      turn_id: mintTestTurnId(),
      input: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
      previous_turn_id: 'none',
      signal: new AbortController().signal,
      resolver: makeTestResolver(),
    });
    await (async () => {
      for await (const event of turn.stream()) {
        void event;
        // drain
      }
    })();
    expect(turn.state.status).toBe('done');
  });

  it('second stream() call throws', async () => {
    const { session } = await createSession();
    const turn = await session.createTurn({
      turn_id: mintTestTurnId(),
      input: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
      previous_turn_id: 'none',
      signal: new AbortController().signal,
      resolver: makeTestResolver(),
    });
    for await (const event of turn.stream()) {
      void event;
      // drain
    }
    await expect(
      (async () => {
        for await (const event of turn.stream()) {
          void event;
          // should throw before yielding
        }
      })(),
    ).rejects.toThrow(/single-use/);
  });

  it('consumer break/abandon without abort writes cancelled ClientCancelled', async () => {
    const { store, session } = await createSession();
    let closeCalls = 0;
    const turn = await session.createTurn({
      turn_id: mintTestTurnId(),
      input: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
      previous_turn_id: 'none',
      signal: new AbortController().signal,
      resolver: makeTestResolver({
        close: () => {
          closeCalls += 1;
          return Promise.resolve();
        },
      }),
    });
    for await (const event of turn.stream()) {
      expect(event.type).toBe(EventType.TURN_CREATED);
      break;
    }
    expect(turn.state.status).toBe('cancelled');
    if (turn.state.status === 'cancelled') {
      expect(turn.state.reason).toBe(CancellationReason.ClientCancelled);
    }
    expect(closeCalls).toBe(1);
    const stored = await store.getTurn({
      session_id: 's1',
      turn_id: turn.id,
    });
    expect(stored?.state.status).toBe('cancelled');
  });

  it('abort mid-drain writes terminal cancelled', async () => {
    const { store, session } = await createSession();
    const controller = new AbortController();
    const turn = await session.createTurn({
      turn_id: mintTestTurnId(),
      input: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
      previous_turn_id: 'none',
      signal: controller.signal,
      resolver: makeTestResolver(),
    });
    controller.abort(CancellationReason.ClientCancelled);
    for await (const event of turn.stream()) {
      void event;
      // drain
    }
    expect(turn.state.status).toBe('cancelled');
    if (turn.state.status === 'cancelled') {
      expect(turn.state.reason).toBe(CancellationReason.ClientCancelled);
    }
    const stored = await store.getTurn({
      session_id: 's1',
      turn_id: turn.id,
    });
    expect(stored?.state.status).toBe('cancelled');
  });

  it('abort with Abandoned persists reason abandoned', async () => {
    const { store, session } = await createSession();
    const controller = new AbortController();
    const turn = await session.createTurn({
      turn_id: mintTestTurnId(),
      input: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
      previous_turn_id: 'none',
      signal: controller.signal,
      resolver: makeTestResolver(),
    });
    controller.abort(CancellationReason.Abandoned);
    for await (const event of turn.stream()) {
      void event;
    }
    expect(turn.state.status).toBe('cancelled');
    if (turn.state.status === 'cancelled') {
      expect(turn.state.reason).toBe(CancellationReason.Abandoned);
    }
    const stored = await store.getTurn({
      session_id: 's1',
      turn_id: turn.id,
    });
    expect(stored?.state.status).toBe('cancelled');
    if (stored?.state.status === 'cancelled') {
      expect(stored.state.reason).toBe(CancellationReason.Abandoned);
    }
  });

  it('abort with ServerExecutionTimeout persists reason server-execution-timeout', async () => {
    const { store, session } = await createSession();
    const controller = new AbortController();
    const turn = await session.createTurn({
      turn_id: mintTestTurnId(),
      input: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
      previous_turn_id: 'none',
      signal: controller.signal,
      resolver: makeTestResolver(),
    });
    controller.abort(CancellationReason.ServerExecutionTimeout);
    for await (const event of turn.stream()) {
      void event;
    }
    expect(turn.state.status).toBe('cancelled');
    if (turn.state.status === 'cancelled') {
      expect(turn.state.reason).toBe(CancellationReason.ServerExecutionTimeout);
    }
    const stored = await store.getTurn({
      session_id: 's1',
      turn_id: turn.id,
    });
    expect(stored?.state.status).toBe('cancelled');
    if (stored?.state.status === 'cancelled') {
      expect(stored.state.reason).toBe(CancellationReason.ServerExecutionTimeout);
    }
  });

  it('resolver.close() called once in finally; throwing close does not flip terminal state', async () => {
    const { store, session } = await createSession();
    let closeCalls = 0;
    const turn = await session.createTurn({
      turn_id: mintTestTurnId(),
      input: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
      previous_turn_id: 'none',
      signal: new AbortController().signal,
      resolver: makeTestResolver({
        close: () => {
          closeCalls += 1;
          return Promise.reject(new Error('close boom'));
        },
      }),
    });
    for await (const event of turn.stream()) {
      void event;
      // drain
    }
    expect(closeCalls).toBe(1);
    expect(turn.state.status).toBe('done');
    const stored = await store.getTurn({
      session_id: 's1',
      turn_id: turn.id,
    });
    expect(stored?.state.status).toBe('done');
  });

  it('TurnResourceResolver.close() closes sandbox handle once and is idempotent', async () => {
    const sandbox = makeStubPublicSandbox();
    const closeSpy = jest.spyOn(sandbox, 'close').mockResolvedValue(undefined);
    const logger = makeSilentLogger();
    const resolver = new TurnResourceResolver({
      llm: () =>
        Promise.resolve({
          modelClient: makeMockILLM({ create: jest.fn().mockImplementation(() => emptyLlmStream()) }),
          defaultModelParams: {},
        }),
      mcp: () => Promise.resolve({ url: 'http://localhost' }),
      mcpRequestTimeoutMs: 60_000,
      mcpConnectTimeoutMs: 5_000,
      sandboxProvider: () => Promise.resolve(sandbox),
      logger,
    });
    const { session } = await createSession();
    // Spec already has sandbox.enabled from createSession helper.
    const turn = await session.createTurn({
      turn_id: mintTestTurnId(),
      input: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
      previous_turn_id: 'none',
      signal: new AbortController().signal,
      resolver,
    });
    for await (const event of turn.stream()) {
      void event;
      // drain
    }
    expect(closeSpy).toHaveBeenCalledTimes(1);
    await resolver.close();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});

describe('TurnResourceResolver caches', () => {
  it('getOrCreateToolSource single-flights by id', async () => {
    const logger = makeSilentLogger();
    let creates = 0;
    const resolver = new (class extends TurnResourceResolver {
      async resolveTwice() {
        const create = async () => {
          creates += 1;
          await new Promise(r => setTimeout(r, 10));
          return new RemoteMCP({
            id: 'svc',
            name: 'svc',
            url: 'http://example.invalid',
            headers: {},
            logger,
            tracing: this.createTracing(),
            requestTimeoutMs: 60_000,
            connectTimeoutMs: 5_000,
            signal: new AbortController().signal,
          });
        };
        const [a, b] = await Promise.all([
          this.getOrCreateToolSource({ id: 'svc', create }),
          this.getOrCreateToolSource({ id: 'svc', create }),
        ]);
        expect(a).toBe(b);
      }
    })({
      llm: () => Promise.resolve({ modelClient: makeMockILLM(), defaultModelParams: {} }),
      mcp: () => Promise.resolve({ url: 'http://example.invalid' }),
      mcpRequestTimeoutMs: 60_000,
      mcpConnectTimeoutMs: 5_000,
      logger,
    });
    await resolver.resolveTwice();
    expect(creates).toBe(1);
  });

  it('resolveSandbox called once per run via SessionHandle.createTurn', async () => {
    const sandbox = makeStubPublicSandbox();
    jest.spyOn(sandbox, 'close').mockResolvedValue(undefined);
    let sandboxCreates = 0;
    const logger = makeSilentLogger();
    const resolver = new TurnResourceResolver({
      llm: () =>
        Promise.resolve({
          modelClient: makeMockILLM({ create: jest.fn().mockImplementation(() => emptyLlmStream()) }),
          defaultModelParams: {},
        }),
      mcp: () => Promise.resolve({ url: 'http://localhost' }),
      mcpRequestTimeoutMs: 60_000,
      mcpConnectTimeoutMs: 5_000,
      sandboxProvider: () => {
        sandboxCreates += 1;
        return Promise.resolve(sandbox);
      },
      logger,
    });
    const store = new InMemorySessionStore();
    const sessions = new Sessions({ sessionStore: store });
    const session = await sessions.create({
      tenant_id: 't',
      session_id: 's',
      created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
      agent: {
        type: 'inline',
        spec: makeAgentSpec({
          config: {
            sandbox: { enabled: true, file_downloads: true },
          },
        }),
      },
      external_id: null,
    });
    const turn = await session.createTurn({
      turn_id: mintTestTurnId(),
      input: [{ type: EventType.USER_MESSAGE, content: 'hi' }],
      previous_turn_id: 'none',
      signal: new AbortController().signal,
      resolver,
    });
    for await (const event of turn.stream()) {
      void event;
      // drain
    }
    expect(sandboxCreates).toBe(1);
  });
});
