import { EventType } from '../../src/agent-session/schemas/events';
import { CancellationReason } from '../../src/agent-session/schemas/turn';
import { Sessions } from '../../src/agent-session/Sessions';
import { InMemorySessionStore } from '../../src/agent-session/store/InMemorySessionStore';
import { TurnNotFoundError } from '../../src/agent-session/store/SessionStoreErrors';
import { TurnHandle } from '../../src/agent-session/TurnHandle';
import { makeAgentSpec, makeTestResolver, mintTestTurnId } from './testHelpers';

describe('Sessions / SessionHandle / TurnHandle (storage + createTurn)', () => {
  const tenant = 'tenant-1';

  it('create/get persists an inline value-agent session', async () => {
    const store = new InMemorySessionStore<{ tag: string }>();
    const sessions = new Sessions<{ tag: string }>({ sessionStore: store });
    const created = await sessions.create({
      tenant_id: tenant,
      session_id: 's1',
      created_by: 'user-1',
      agent: { type: 'inline', spec: makeAgentSpec({ instructions: 'hydrate-me' }) },
      custom: { tag: 'a' },
      external_id: null,
    });
    expect(created.agent).toEqual({
      type: 'inline',
      spec: expect.objectContaining({ instructions: 'hydrate-me' }),
    });
    expect(created.custom).toEqual({ tag: 'a' });

    const loaded = await sessions.get({ tenant_id: tenant, session_id: 's1' });
    expect(loaded?.agent).toEqual({
      type: 'inline',
      spec: expect.objectContaining({ instructions: 'hydrate-me' }),
    });
    expect(loaded?.session_id).toBe('s1');
  });

  it('getOrCreateByExternalId creates once and returns the existing row on retry', async () => {
    const store = new InMemorySessionStore();
    const sessions = new Sessions({ sessionStore: store });
    const agent = { type: 'inline' as const, spec: makeAgentSpec({ instructions: 'first' }) };

    const first = await sessions.getOrCreateByExternalId({
      tenant_id: tenant,
      created_by: 'user-1',
      agent,
      external_id: 'run-1',
    });
    expect(first.created).toBe(true);
    expect(first.session.record.external_id).toBe('run-1');

    const again = await sessions.getOrCreateByExternalId({
      tenant_id: tenant,
      created_by: 'other',
      agent: { type: 'inline', spec: makeAgentSpec({ instructions: 'ignored' }) },
      external_id: 'run-1',
    });
    expect(again.created).toBe(false);
    expect(again.session.session_id).toBe(first.session.session_id);
    expect(again.session.record.created_by).toBe('user-1');
    expect(again.session.agent).toEqual({
      type: 'inline',
      spec: expect.objectContaining({ instructions: 'first' }),
    });
  });

  it('getOrCreateByExternalId returns the winner when create loses the unique race', async () => {
    const store = new InMemorySessionStore();
    const sessions = new Sessions({ sessionStore: store });
    const agent = { type: 'inline' as const, spec: makeAgentSpec() };

    await sessions.create({
      tenant_id: tenant,
      session_id: 'winner',
      created_by: 'user-1',
      agent,
      external_id: 'run-1',
    });

    const getByExternalId = jest.spyOn(sessions, 'getByExternalId');
    getByExternalId.mockResolvedValueOnce(undefined);

    const { session, created } = await sessions.getOrCreateByExternalId({
      tenant_id: tenant,
      created_by: 'user-2',
      agent,
      external_id: 'run-1',
    });
    expect(created).toBe(false);
    expect(session.session_id).toBe('winner');
  });

  it('run() happy path commits a running turn without executing', async () => {
    const store = new InMemorySessionStore();
    const sessions = new Sessions({ sessionStore: store });
    const session = await sessions.create({
      tenant_id: tenant,
      session_id: 's1',
      created_by: 'user-1',
      agent: { type: 'inline', spec: makeAgentSpec() },
      external_id: null,
    });
    const turn = await session.createTurn({
      turn_id: mintTestTurnId(),
      input: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
      previous_turn_id: 'none',
      signal: new AbortController().signal,
      resolver: makeTestResolver(),
      update_session_title_if_not_exist: 'From first message',
    });
    expect(turn.state.status).toBe('running');
    expect(turn.input).toHaveLength(1);

    const stored = await store.getTurn({
      session_id: 's1',
      turn_id: turn.id,
    });
    expect(stored?.state.status).toBe('running');
    const sessionRecord = await store.getSession({ tenant_id: tenant, session_id: 's1' });
    expect(sessionRecord?.title).toBe('From first message');
    expect(sessionRecord?.last_turn_id).toBe(turn.id);
  });

  it('loads turn handles without reading the session', async () => {
    const store = new InMemorySessionStore();
    const sessions = new Sessions({ sessionStore: store });
    const session = await sessions.create({
      tenant_id: tenant,
      session_id: 's1',
      created_by: 'user-1',
      agent: { type: 'inline', spec: makeAgentSpec() },
      external_id: null,
    });
    const created = await session.createTurn({
      turn_id: mintTestTurnId(),
      previous_turn_id: 'none',
      signal: new AbortController().signal,
      resolver: makeTestResolver(),
    });
    const getSession = jest.spyOn(store, 'getSession');

    const direct = await TurnHandle.get({
      store,
      session_id: 's1',
      turn_id: created.id,
    });
    const throughSession = await session.getTurn(created.id);
    const missingDirect = await TurnHandle.get({
      store,
      session_id: 's1',
      turn_id: 'missing-turn',
    });
    const missingThroughSession = await session.getTurn('missing-turn');

    expect(direct?.id).toBe(created.id);
    expect(throughSession?.id).toBe(created.id);
    expect(missingDirect).toBeUndefined();
    expect(missingThroughSession).toBeUndefined();
    expect(getSession).not.toHaveBeenCalled();
  });

  it('freezeTurn cancels a running turn with the given reason', async () => {
    const store = new InMemorySessionStore();
    const sessions = new Sessions({ sessionStore: store });
    const session = await sessions.create({
      tenant_id: tenant,
      session_id: 's1',
      created_by: 'user-1',
      agent: { type: 'inline', spec: makeAgentSpec() },
      external_id: null,
    });
    const turn = await session.createTurn({
      turn_id: mintTestTurnId(),
      previous_turn_id: 'none',
      signal: new AbortController().signal,
      resolver: makeTestResolver(),
    });
    const frozen = await session.freezeTurn({
      turn_id: turn.id,
      reason: CancellationReason.ClientCancelled,
    });
    expect(frozen.state).toMatchObject({
      status: 'cancelled',
      reason: CancellationReason.ClientCancelled,
    });
    await expect(
      session.freezeTurn({ turn_id: 'missing-turn', reason: CancellationReason.ClientCancelled }),
    ).rejects.toBeInstanceOf(TurnNotFoundError);
  });

  it('custom value vs merge-fn', async () => {
    const store = new InMemorySessionStore<{ tag: string }, { n: number }>();
    const sessions = new Sessions({ sessionStore: store });
    const session = await sessions.create({
      tenant_id: tenant,
      session_id: 's1',
      created_by: 'user-1',
      agent: { type: 'inline', spec: makeAgentSpec() },
      external_id: null,
    });
    const t1 = await session.createTurn({
      turn_id: mintTestTurnId(),
      input: [{ type: EventType.USER_MESSAGE, content: 'one' }],
      previous_turn_id: 'none',
      signal: new AbortController().signal,
      resolver: makeTestResolver<{ n: number }>(),
      custom: { n: 1 },
    });
    expect(t1.custom).toEqual({ n: 1 });

    const t2 = await session.createTurn({
      turn_id: mintTestTurnId(),
      input: [{ type: EventType.USER_MESSAGE, content: 'two' }],
      previous_turn_id: 'auto',
      signal: new AbortController().signal,
      resolver: makeTestResolver<{ n: number }>(),
      custom: prev => ({ n: (prev?.n ?? 0) + 10 }),
    });
    expect(t2.custom).toEqual({ n: 11 });
  });

  it('previous_turn_id none creates a new root on a non-empty session', async () => {
    const store = new InMemorySessionStore();
    const sessions = new Sessions({ sessionStore: store });
    const session = await sessions.create({
      tenant_id: tenant,
      session_id: 's1',
      created_by: 'user-1',
      agent: { type: 'inline', spec: makeAgentSpec() },
      external_id: null,
    });
    const first = await session.createTurn({
      turn_id: mintTestTurnId(),
      input: [{ type: EventType.USER_MESSAGE, content: 'one' }],
      previous_turn_id: 'none',
      signal: new AbortController().signal,
      resolver: makeTestResolver(),
    });
    for await (const event of first.stream()) {
      void event;
      // drain
    }
    const root2 = await session.createTurn({
      turn_id: mintTestTurnId(),
      input: [{ type: EventType.USER_MESSAGE, content: 'fresh root' }],
      previous_turn_id: 'none',
      signal: new AbortController().signal,
      resolver: makeTestResolver(),
    });
    expect(root2.previous_turn_id).toBeNull();
    const sessionRecord = await store.getSession({ tenant_id: tenant, session_id: 's1' });
    expect(sessionRecord?.last_turn_id).toBe(root2.id);
  });

  it('send/validation failure in run() persists no turn', async () => {
    const store = new InMemorySessionStore();
    const sessions = new Sessions({ sessionStore: store });
    const session = await sessions.create({
      tenant_id: tenant,
      session_id: 's1',
      created_by: 'user-1',
      agent: { type: 'inline', spec: makeAgentSpec() },
      external_id: null,
    });
    await expect(
      session.createTurn({
        turn_id: mintTestTurnId(),
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
        previous_turn_id: 'none',
        signal: new AbortController().signal,
        resolver: makeTestResolver(),
      }),
    ).rejects.toThrow();
    const turns = await store.listTurns({
      session_id: 's1',
      limit: 10,
      page_token: undefined,
    });
    expect(turns.data).toHaveLength(0);
    const sessionRecord = await store.getSession({ tenant_id: tenant, session_id: 's1' });
    expect(sessionRecord?.last_turn_id).toBeNull();
  });

  it('run() failure closes the resolver; success defers close() to stream()', async () => {
    const store = new InMemorySessionStore();
    const sessions = new Sessions({ sessionStore: store });
    const session = await sessions.create({
      tenant_id: tenant,
      session_id: 's1',
      created_by: 'user-1',
      agent: { type: 'inline', spec: makeAgentSpec() },
      external_id: null,
    });

    // Failure path: resources acquired before the throw must be released.
    const closeOnFailure = jest.fn().mockResolvedValue(undefined);
    await expect(
      session.createTurn({
        turn_id: mintTestTurnId(),
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
        previous_turn_id: 'none',
        signal: new AbortController().signal,
        resolver: makeTestResolver({ close: closeOnFailure }),
      }),
    ).rejects.toThrow();
    expect(closeOnFailure).toHaveBeenCalledTimes(1);

    // Success path: run() must NOT close — TurnHandle.stream()'s finally owns it.
    const closeOnSuccess = jest.fn().mockResolvedValue(undefined);
    const turn = await session.createTurn({
      turn_id: mintTestTurnId(),
      input: [{ type: EventType.USER_MESSAGE, content: 'hello' }],
      previous_turn_id: 'none',
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
