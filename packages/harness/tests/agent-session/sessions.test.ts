import { EventType } from '../../src/agent-session/schemas/events';
import { Sessions } from '../../src/agent-session/Sessions';
import { InMemorySessionStore } from '../../src/agent-session/store/InMemorySessionStore';
import { makeAgentSpec, makeTestResolver } from './testHelpers';

describe('Sessions / SessionHandle / TurnHandle (storage + run)', () => {
  const tenant = 'tenant-1';

  it('create/get hydrates agent_spec', async () => {
    const store = new InMemorySessionStore<{ tag: string }>();
    const sessions = new Sessions<{ tag: string }>({ sessionStore: store });
    const created = await sessions.create({
      tenant_name: tenant,
      session_id: 's1',
      agent_spec: makeAgentSpec({ instructions: 'hydrate-me' }),
      custom: { tag: 'a' },
    });
    expect(created.agent_spec.instructions).toBe('hydrate-me');
    expect(created.custom).toEqual({ tag: 'a' });

    const loaded = await sessions.get({ tenant_name: tenant, session_id: 's1' });
    expect(loaded?.agent_spec.instructions).toBe('hydrate-me');
    expect(loaded?.session_id).toBe('s1');
  });

  it('run() happy path commits a running turn without executing', async () => {
    const store = new InMemorySessionStore();
    const sessions = new Sessions({ sessionStore: store });
    const session = await sessions.create({
      tenant_name: tenant,
      session_id: 's1',
      agent_spec: makeAgentSpec(),
    });
    const turn = await session.run({
      input: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
      previous_turn_id: null,
      signal: new AbortController().signal,
      resolver: makeTestResolver(),
      update_session_title_if_not_exist: 'From first message',
    });
    expect(turn.state.status).toBe('running');
    expect(turn.input).toHaveLength(1);

    const stored = await store.getTurn({
      tenant_name: tenant,
      session_id: 's1',
      turn_id: turn.id,
    });
    expect(stored?.state.status).toBe('running');
    const sessionRecord = await store.getSession({ tenant_name: tenant, session_id: 's1' });
    expect(sessionRecord?.title).toBe('From first message');
    expect(sessionRecord?.last_turn_id).toBe(turn.id);
  });

  it('custom value vs merge-fn', async () => {
    const store = new InMemorySessionStore<{ tag: string }, { n: number }>();
    const sessions = new Sessions({ sessionStore: store });
    const session = await sessions.create({
      tenant_name: tenant,
      session_id: 's1',
      agent_spec: makeAgentSpec(),
    });
    const t1 = await session.run({
      input: [{ type: EventType.USER_MESSAGE, content: 'one' }],
      previous_turn_id: null,
      signal: new AbortController().signal,
      resolver: makeTestResolver<{ n: number }>(),
      custom: { n: 1 },
    });
    expect(t1.custom).toEqual({ n: 1 });

    const t2 = await session.run({
      input: [{ type: EventType.USER_MESSAGE, content: 'two' }],
      previous_turn_id: 'auto',
      signal: new AbortController().signal,
      resolver: makeTestResolver<{ n: number }>(),
      custom: prev => ({ n: (prev?.n ?? 0) + 10 }),
    });
    expect(t2.custom).toEqual({ n: 11 });
  });

  it('previous_turn_id null creates a new root on a non-empty session', async () => {
    const store = new InMemorySessionStore();
    const sessions = new Sessions({ sessionStore: store });
    const session = await sessions.create({
      tenant_name: tenant,
      session_id: 's1',
      agent_spec: makeAgentSpec(),
    });
    const first = await session.run({
      input: [{ type: EventType.USER_MESSAGE, content: 'one' }],
      previous_turn_id: null,
      signal: new AbortController().signal,
      resolver: makeTestResolver(),
    });
    for await (const event of first.stream()) {
      void event;
      // drain
    }
    const root2 = await session.run({
      input: [{ type: EventType.USER_MESSAGE, content: 'fresh root' }],
      previous_turn_id: null,
      signal: new AbortController().signal,
      resolver: makeTestResolver(),
    });
    expect(root2.previous_turn_id).toBeUndefined();
    const sessionRecord = await store.getSession({ tenant_name: tenant, session_id: 's1' });
    expect(sessionRecord?.last_turn_id).toBe(root2.id);
  });

  it('send/validation failure in run() persists no turn', async () => {
    const store = new InMemorySessionStore();
    const sessions = new Sessions({ sessionStore: store });
    const session = await sessions.create({
      tenant_name: tenant,
      session_id: 's1',
      agent_spec: makeAgentSpec(),
    });
    await expect(
      session.run({
        // Mixed batch — rejected by SessionHandle.toSendBatch / orchestrator validation path.
        input: [
          { type: EventType.USER_MESSAGE, content: 'hi' },
          {
            type: EventType.USER_TOOL_APPROVAL,
            thread_id: 'main',
            tool_call_id: 'tc1',
            approval: { status: 'allow' },
          },
        ],
        previous_turn_id: null,
        signal: new AbortController().signal,
        resolver: makeTestResolver(),
      }),
    ).rejects.toThrow();
    const turns = await store.listTurns({
      tenant_name: tenant,
      session_id: 's1',
      limit: 10,
    });
    expect(turns.data).toHaveLength(0);
    const sessionRecord = await store.getSession({ tenant_name: tenant, session_id: 's1' });
    expect(sessionRecord?.last_turn_id).toBeUndefined();
  });

  it('run() failure closes the resolver; success defers close() to stream()', async () => {
    const store = new InMemorySessionStore();
    const sessions = new Sessions({ sessionStore: store });
    const session = await sessions.create({
      tenant_name: tenant,
      session_id: 's1',
      agent_spec: makeAgentSpec(),
    });

    // Failure path: resources acquired before the throw must be released.
    const closeOnFailure = jest.fn().mockResolvedValue(undefined);
    await expect(
      session.run({
        // Mixed batch — rejected after sandbox/thread resolution.
        input: [
          { type: EventType.USER_MESSAGE, content: 'hi' },
          {
            type: EventType.USER_TOOL_APPROVAL,
            thread_id: 'main',
            tool_call_id: 'tc1',
            approval: { status: 'allow' },
          },
        ],
        previous_turn_id: null,
        signal: new AbortController().signal,
        resolver: makeTestResolver({ close: closeOnFailure }),
      }),
    ).rejects.toThrow();
    expect(closeOnFailure).toHaveBeenCalledTimes(1);

    // Success path: run() must NOT close — TurnHandle.stream()'s finally owns it.
    const closeOnSuccess = jest.fn().mockResolvedValue(undefined);
    const turn = await session.run({
      input: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
      previous_turn_id: null,
      signal: new AbortController().signal,
      resolver: makeTestResolver({ close: closeOnSuccess }),
    });
    expect(closeOnSuccess).not.toHaveBeenCalled();
    for await (const event of turn.stream()) {
      void event;
      // drain
    }
    expect(closeOnSuccess).toHaveBeenCalledTimes(1);
  });
});
