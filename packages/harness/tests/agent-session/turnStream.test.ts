import { EventType } from '../../src/agent-session/schemas/events';
import { CancellationReason } from '../../src/agent-session/schemas/turn';
import { Sessions } from '../../src/agent-session/Sessions';
import { InMemorySessionStore } from '../../src/agent-session/store/InMemorySessionStore';
import { TurnResourceResolver } from '../../src/agent-session/TurnResourceResolver';
import { RemoteMCP } from '../../src/core/mcp/RemoteMCP';
import { makeStubPublicSandbox } from '../core/harnessMocks';
import { emptyLlmStream, makeAgentSpec, makeMockILLM, makeSilentLogger, makeTestResolver } from './testHelpers';

describe('TurnHandle.stream()', () => {
  const tenant = 'tenant-1';

  async function createSession() {
    const store = new InMemorySessionStore();
    const sessions = new Sessions({ sessionStore: store });
    const session = await sessions.create({
      tenant_name: tenant,
      session_id: 's1',
      agent_spec: makeAgentSpec({
        config: {
          sandbox: { enabled: true, file_downloads: true },
        },
      }),
    });
    return { store, session };
  }

  it('run commits running turn; stream is sole terminal writer → done', async () => {
    const { store, session } = await createSession();
    const turn = await session.run({
      input: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
      previous_turn_id: null,
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
    expect(turn.state.status).toBe('done');

    const { data } = await turn.listEvents({ limit: 50 });
    expect(data.some(e => e.type === EventType.TURN_CREATED)).toBe(true);
    expect(data.some(e => e.type === EventType.TURN_DONE)).toBe(true);

    const stored = await store.getTurn({
      tenant_name: tenant,
      session_id: 's1',
      turn_id: turn.id,
    });
    expect(stored?.state.status).toBe('done');
  });

  it('background drain reaches terminal done', async () => {
    const { session } = await createSession();
    const turn = await session.run({
      input: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
      previous_turn_id: null,
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
    const turn = await session.run({
      input: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
      previous_turn_id: null,
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
    const turn = await session.run({
      input: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
      previous_turn_id: null,
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
      tenant_name: tenant,
      session_id: 's1',
      turn_id: turn.id,
    });
    expect(stored?.state.status).toBe('cancelled');
  });

  it('abort mid-drain writes terminal cancelled', async () => {
    const { store, session } = await createSession();
    const controller = new AbortController();
    const turn = await session.run({
      input: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
      previous_turn_id: null,
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
      tenant_name: tenant,
      session_id: 's1',
      turn_id: turn.id,
    });
    expect(stored?.state.status).toBe('cancelled');
  });

  it('resolver.close() called once in finally; throwing close does not flip terminal state', async () => {
    const { store, session } = await createSession();
    let closeCalls = 0;
    const turn = await session.run({
      input: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
      previous_turn_id: null,
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
      tenant_name: tenant,
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
      llm: () => makeMockILLM({ create: jest.fn().mockImplementation(() => emptyLlmStream()) }),
      mcp: () => Promise.resolve({ url: 'http://localhost' }),
      sandboxProvider: () => Promise.resolve(sandbox),
      logger,
    });
    const { session } = await createSession();
    // Spec already has sandbox.enabled from createSession helper.
    const turn = await session.run({
      input: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
      previous_turn_id: null,
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
      llm: () => makeMockILLM(),
      mcp: () => Promise.resolve({ url: 'http://example.invalid' }),
      logger,
    });
    await resolver.resolveTwice();
    expect(creates).toBe(1);
  });

  it('resolveSandbox called once per run via SessionHandle.run', async () => {
    const sandbox = makeStubPublicSandbox();
    jest.spyOn(sandbox, 'close').mockResolvedValue(undefined);
    let sandboxCreates = 0;
    const logger = makeSilentLogger();
    const resolver = new TurnResourceResolver({
      llm: () => makeMockILLM({ create: jest.fn().mockImplementation(() => emptyLlmStream()) }),
      mcp: () => Promise.resolve({ url: 'http://localhost' }),
      sandboxProvider: () => {
        sandboxCreates += 1;
        return Promise.resolve(sandbox);
      },
      logger,
    });
    const store = new InMemorySessionStore();
    const sessions = new Sessions({ sessionStore: store });
    const session = await sessions.create({
      tenant_name: 't',
      session_id: 's',
      agent_spec: makeAgentSpec({
        config: {
          sandbox: { enabled: true, file_downloads: true },
        },
      }),
    });
    const turn = await session.run({
      input: [{ type: EventType.USER_MESSAGE, content: 'hi' }],
      previous_turn_id: null,
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
