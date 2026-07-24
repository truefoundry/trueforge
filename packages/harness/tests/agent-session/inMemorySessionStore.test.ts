import { MAIN_THREAD_ID } from '../../src/agent-session/models/TurnRecord';
import type { PersistedTurnEvent } from '../../src/agent-session/schemas/events';
import { CancellationReason } from '../../src/agent-session/schemas/turn';
import type { ISessionStore } from '../../src/agent-session/store/ISessionStore';
import { InMemorySessionStore } from '../../src/agent-session/store/InMemorySessionStore';
import { SessionStoreConflictError, SessionStoreNotFoundError } from '../../src/agent-session/store/SessionStoreErrors';
import { EventType, newEventId } from '../../src/core/events/schema';
import { getEmptyUsage } from '../../src/core/llm/LLMTypes';
import { makeAgentSpec, makeModelMessageEvent, makeRunningTurnRecord, makeTurnCreatedEvent } from './testHelpers';

function mustGet<T>(value: T | undefined | null, label = 'value'): T {
  if (value === undefined || value === null) {
    throw new Error(`Expected ${label} to be defined`);
  }
  return value;
}

/** Store contract suite — factory-injected so other backends can reuse it. */
function runStoreContractSuite(createStore: () => ISessionStore) {
  const tenant = 't1';
  const sessionId = 's1';

  async function seedSession(store: ISessionStore, agentSpec = makeAgentSpec()) {
    await store.createSession({
      tenant_name: tenant,
      session_id: sessionId,
      agent_spec: agentSpec,
    });
  }

  describe('session CRUD + activity', () => {
    it('createSession hydrates agent_spec and sets last_activity_timestamp_ms', async () => {
      const store = createStore();
      const before = Date.now();
      await seedSession(store);
      const session = await store.getSession({ tenant_name: tenant, session_id: sessionId });
      expect(session).toBeDefined();
      expect(mustGet(session).tenant_name).toBe(tenant);
      expect(mustGet(session).agent_spec.model.name).toBe('test-model');
      expect(mustGet(session).last_activity_timestamp_ms).toBeGreaterThanOrEqual(before);
      expect(mustGet(session).title).toBeNull();
    });

    it('getSession does not bump last_activity_timestamp_ms', async () => {
      const store = createStore();
      await seedSession(store);
      const first = await store.getSession({ tenant_name: tenant, session_id: sessionId });
      await new Promise(r => setTimeout(r, 5));
      const second = await store.getSession({ tenant_name: tenant, session_id: sessionId });
      expect(mustGet(second).last_activity_timestamp_ms).toBe(mustGet(first).last_activity_timestamp_ms);
    });

    it('updateSession patches only provided fields and bumps activity', async () => {
      const store = createStore();
      await seedSession(store);
      const before = await store.getSession({ tenant_name: tenant, session_id: sessionId });
      await new Promise(r => setTimeout(r, 5));
      const nextSpec = makeAgentSpec({ instructions: 'updated' });
      await store.updateSession({
        tenant_name: tenant,
        session_id: sessionId,
        agent_spec: nextSpec,
        title: 'Hello',
      });
      const after = await store.getSession({ tenant_name: tenant, session_id: sessionId });
      expect(mustGet(after).agent_spec.instructions).toBe('updated');
      expect(mustGet(after).title).toBe('Hello');
      expect(mustGet(after).last_activity_timestamp_ms).toBeGreaterThan(mustGet(before).last_activity_timestamp_ms);
    });

    it('createSession conflict when session already exists', async () => {
      const store = createStore();
      await seedSession(store);
      await expect(seedSession(store)).rejects.toBeInstanceOf(SessionStoreConflictError);
    });
  });

  describe('listSessions', () => {
    async function seedThreeSessions(store: ISessionStore) {
      for (const id of ['sa', 'sb', 'sc']) {
        await store.createSession({ tenant_name: tenant, session_id: id, agent_spec: makeAgentSpec() });
        await new Promise(r => setTimeout(r, 2));
      }
    }

    it('lists newest-first by default, asc on request, scoped to tenant', async () => {
      const store = createStore();
      await seedThreeSessions(store);
      await store.createSession({ tenant_name: 'other', session_id: 'sx', agent_spec: makeAgentSpec() });

      const desc = await store.listSessions({ tenant_name: tenant, limit: 10 });
      expect(desc.data.map(s => s.session_id)).toEqual(['sc', 'sb', 'sa']);

      const asc = await store.listSessions({ tenant_name: tenant, limit: 10, order: 'asc' });
      expect(asc.data.map(s => s.session_id)).toEqual(['sa', 'sb', 'sc']);
    });

    it('paginates with next/previous tokens and filters by created_at bounds', async () => {
      const store = createStore();
      await seedThreeSessions(store);

      const first = await store.listSessions({ tenant_name: tenant, limit: 2 });
      expect(first.data).toHaveLength(2);
      expect(first.pagination.next_page_token).toBeDefined();
      const second = await store.listSessions({
        tenant_name: tenant,
        limit: 2,
        page_token: first.pagination.next_page_token,
      });
      expect(second.data.map(s => s.session_id)).toEqual(['sa']);
      expect(second.pagination.next_page_token).toBeUndefined();

      const all = await store.listSessions({ tenant_name: tenant, limit: 10, order: 'asc' });
      const middleSession = all.data[1];
      if (!middleSession) throw new Error('expected middle session in list');
      const middleCreatedAt = middleSession.created_at;
      const bounded = await store.listSessions({
        tenant_name: tenant,
        limit: 10,
        order: 'asc',
        start_timestamp: middleCreatedAt,
        end_timestamp: middleCreatedAt,
      });
      expect(bounded.data.map(s => s.session_id)).toEqual(['sb']);
    });
  });

  describe('createTurn', () => {
    it('atomically links last_turn_id and bumps activity', async () => {
      const store = createStore();
      await seedSession(store);
      const before = await store.getSession({ tenant_name: tenant, session_id: sessionId });
      await new Promise(r => setTimeout(r, 5));
      const turn = makeRunningTurnRecord({ sessionId, turnId: 'turn-1' });
      await store.createTurn({ tenant_name: tenant, turn });
      const after = await store.getSession({ tenant_name: tenant, session_id: sessionId });
      expect(mustGet(after).last_turn_id).toBe('turn-1');
      expect(mustGet(after).last_activity_timestamp_ms).toBeGreaterThan(mustGet(before).last_activity_timestamp_ms);
    });

    it('update_session_title_if_not_exist sets once and never overwrites', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn({
        tenant_name: tenant,
        turn: makeRunningTurnRecord({ sessionId, turnId: 'turn-1' }),
        update_session_title_if_not_exist: 'First title',
      });
      await store.createTurn({
        tenant_name: tenant,
        turn: makeRunningTurnRecord({
          sessionId,
          turnId: 'turn-2',
          previousTurnId: 'turn-1',
          firstTurnId: 'turn-1',
        }),
        update_session_title_if_not_exist: 'Second title',
      });
      const session = await store.getSession({ tenant_name: tenant, session_id: sessionId });
      expect(mustGet(session).title).toBe('First title');
    });

    it('rejects unknown previous_turn_id with not-found', async () => {
      const store = createStore();
      await seedSession(store);
      await expect(
        store.createTurn({
          tenant_name: tenant,
          turn: makeRunningTurnRecord({
            sessionId,
            turnId: 'turn-2',
            previousTurnId: 'missing',
          }),
        }),
      ).rejects.toBeInstanceOf(SessionStoreNotFoundError);
    });

    it('fork from any existing turn succeeds and advances tip', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn({
        tenant_name: tenant,
        turn: makeRunningTurnRecord({ sessionId, turnId: 'turn-1' }),
      });
      await store.createTurn({
        tenant_name: tenant,
        turn: makeRunningTurnRecord({
          sessionId,
          turnId: 'turn-2',
          previousTurnId: 'turn-1',
          firstTurnId: 'turn-1',
        }),
      });
      // Fork from turn-1 (not the tip).
      await store.createTurn({
        tenant_name: tenant,
        turn: makeRunningTurnRecord({
          sessionId,
          turnId: 'turn-fork',
          previousTurnId: 'turn-1',
          firstTurnId: 'turn-1',
        }),
      });
      const session = await store.getSession({ tenant_name: tenant, session_id: sessionId });
      expect(mustGet(session).last_turn_id).toBe('turn-fork');
    });

    it('new root turn (no previous_turn_id) succeeds on non-empty session', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn({
        tenant_name: tenant,
        turn: makeRunningTurnRecord({ sessionId, turnId: 'turn-1' }),
      });
      await store.createTurn({
        tenant_name: tenant,
        turn: makeRunningTurnRecord({ sessionId, turnId: 'turn-root-2' }),
      });
      const session = await store.getSession({ tenant_name: tenant, session_id: sessionId });
      expect(mustGet(session).last_turn_id).toBe('turn-root-2');
    });

    it('concurrent createTurn forking the same tip: both succeed', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn({
        tenant_name: tenant,
        turn: makeRunningTurnRecord({ sessionId, turnId: 'tip' }),
      });
      const a = makeRunningTurnRecord({
        sessionId,
        turnId: 'turn-a',
        previousTurnId: 'tip',
        firstTurnId: 'tip',
      });
      const b = makeRunningTurnRecord({
        sessionId,
        turnId: 'turn-b',
        previousTurnId: 'tip',
        firstTurnId: 'tip',
      });
      const results = await Promise.allSettled([
        store.createTurn({ tenant_name: tenant, turn: a }),
        store.createTurn({ tenant_name: tenant, turn: b }),
      ]);
      expect(results.every(r => r.status === 'fulfilled')).toBe(true);
      const session = await store.getSession({ tenant_name: tenant, session_id: sessionId });
      expect(['turn-a', 'turn-b']).toContain(mustGet(session).last_turn_id);
      const turns = await store.listTurns({
        tenant_name: tenant,
        session_id: sessionId,
        limit: 10,
      });
      expect(turns.data.map(t => t.turn_id).sort()).toEqual(['tip', 'turn-a', 'turn-b']);
    });
  });

  describe('updateTurnState', () => {
    it('allows running → done and rejects second terminal (first-terminal-wins)', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn({
        tenant_name: tenant,
        turn: makeRunningTurnRecord({ sessionId, turnId: 'turn-1' }),
      });
      await store.updateTurnState({
        tenant_name: tenant,
        session_id: sessionId,
        turn_id: 'turn-1',
        state: {
          status: 'done',
          output: null,
          required_actions: [],
          completed_at: new Date().toISOString(),
        },
      });
      await expect(
        store.updateTurnState({
          tenant_name: tenant,
          session_id: sessionId,
          turn_id: 'turn-1',
          state: {
            status: 'cancelled',
            reason: CancellationReason.ClientCancelled,
            completed_at: new Date().toISOString(),
          },
        }),
      ).rejects.toBeInstanceOf(SessionStoreConflictError);
    });

    it('missing turn → not found', async () => {
      const store = createStore();
      await seedSession(store);
      await expect(
        store.updateTurnState({
          tenant_name: tenant,
          session_id: sessionId,
          turn_id: 'missing',
          state: {
            status: 'done',
            output: null,
            required_actions: [],
            completed_at: new Date().toISOString(),
          },
        }),
      ).rejects.toBeInstanceOf(SessionStoreNotFoundError);
    });
  });

  describe('events + threads + capability_state', () => {
    it('appendToEvents preserves order including lifecycle rows', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn({
        tenant_name: tenant,
        turn: makeRunningTurnRecord({ sessionId, turnId: 'turn-1' }),
      });
      const created = makeTurnCreatedEvent('turn-1');
      const model = makeModelMessageEvent();
      await store.appendToEvents({
        tenant_name: tenant,
        session_id: sessionId,
        turn_id: 'turn-1',
        events: [created, model],
      });
      const { data } = await store.listTurnEvents({
        tenant_name: tenant,
        session_id: sessionId,
        turn_id: 'turn-1',
        limit: 10,
      });
      expect(data.map(e => e.type)).toEqual(['turn.created', EventType.MODEL_MESSAGE]);
    });

    it('add/remove threads and append/overwrite context', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn({
        tenant_name: tenant,
        turn: makeRunningTurnRecord({ sessionId, turnId: 'turn-1' }),
      });
      await store.addThreads({
        tenant_name: tenant,
        session_id: sessionId,
        turn_id: 'turn-1',
        threads: [
          {
            thread_id: 'child',
            context: [],
            current_context_usage: getEmptyUsage(),
            parent: { thread_id: MAIN_THREAD_ID, tool_call_id: 'tc1' },
            agent_info: { type: 'dynamic', name: 'child', input: 'do work' },
          },
        ],
      });
      await store.appendToThreadContext({
        tenant_name: tenant,
        session_id: sessionId,
        turn_id: 'turn-1',
        thread_id: 'child',
        context: [{ role: 'user', content: 'hello' }],
      });
      let turn = await store.getTurn({ tenant_name: tenant, session_id: sessionId, turn_id: 'turn-1' });
      expect(turn?.snapshot.threads['child']?.context).toHaveLength(1);

      await store.overwriteThreadContext({
        tenant_name: tenant,
        session_id: sessionId,
        turn_id: 'turn-1',
        event: {
          type: EventType.AGENT_CONTEXT_OVERWRITE,
          id: newEventId(),
          created_at: new Date().toISOString(),
          thread_id: 'child',
          reason: 'compaction',
          context: [{ role: 'user', content: 'replaced' }],
          current_context_usage: getEmptyUsage(),
          compaction_llm_usage: getEmptyUsage(),
        },
      });
      turn = await store.getTurn({ tenant_name: tenant, session_id: sessionId, turn_id: 'turn-1' });
      expect(turn?.snapshot.threads['child']?.context).toEqual([{ role: 'user', content: 'replaced' }]);

      await store.removeThreads({
        tenant_name: tenant,
        session_id: sessionId,
        turn_id: 'turn-1',
        thread_ids: ['child'],
      });
      turn = await store.getTurn({ tenant_name: tenant, session_id: sessionId, turn_id: 'turn-1' });
      expect(turn?.snapshot.threads['child']).toBeUndefined();
    });

    it('patchThreadCapabilityState is LWW per key', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn({
        tenant_name: tenant,
        turn: makeRunningTurnRecord({ sessionId, turnId: 'turn-1' }),
      });
      await store.patchThreadCapabilityState({
        tenant_name: tenant,
        session_id: sessionId,
        turn_id: 'turn-1',
        thread_id: MAIN_THREAD_ID,
        key: 'tfy.plan',
        state: { v: 1 },
      });
      await store.patchThreadCapabilityState({
        tenant_name: tenant,
        session_id: sessionId,
        turn_id: 'turn-1',
        thread_id: MAIN_THREAD_ID,
        key: 'tfy.plan',
        state: { v: 2 },
      });
      const turn = await store.getTurn({ tenant_name: tenant, session_id: sessionId, turn_id: 'turn-1' });
      expect(turn?.snapshot.threads[MAIN_THREAD_ID]?.capability_state).toEqual({ 'tfy.plan': { v: 2 } });
    });

    it('patchMCPServers and patchSandboxInfo', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn({
        tenant_name: tenant,
        turn: makeRunningTurnRecord({ sessionId, turnId: 'turn-1' }),
      });
      await store.patchMCPServers({
        tenant_name: tenant,
        session_id: sessionId,
        turn_id: 'turn-1',
        mcp_servers: [{ id: 'svc', name: 'svc', session_id: 'mcp-1', transport_type: 'streamable-http' }],
      });
      await store.patchSandboxInfo({
        tenant_name: tenant,
        session_id: sessionId,
        turn_id: 'turn-1',
        sandbox_info: { sandbox_id: 'sbx-1' },
      });
      const turn = await store.getTurn({ tenant_name: tenant, session_id: sessionId, turn_id: 'turn-1' });
      expect(turn?.snapshot.mcp_servers?.['svc']?.session_id).toBe('mcp-1');
      expect(mustGet(turn).snapshot.sandbox_info?.sandbox_id).toBe('sbx-1');
    });
  });

  describe('pagination', () => {
    it('listTurns paginates with opaque tokens', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn({
        tenant_name: tenant,
        turn: makeRunningTurnRecord({ sessionId, turnId: 't1' }),
      });
      await store.createTurn({
        tenant_name: tenant,
        turn: makeRunningTurnRecord({
          sessionId,
          turnId: 't2',
          previousTurnId: 't1',
          firstTurnId: 't1',
        }),
      });
      await store.createTurn({
        tenant_name: tenant,
        turn: makeRunningTurnRecord({
          sessionId,
          turnId: 't3',
          previousTurnId: 't2',
          firstTurnId: 't1',
        }),
      });
      const page1 = await store.listTurns({
        tenant_name: tenant,
        session_id: sessionId,
        limit: 2,
      });
      expect(page1.data.map(t => t.turn_id)).toEqual(['t1', 't2']);
      expect(page1.pagination.next_page_token).toBeDefined();
      const page2 = await store.listTurns({
        tenant_name: tenant,
        session_id: sessionId,
        limit: 2,
        page_token: page1.pagination.next_page_token,
      });
      expect(page2.data.map(t => t.turn_id)).toEqual(['t3']);
    });

    it('listTurnEvents supports desc order', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn({
        tenant_name: tenant,
        turn: makeRunningTurnRecord({ sessionId, turnId: 'turn-1' }),
      });
      await store.appendToEvents({
        tenant_name: tenant,
        session_id: sessionId,
        turn_id: 'turn-1',
        events: [makeTurnCreatedEvent('turn-1'), makeModelMessageEvent()],
      });
      const { data } = await store.listTurnEvents({
        tenant_name: tenant,
        session_id: sessionId,
        turn_id: 'turn-1',
        limit: 10,
        order: 'desc',
      });
      expect(data[0]?.type).toBe(EventType.MODEL_MESSAGE);
    });

    it('listSessionEvents includes running turns and is newest-first', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn({
        tenant_name: tenant,
        turn: makeRunningTurnRecord({ sessionId, turnId: 't1' }),
      });
      await store.appendToEvents({
        tenant_name: tenant,
        session_id: sessionId,
        turn_id: 't1',
        events: [makeTurnCreatedEvent('t1')],
      });
      await store.updateTurnState({
        tenant_name: tenant,
        session_id: sessionId,
        turn_id: 't1',
        state: {
          status: 'done',
          output: null,
          required_actions: [],
          completed_at: new Date().toISOString(),
        },
      });
      await store.createTurn({
        tenant_name: tenant,
        turn: makeRunningTurnRecord({
          sessionId,
          turnId: 't2',
          previousTurnId: 't1',
          firstTurnId: 't1',
        }),
      });
      await store.appendToEvents({
        tenant_name: tenant,
        session_id: sessionId,
        turn_id: 't2',
        events: [makeTurnCreatedEvent('t2')],
      });
      // t2 still running — must appear in the feed.
      const { data } = await store.listSessionEvents({
        tenant_name: tenant,
        session_id: sessionId,
        limit: 10,
      });
      expect(data.map(row => row.turn_id)).toEqual(['t2', 't1']);
      expect(data.every(row => row.event.type === 'turn.created')).toBe(true);
    });

    it('listSessionEvents includes registered passthrough events', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn({
        tenant_name: tenant,
        turn: makeRunningTurnRecord({ sessionId, turnId: 't1' }),
      });
      const passthrough = {
        type: 'custom.event',
        event: { value: 1 },
      } as unknown as PersistedTurnEvent;
      await store.appendToEvents({
        tenant_name: tenant,
        session_id: sessionId,
        turn_id: 't1',
        events: [passthrough],
      });

      const { data } = await store.listSessionEvents({
        tenant_name: tenant,
        session_id: sessionId,
        limit: 10,
      });
      expect(data).toEqual([{ turn_id: 't1', event: passthrough }]);
    });

    it('listSessionEvents with last_turn_id scopes to that branch, excluding fork siblings', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn({
        tenant_name: tenant,
        turn: makeRunningTurnRecord({ sessionId, turnId: 't1' }),
      });
      // Two forks off t1; the sibling is created BEFORE the anchor, so a
      // creation-order prefix would wrongly include it.
      await store.createTurn({
        tenant_name: tenant,
        turn: makeRunningTurnRecord({ sessionId, turnId: 't2-sibling', previousTurnId: 't1', firstTurnId: 't1' }),
      });
      await store.createTurn({
        tenant_name: tenant,
        turn: makeRunningTurnRecord({ sessionId, turnId: 't2-anchor', previousTurnId: 't1', firstTurnId: 't1' }),
      });
      for (const turnId of ['t1', 't2-sibling', 't2-anchor']) {
        await store.appendToEvents({
          tenant_name: tenant,
          session_id: sessionId,
          turn_id: turnId,
          events: [makeTurnCreatedEvent(turnId)],
        });
      }
      const { data } = await store.listSessionEvents({
        tenant_name: tenant,
        session_id: sessionId,
        limit: 10,
        last_turn_id: 't2-anchor',
      });
      expect(data.map(row => row.turn_id)).toEqual(['t2-anchor', 't1']);

      await expect(
        store.listSessionEvents({
          tenant_name: tenant,
          session_id: sessionId,
          limit: 10,
          last_turn_id: 'missing',
        }),
      ).rejects.toBeInstanceOf(SessionStoreNotFoundError);
    });

    it('listSessionEvents spills through truncated ancestor_ids windows to reach the chain root', async () => {
      const store = createStore();
      await seedSession(store);
      // Writer-chosen window shorter than the chain — store must spill.
      const ancestorWindow = 3;
      const chainLength = ancestorWindow + 5;
      const ids = Array.from({ length: chainLength }, (_, i) => `t${String(i + 1)}`);
      for (let i = 0; i < ids.length; i++) {
        const turnId = mustGet(ids[i], `ids[${String(i)}]`);
        const window = ids.slice(Math.max(0, i - ancestorWindow), i);
        await store.createTurn({
          tenant_name: tenant,
          turn: {
            ...makeRunningTurnRecord({
              sessionId,
              turnId,
              ...(i > 0
                ? {
                    previousTurnId: mustGet(ids[i - 1], `ids[${String(i - 1)}]`),
                    firstTurnId: mustGet(ids[0], 'ids[0]'),
                  }
                : {}),
            }),
            ancestor_ids: window,
          },
        });
        await store.appendToEvents({
          tenant_name: tenant,
          session_id: sessionId,
          turn_id: turnId,
          events: [makeTurnCreatedEvent(turnId)],
        });
      }
      const tip = mustGet(ids.at(-1), 'chain tip');
      const { data } = await store.listSessionEvents({
        tenant_name: tenant,
        session_id: sessionId,
        limit: chainLength + 10,
        last_turn_id: tip,
      });
      // Full chain reachable despite truncated windows, newest first.
      expect(data.map(row => row.turn_id)).toEqual([...ids].reverse());
    });
  });

  describe('deep-copy boundary', () => {
    it('mutating a returned session does not mutate the store', async () => {
      const store = createStore();
      await seedSession(store);
      const session = await store.getSession({ tenant_name: tenant, session_id: sessionId });
      mustGet(session).agent_spec.instructions = 'mutated';
      const again = await store.getSession({ tenant_name: tenant, session_id: sessionId });
      expect(mustGet(again).agent_spec.instructions).toBe('You are a test agent.');
    });
  });

  describe('no SSE surface', () => {
    it('ISessionStore has no subscribe* members', () => {
      const store = createStore();
      const keys = Object.getOwnPropertyNames(Object.getPrototypeOf(store)).concat(Object.keys(store));
      expect(keys.some(k => k.startsWith('subscribe'))).toBe(false);
    });
  });
}

describe('InMemorySessionStore (ISessionStore contract)', () => {
  runStoreContractSuite(() => new InMemorySessionStore());
});
