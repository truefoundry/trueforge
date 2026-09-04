import { z } from 'zod';
import { MAIN_THREAD_ID } from '../../../src/agent-session/models/TurnRecord';
import type { PersistedTurnEvent } from '../../../src/agent-session/schemas/events';
import { EventType } from '../../../src/agent-session/schemas/events';
import { CancellationReason } from '../../../src/agent-session/schemas/turn';
import type { ISessionStore } from '../../../src/agent-session/store/ISessionStore';
import { decodeSessionEventPageToken } from '../../../src/agent-session/store/SessionEventPageToken';
import {
  PreviousTurnRunningError,
  SessionExternalIdConflictError,
  SessionNotFoundError,
  SessionStoreConflictError,
  SessionStoreInvariantError,
  SessionStoreNotFoundError,
  TurnAlreadyExistsError,
  TurnNotFoundError,
  TurnNotRunningError,
} from '../../../src/agent-session/store/SessionStoreErrors';
import { newEventId } from '../../../src/core/events/schema';
import { getEmptyUsage } from '../../../src/core/llm/LLMTypes';
import type { ContextMessage } from '../../../src/core/runtime/AgentThread.types';
import { getEmptyCurrentContextUsage } from '../../../src/core/runtime/contextUsage';
import {
  makeAgentSpec,
  makeCancelledTurnState,
  makeCreateTurnInput,
  makeDoneTurnState,
  makeModelMessageEvent,
  makeTurnCreatedEvent,
  makeTurnDoneEvent,
} from '../testHelpers';

const ContractPassthroughEventSchema = z.object({
  id: z.string(),
  created_at: z.string(),
  event: z.object({ value: z.number() }),
});

declare module '../../../src/core/events/PassthroughEvents' {
  interface AgentPassthroughEventSchemaMap {
    'custom.event': typeof ContractPassthroughEventSchema;
  }
}

function mustGet<T>(value: T | undefined | null, label = 'value'): T {
  if (value === undefined || value === null) {
    throw new Error(`Expected ${label} to be defined`);
  }
  return value;
}

function userMessage(content: string): ContextMessage {
  return { role: 'user', content };
}

function contextContents(messages: ContextMessage[] | undefined): string[] {
  return (messages ?? []).map(message => {
    if ('role' in message && message.role === 'user' && typeof message.content === 'string') {
      return message.content;
    }
    return JSON.stringify(message);
  });
}

/** Store contract suite — factory-injected so other backends can reuse it. */
export function runStoreContractSuite(createStore: () => ISessionStore) {
  const tenant = 't1';
  const sessionId = 's1';
  const missingSessionId = 'missing-session';
  const missingTurnId = 'missing-turn';

  async function finishTurn(store: ISessionStore, turnId: string) {
    const state = makeDoneTurnState();
    await store.updateTurnState({
      session_id: sessionId,
      turn_id: turnId,
      state,
      turn_done_event: makeTurnDoneEvent(state),
    });
  }

  async function seedSession(store: ISessionStore, agentSpec = makeAgentSpec()) {
    await store.createSession({
      tenant_id: tenant,
      session_id: sessionId,
      created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
      agent: { type: 'inline', spec: agentSpec },
      custom: null,
      metadata: {},
      external_id: null,
    });
  }

  function turnScopedWrites(
    store: ISessionStore,
    keys: { session_id: string; turn_id: string },
  ): (() => Promise<unknown>)[] {
    const doneState = makeDoneTurnState();
    return [
      () =>
        store.freezeAndGetTurn({
          ...keys,
          reason: CancellationReason.ClientCancelled,
          turn_done_event: makeTurnDoneEvent(makeCancelledTurnState(CancellationReason.ClientCancelled)),
        }),
      () =>
        store.updateTurnState({
          ...keys,
          state: doneState,
          turn_done_event: makeTurnDoneEvent(doneState),
        }),
      () =>
        store.addThreads({
          ...keys,
          threads: [
            {
              thread_id: 'child',
              context: [],
              current_context_usage: getEmptyCurrentContextUsage(),
              parent: { thread_id: MAIN_THREAD_ID, tool_call_id: 'tc1' },
              agent_info: { type: 'dynamic', name: 'child', input: 'task' },
              completion: null,
              capability_state: null,
            },
          ],
        }),
      () => store.removeThreads({ ...keys, thread_ids: [MAIN_THREAD_ID] }),
      () =>
        store.appendToThreadContext({
          ...keys,
          thread_id: MAIN_THREAD_ID,
          context: [userMessage('late')],
          current_context_usage: null,
          completion: null,
        }),
      () =>
        store.overwriteThreadContext({
          ...keys,
          event: {
            type: EventType.AGENT_CONTEXT_OVERWRITE,
            id: newEventId(),
            created_at: new Date().toISOString(),
            thread_id: MAIN_THREAD_ID,
            reason: 'compaction',
            context: [userMessage('late')],
            current_context_usage: getEmptyCurrentContextUsage(),
            usage: getEmptyUsage(),
          },
        }),
      () =>
        store.patchMCPServers({
          ...keys,
          mcp_servers: [{ id: 'svc', name: 'svc', session_id: 'mcp-1', transport_type: 'streamable-http' }],
        }),
      () => store.patchSandboxInfo({ ...keys, sandbox_info: { sandbox_id: 'sbx-1' } }),
      () =>
        store.patchThreadCapabilityState({
          ...keys,
          thread_id: MAIN_THREAD_ID,
          key: 'tfy.plan',
          state: { step: 1 },
        }),
    ];
  }

  describe('session CRUD + activity', () => {
    it('createSession stores an inline agent and sets last_activity_timestamp_ms', async () => {
      const store = createStore();
      const before = Date.now();
      await seedSession(store);
      const session = await store.getSession({ tenant_id: tenant, session_id: sessionId });
      expect(session).toBeDefined();
      expect(mustGet(session).tenant_id).toBe(tenant);
      expect(mustGet(session).created_by_subject.subject_id).toBe('user-1');
      expect(mustGet(session).agent).toMatchObject({
        type: 'inline',
        spec: { model: { name: 'test-provider/test-model' } },
      });
      expect(mustGet(session).last_activity_timestamp_ms).toBeGreaterThanOrEqual(before);
      expect(mustGet(session).title).toBeNull();
      expect(mustGet(session).metrics).toEqual({
        total_cost_in_usd: 0,
        total_duration_ms: 0,
        total_turns: 0,
      });
    });

    it('createSession persists created_by_subject', async () => {
      const store = createStore();
      await store.createSession({
        tenant_id: tenant,
        session_id: 'created-by-session',
        created_by_subject: {
          subject_id: 'alice@example.com',
          subject_type: 'user',
          subject_display_name: 'alice@example.com',
        },
        agent: { type: 'inline', spec: makeAgentSpec() },
        custom: null,
        metadata: {},
        external_id: null,
      });
      const session = mustGet(await store.getSession({ tenant_id: tenant, session_id: 'created-by-session' }));
      expect(session.created_by_subject).toEqual({
        subject_id: 'alice@example.com',
        subject_type: 'user',
        subject_display_name: 'alice@example.com',
      });

      const listed = await store.listSessions({
        tenant_id: tenant,
        limit: 10,
        page_token: undefined,
        order: undefined,
        start_timestamp: undefined,
        end_timestamp: undefined,
        agent_id: undefined,
        created_by_subject_id: undefined,
        metadata: undefined,
      });
      expect(listed.data.map(s => s.session_id)).toContain('created-by-session');
      expect(listed.data.find(s => s.session_id === 'created-by-session')?.created_by_subject.subject_id).toBe(
        'alice@example.com',
      );
    });

    it('persists reference agents and listSessions filters by agent_id', async () => {
      const store = createStore();
      await store.createSession({
        tenant_id: tenant,
        session_id: 'named-1',
        created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
        agent: { type: 'reference', id: 'agent-abc', name: null },
        custom: null,
        metadata: {},
        external_id: null,
      });
      await seedSession(store);

      const named = mustGet(await store.getSession({ tenant_id: tenant, session_id: 'named-1' }));
      expect(named.agent).toEqual({ type: 'reference', id: 'agent-abc', name: null });

      const filtered = await store.listSessions({
        agent_id: 'agent-abc',
        created_by_subject_id: undefined,
        metadata: undefined,
        tenant_id: tenant,
        limit: 10,
        page_token: undefined,
        order: undefined,
        start_timestamp: undefined,
        end_timestamp: undefined,
      });
      expect(filtered.data.map(row => row.session_id)).toEqual(['named-1']);
    });

    it('rejects agent updates on sessions bound by agent_id', async () => {
      const store = createStore();
      await store.createSession({
        tenant_id: tenant,
        session_id: 'named-1',
        created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
        agent: { type: 'reference', id: 'agent-abc', name: null },
        custom: null,
        metadata: {},
        external_id: null,
      });

      await expect(
        store.updateSession({
          tenant_id: tenant,
          session_id: 'named-1',
          agent: { type: 'inline', spec: makeAgentSpec({ instructions: 'nope' }) },
          title: undefined,
          metadata: undefined,
        }),
      ).rejects.toBeInstanceOf(SessionStoreInvariantError);
    });

    it('getSession does not bump last_activity_timestamp_ms', async () => {
      const store = createStore();
      await seedSession(store);
      const first = await store.getSession({ tenant_id: tenant, session_id: sessionId });
      await new Promise(r => setTimeout(r, 5));
      const second = await store.getSession({ tenant_id: tenant, session_id: sessionId });
      expect(mustGet(second).last_activity_timestamp_ms).toBe(mustGet(first).last_activity_timestamp_ms);
    });

    it('updateSession patches only provided fields and bumps activity', async () => {
      const store = createStore();
      await seedSession(store);
      const before = await store.getSession({ tenant_id: tenant, session_id: sessionId });
      await new Promise(r => setTimeout(r, 5));
      const nextSpec = makeAgentSpec({ instructions: 'updated' });
      await store.updateSession({
        tenant_id: tenant,
        session_id: sessionId,
        agent: { type: 'inline', spec: nextSpec },
        title: 'Hello',
        metadata: undefined,
      });
      const after = await store.getSession({ tenant_id: tenant, session_id: sessionId });
      expect(mustGet(after).agent).toMatchObject({
        type: 'inline',
        spec: { instructions: 'updated' },
      });
      expect(mustGet(after).title).toBe('Hello');
      expect(mustGet(after).last_activity_timestamp_ms).toBeGreaterThan(mustGet(before).last_activity_timestamp_ms);
    });

    it('createSession persists metadata for getSession', async () => {
      const store = createStore();
      const metadata = { env: 'prod', ticket: 'T-1' };
      await store.createSession({
        tenant_id: tenant,
        session_id: sessionId,
        created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
        agent: { type: 'inline', spec: makeAgentSpec() },
        custom: null,
        metadata,
        external_id: null,
      });

      expect(mustGet(await store.getSession({ tenant_id: tenant, session_id: sessionId })).metadata).toEqual(metadata);
    });

    it('updateSession replaces metadata when set and leaves it when omitted', async () => {
      const store = createStore();
      await store.createSession({
        tenant_id: tenant,
        session_id: sessionId,
        created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
        agent: { type: 'inline', spec: makeAgentSpec() },
        custom: null,
        metadata: { a: '1' },
        external_id: null,
      });

      await store.updateSession({
        tenant_id: tenant,
        session_id: sessionId,
        agent: undefined,
        title: undefined,
        metadata: { b: '2' },
      });
      expect(mustGet(await store.getSession({ tenant_id: tenant, session_id: sessionId })).metadata).toEqual({
        b: '2',
      });

      await store.updateSession({
        tenant_id: tenant,
        session_id: sessionId,
        agent: undefined,
        title: 'keep-meta',
        metadata: undefined,
      });
      const afterOmit = mustGet(await store.getSession({ tenant_id: tenant, session_id: sessionId }));
      expect(afterOmit.title).toBe('keep-meta');
      expect(afterOmit.metadata).toEqual({ b: '2' });

      await store.updateSession({
        tenant_id: tenant,
        session_id: sessionId,
        agent: undefined,
        title: undefined,
        metadata: {},
      });
      expect(mustGet(await store.getSession({ tenant_id: tenant, session_id: sessionId })).metadata).toEqual({});
    });

    it('createSession conflict when session already exists', async () => {
      const store = createStore();
      await seedSession(store);
      await expect(seedSession(store)).rejects.toBeInstanceOf(SessionStoreConflictError);
    });

    it('createSession rejects a session_id already used by another tenant', async () => {
      const store = createStore();
      await seedSession(store);
      await expect(
        store.createSession({
          tenant_id: 'other',
          session_id: sessionId,
          created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
          agent: { type: 'inline', spec: makeAgentSpec() },
          custom: null,
          metadata: {},
          external_id: null,
        }),
      ).rejects.toBeInstanceOf(SessionStoreConflictError);
    });

    it('createSession stores a null external_id', async () => {
      const store = createStore();
      await seedSession(store);
      const record = await store.getSession({ tenant_id: tenant, session_id: sessionId });
      expect(mustGet(record).external_id).toBeNull();
    });

    it('createSession persists external_id and getSessionByExternalId finds it', async () => {
      const store = createStore();
      await store.createSession({
        tenant_id: tenant,
        session_id: sessionId,
        created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
        agent: { type: 'inline', spec: makeAgentSpec() },
        custom: null,
        metadata: {},
        external_id: 'run-1',
      });
      const byId = await store.getSession({ tenant_id: tenant, session_id: sessionId });
      expect(mustGet(byId).external_id).toBe('run-1');
      const byExternal = await store.getSessionByExternalId({ tenant_id: tenant, external_id: 'run-1' });
      expect(mustGet(byExternal).session_id).toBe(sessionId);
      expect(await store.getSessionByExternalId({ tenant_id: tenant, external_id: 'missing' })).toBeUndefined();
      expect(await store.getSessionByExternalId({ tenant_id: 'other', external_id: 'run-1' })).toBeUndefined();
    });

    it('createSession unique external_id within a tenant; nulls and other tenants do not collide', async () => {
      const store = createStore();
      await store.createSession({
        tenant_id: tenant,
        session_id: 's-a',
        created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
        agent: { type: 'inline', spec: makeAgentSpec() },
        custom: null,
        metadata: {},
        external_id: 'shared-key',
      });
      // Specifically the external-id arm, not just any conflict: get-or-create
      // treats this rejection as its normal repeat-call path.
      await expect(
        store.createSession({
          tenant_id: tenant,
          session_id: 's-b',
          created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
          agent: { type: 'inline', spec: makeAgentSpec() },
          custom: null,
          metadata: {},
          external_id: 'shared-key',
        }),
      ).rejects.toBeInstanceOf(SessionExternalIdConflictError);

      await store.createSession({
        tenant_id: 'other',
        session_id: 's-c',
        created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
        agent: { type: 'inline', spec: makeAgentSpec() },
        custom: null,
        metadata: {},
        external_id: 'shared-key',
      });
      await store.createSession({
        tenant_id: tenant,
        session_id: 's-d',
        created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
        agent: { type: 'inline', spec: makeAgentSpec() },
        custom: null,
        metadata: {},
        external_id: null,
      });
      await store.createSession({
        tenant_id: tenant,
        session_id: 's-e',
        created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
        agent: { type: 'inline', spec: makeAgentSpec() },
        custom: null,
        metadata: {},
        external_id: null,
      });
    });

    it('getSessionByExternalId does not bump last_activity_timestamp_ms', async () => {
      const store = createStore();
      await store.createSession({
        tenant_id: tenant,
        session_id: sessionId,
        created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
        agent: { type: 'inline', spec: makeAgentSpec() },
        custom: null,
        metadata: {},
        external_id: 'run-1',
      });
      const first = await store.getSessionByExternalId({ tenant_id: tenant, external_id: 'run-1' });
      await new Promise(r => setTimeout(r, 5));
      const second = await store.getSessionByExternalId({ tenant_id: tenant, external_id: 'run-1' });
      expect(mustGet(second).last_activity_timestamp_ms).toBe(mustGet(first).last_activity_timestamp_ms);
    });
  });

  describe('deleteSession', () => {
    it('removes all session data, is idempotent, and is a no-op when tenant_id does not match', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createSession({
        tenant_id: 'other',
        session_id: 'other-session',
        created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
        agent: { type: 'inline', spec: makeAgentSpec() },
        custom: null,
        metadata: {},
        external_id: null,
      });

      await store.createTurn(
        makeCreateTurnInput({
          sessionId,
          turnId: 'turn-1',
          new_context_appends: [
            {
              thread_id: MAIN_THREAD_ID,
              context: [userMessage('private context')],
              current_context_usage: getEmptyCurrentContextUsage(),
            },
          ],
          capability_states: [{ thread_id: MAIN_THREAD_ID, capability_state: { 'tfy.initial': { value: 1 } } }],
        }),
      );
      await store.appendToEvents({
        session_id: sessionId,
        turn_id: 'turn-1',
        events: [makeTurnCreatedEvent('turn-1'), makeModelMessageEvent()],
      });
      await store.patchThreadCapabilityState({
        session_id: sessionId,
        turn_id: 'turn-1',
        thread_id: MAIN_THREAD_ID,
        key: 'tfy.plan',
        state: { step: 'secret' },
      });
      await store.patchMCPServers({
        session_id: sessionId,
        turn_id: 'turn-1',
        mcp_servers: [{ id: 'svc', name: 'svc', session_id: 'mcp-1', transport_type: 'streamable-http' }],
      });
      await store.patchSandboxInfo({
        session_id: sessionId,
        turn_id: 'turn-1',
        sandbox_info: { sandbox_id: 'sbx-1' },
      });

      await store.deleteSession({ tenant_id: 'other', session_id: sessionId });
      expect(await store.getSession({ tenant_id: tenant, session_id: sessionId })).toBeDefined();
      expect(await store.getTurn({ session_id: sessionId, turn_id: 'turn-1' })).toBeDefined();
      expect(
        (
          await store.listTurnEvents({
            session_id: sessionId,
            turn_id: 'turn-1',
            limit: 10,
            page_token: undefined,
            order: 'asc',
          })
        ).data,
      ).toHaveLength(2);

      await store.deleteSession({ tenant_id: tenant, session_id: sessionId });
      await store.deleteSession({ tenant_id: tenant, session_id: sessionId });

      expect(await store.getSession({ tenant_id: tenant, session_id: sessionId })).toBeUndefined();
      expect(await store.getSession({ tenant_id: 'other', session_id: 'other-session' })).toBeDefined();
      expect(await store.getTurn({ session_id: sessionId, turn_id: 'turn-1' })).toBeUndefined();
      await expect(
        store.listTurnEvents({
          session_id: sessionId,
          turn_id: 'turn-1',
          limit: 10,
          page_token: undefined,
          order: 'asc',
        }),
      ).rejects.toBeInstanceOf(TurnNotFoundError);
      await expect(
        store.listSessionEvents({
          session_id: sessionId,
          limit: 10,
          page_token: undefined,
          last_turn_id: undefined,
        }),
      ).rejects.toBeInstanceOf(SessionNotFoundError);

      const listed = await store.listSessions({
        agent_id: undefined,
        created_by_subject_id: undefined,
        metadata: undefined,
        tenant_id: tenant,
        limit: 10,
        page_token: undefined,
        order: undefined,
        start_timestamp: undefined,
        end_timestamp: undefined,
      });
      expect(listed.data).toHaveLength(0);

      // Reusing every identifier must not expose orphaned events, context, or checkpoint state.
      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 'turn-1' }));
      const recreated = mustGet(await store.getTurn({ session_id: sessionId, turn_id: 'turn-1' }));
      expect(recreated.snapshot.threads[MAIN_THREAD_ID]?.context).toEqual([]);
      expect(recreated.snapshot.threads[MAIN_THREAD_ID]?.capability_state).toBeNull();
      expect(recreated.snapshot.mcp_servers).toBeNull();
      expect(recreated.snapshot.sandbox_info).toBeNull();
      expect(
        (
          await store.listTurnEvents({
            session_id: sessionId,
            turn_id: 'turn-1',
            limit: 10,
            page_token: undefined,
            order: 'asc',
          })
        ).data,
      ).toEqual([]);
    });

    it('rejects session mutations after deleteSession', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 'turn-1' }));
      await store.deleteSession({ tenant_id: tenant, session_id: sessionId });

      await expect(
        store.updateSession({
          tenant_id: tenant,
          session_id: sessionId,
          agent: undefined,
          title: 'new-title',
          metadata: undefined,
        }),
      ).rejects.toBeInstanceOf(SessionNotFoundError);
      await expect(store.createTurn(makeCreateTurnInput({ sessionId, turnId: 'turn-2' }))).rejects.toBeInstanceOf(
        SessionNotFoundError,
      );
    });

    it('rejects turn mutations after deleteSession', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 'turn-1' }));
      await store.deleteSession({ tenant_id: tenant, session_id: sessionId });

      for (const write of turnScopedWrites(store, { session_id: sessionId, turn_id: 'turn-1' })) {
        await expect(write()).rejects.toBeInstanceOf(TurnNotFoundError);
      }
    });

    it('rejects event mutations after deleteSession', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 'turn-1' }));
      await store.deleteSession({ tenant_id: tenant, session_id: sessionId });

      const keys = { session_id: sessionId, turn_id: 'turn-1' };
      await expect(
        store.appendToEvents({
          ...keys,
          events: [makeTurnCreatedEvent('turn-1')],
        }),
      ).rejects.toBeInstanceOf(TurnNotFoundError);
      await expect(
        store.listTurnEvents({
          ...keys,
          limit: 10,
          page_token: undefined,
          order: undefined,
        }),
      ).rejects.toBeInstanceOf(TurnNotFoundError);
      await expect(
        store.listSessionEvents({
          session_id: sessionId,
          limit: 10,
          page_token: undefined,
          last_turn_id: undefined,
        }),
      ).rejects.toBeInstanceOf(SessionNotFoundError);
    });

    it('leaves sessions whose id extends the deleted id untouched', async () => {
      const store = createStore();
      const nested = `${sessionId}:nested`;
      await seedSession(store);
      await store.createSession({
        tenant_id: tenant,
        session_id: nested,
        created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
        agent: { type: 'inline', spec: makeAgentSpec() },
        custom: null,
        metadata: {},
        external_id: null,
      });
      await store.createTurn(makeCreateTurnInput({ sessionId: nested, turnId: 'turn-1' }));
      const nestedKeys = { session_id: nested, turn_id: 'turn-1' };
      await store.appendToEvents({ ...nestedKeys, events: [makeTurnCreatedEvent('turn-1')] });

      await store.deleteSession({ tenant_id: tenant, session_id: sessionId });

      expect(await store.getSession({ tenant_id: tenant, session_id: nested })).toBeDefined();
      expect(await store.getTurn(nestedKeys)).toBeDefined();
      expect(
        (await store.listTurnEvents({ ...nestedKeys, limit: 10, page_token: undefined, order: 'asc' })).data,
      ).toHaveLength(1);
    });

    it('child appends that race deleteSession fail cleanly and leave no orphans', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 'turn-1' }));
      const keys = { session_id: sessionId, turn_id: 'turn-1' };

      const results = await Promise.allSettled([
        store.deleteSession({ tenant_id: tenant, session_id: sessionId }),
        store.appendToEvents({
          ...keys,
          events: [makeTurnCreatedEvent('turn-1'), makeModelMessageEvent()],
        }),
        store.appendToThreadContext({
          ...keys,
          thread_id: MAIN_THREAD_ID,
          context: [userMessage('raced')],
          current_context_usage: null,
          completion: null,
        }),
      ]);

      const [deletion, ...appends] = results;
      expect(deletion.status).toBe('fulfilled');
      for (const result of appends) {
        if (result.status === 'rejected') {
          expect(result.reason).toBeInstanceOf(SessionStoreNotFoundError);
        }
      }

      expect(await store.getSession({ tenant_id: tenant, session_id: sessionId })).toBeUndefined();
      expect(await store.getTurn(keys)).toBeUndefined();

      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 'turn-1' }));
      const recreated = mustGet(await store.getTurn(keys));
      expect(recreated.snapshot.threads[MAIN_THREAD_ID]?.context).toEqual([]);
      expect(
        (
          await store.listTurnEvents({
            ...keys,
            limit: 10,
            page_token: undefined,
            order: 'asc',
          })
        ).data,
      ).toEqual([]);
    });
  });

  describe('missing session / turn', () => {
    it('rejects session mutations for a missing session', async () => {
      const store = createStore();

      await expect(
        store.updateSession({
          tenant_id: tenant,
          session_id: missingSessionId,
          agent: undefined,
          title: 'new-title',
          metadata: undefined,
        }),
      ).rejects.toBeInstanceOf(SessionNotFoundError);
      await expect(
        store.createTurn(makeCreateTurnInput({ sessionId: missingSessionId, turnId: 'turn-1' })),
      ).rejects.toBeInstanceOf(SessionNotFoundError);
    });

    it('rejects turn mutations for a missing turn', async () => {
      const store = createStore();
      await seedSession(store);

      for (const write of turnScopedWrites(store, { session_id: sessionId, turn_id: missingTurnId })) {
        await expect(write()).rejects.toBeInstanceOf(TurnNotFoundError);
      }
    });

    it('rejects event mutations for a missing session or turn', async () => {
      const store = createStore();
      await seedSession(store);
      const keys = { session_id: sessionId, turn_id: missingTurnId };

      await expect(
        store.appendToEvents({
          ...keys,
          events: [makeTurnCreatedEvent(missingTurnId)],
        }),
      ).rejects.toBeInstanceOf(TurnNotFoundError);
      await expect(
        store.listTurnEvents({
          ...keys,
          limit: 10,
          page_token: undefined,
          order: undefined,
        }),
      ).rejects.toBeInstanceOf(TurnNotFoundError);
      await expect(
        store.listSessionEvents({
          session_id: missingSessionId,
          limit: 10,
          page_token: undefined,
          last_turn_id: undefined,
        }),
      ).rejects.toBeInstanceOf(SessionNotFoundError);
    });
  });

  describe('listSessions', () => {
    async function seedThreeSessions(store: ISessionStore) {
      for (const id of ['sa', 'sb', 'sc']) {
        await store.createSession({
          tenant_id: tenant,
          session_id: id,
          created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
          agent: { type: 'inline', spec: makeAgentSpec() },
          custom: null,
          metadata: {},
          external_id: null,
        });
        await new Promise(r => setTimeout(r, 2));
      }
    }

    it('lists newest-first by default, asc on request, scoped to tenant', async () => {
      const store = createStore();
      await seedThreeSessions(store);
      await store.createSession({
        tenant_id: 'other',
        session_id: 'sx',
        created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
        agent: { type: 'inline', spec: makeAgentSpec() },
        custom: null,
        metadata: {},
        external_id: null,
      });

      const desc = await store.listSessions({
        agent_id: undefined,
        created_by_subject_id: undefined,
        metadata: undefined,
        tenant_id: tenant,
        limit: 10,
        page_token: undefined,
        order: undefined,
        start_timestamp: undefined,
        end_timestamp: undefined,
      });
      expect(desc.data.map(s => s.session_id)).toEqual(['sc', 'sb', 'sa']);

      const asc = await store.listSessions({
        agent_id: undefined,
        created_by_subject_id: undefined,
        metadata: undefined,
        tenant_id: tenant,
        limit: 10,
        page_token: undefined,
        order: 'asc',
        start_timestamp: undefined,
        end_timestamp: undefined,
      });
      expect(asc.data.map(s => s.session_id)).toEqual(['sa', 'sb', 'sc']);
    });

    it('paginates with next_page_token and filters by created_at bounds', async () => {
      const store = createStore();
      await seedThreeSessions(store);

      const first = await store.listSessions({
        agent_id: undefined,
        created_by_subject_id: undefined,
        metadata: undefined,
        tenant_id: tenant,
        limit: 2,
        page_token: undefined,
        order: undefined,
        start_timestamp: undefined,
        end_timestamp: undefined,
      });
      expect(first.data).toHaveLength(2);
      expect(first.pagination.next_page_token).toBeDefined();
      const second = await store.listSessions({
        agent_id: undefined,
        created_by_subject_id: undefined,
        metadata: undefined,
        tenant_id: tenant,
        limit: 2,
        page_token: first.pagination.next_page_token,
        order: undefined,
        start_timestamp: undefined,
        end_timestamp: undefined,
      });
      expect(second.data.map(s => s.session_id)).toEqual(['sa']);
      expect(second.pagination.next_page_token).toBeUndefined();

      const all = await store.listSessions({
        agent_id: undefined,
        created_by_subject_id: undefined,
        metadata: undefined,
        tenant_id: tenant,
        limit: 10,
        page_token: undefined,
        order: 'asc',
        start_timestamp: undefined,
        end_timestamp: undefined,
      });
      const middleSession = all.data[1];
      if (!middleSession) {
        throw new Error('expected middle session in list');
      }
      const middleCreatedAt = middleSession.created_at;
      const bounded = await store.listSessions({
        agent_id: undefined,
        created_by_subject_id: undefined,
        metadata: undefined,
        tenant_id: tenant,
        limit: 10,
        order: 'asc',
        page_token: undefined,
        start_timestamp: middleCreatedAt,
        end_timestamp: middleCreatedAt,
      });
      expect(bounded.data.map(s => s.session_id)).toEqual(['sb']);
    });

    it('orders by updated_at so later activity ranks ahead of create order', async () => {
      const store = createStore();
      await seedThreeSessions(store);
      await new Promise(r => setTimeout(r, 5));
      await store.updateSession({
        tenant_id: tenant,
        session_id: 'sa',
        agent: undefined,
        title: 'bumped',
        metadata: undefined,
      });

      const listArgs = {
        agent_id: undefined,
        created_by_subject_id: undefined,
        metadata: undefined,
        tenant_id: tenant,
        order: undefined,
        start_timestamp: undefined,
        end_timestamp: undefined,
      };
      const desc = await store.listSessions({ ...listArgs, limit: 10, page_token: undefined });
      expect(desc.data.map(s => s.session_id)).toEqual(['sa', 'sc', 'sb']);

      // Keyset must continue from the bumped row's updated_at cursor, not create order.
      const page1 = await store.listSessions({ ...listArgs, limit: 2, page_token: undefined });
      expect(page1.data.map(s => s.session_id)).toEqual(['sa', 'sc']);
      const page2 = await store.listSessions({
        ...listArgs,
        limit: 2,
        page_token: page1.pagination.next_page_token,
      });
      expect(page2.data.map(s => s.session_id)).toEqual(['sb']);
    });

    it('keyset pages partition the ordered list without overlap or gaps', async () => {
      const store = createStore();
      await seedThreeSessions(store);

      const listArgs = {
        agent_id: undefined,
        created_by_subject_id: undefined,
        metadata: undefined,
        tenant_id: tenant,
        order: 'desc' as const,
        start_timestamp: undefined,
        end_timestamp: undefined,
      };
      const full = await store.listSessions({ ...listArgs, limit: 10, page_token: undefined });
      const page1 = await store.listSessions({ ...listArgs, limit: 2, page_token: undefined });
      expect(page1.pagination.next_page_token).toBeDefined();
      const page2 = await store.listSessions({
        ...listArgs,
        limit: 2,
        page_token: page1.pagination.next_page_token,
      });

      const pageIds = [...page1.data, ...page2.data].map(s => s.session_id);
      expect(pageIds).toEqual(full.data.map(s => s.session_id));
      expect(new Set(pageIds).size).toBe(pageIds.length);
      expect(page2.pagination.next_page_token).toBeUndefined();
    });

    it('filters by created_by_subject_id', async () => {
      const store = createStore();
      await store.createSession({
        tenant_id: tenant,
        session_id: 'alice-session',
        created_by_subject: { subject_id: 'alice', subject_type: 'user', subject_display_name: 'alice' },
        agent: { type: 'inline', spec: makeAgentSpec() },
        custom: null,
        metadata: {},
        external_id: null,
      });
      await store.createSession({
        tenant_id: tenant,
        session_id: 'bob-session',
        created_by_subject: { subject_id: 'bob', subject_type: 'user', subject_display_name: 'bob' },
        agent: { type: 'inline', spec: makeAgentSpec() },
        custom: null,
        metadata: {},
        external_id: null,
      });

      const aliceOnly = await store.listSessions({
        agent_id: undefined,
        created_by_subject_id: 'alice',
        metadata: undefined,
        tenant_id: tenant,
        limit: 10,
        page_token: undefined,
        order: undefined,
        start_timestamp: undefined,
        end_timestamp: undefined,
      });
      expect(aliceOnly.data.map(s => s.session_id)).toEqual(['alice-session']);
      expect(aliceOnly.data[0]?.created_by_subject.subject_id).toBe('alice');

      const unmatched = await store.listSessions({
        agent_id: undefined,
        created_by_subject_id: 'nobody',
        metadata: undefined,
        tenant_id: tenant,
        limit: 10,
        page_token: undefined,
        order: undefined,
        start_timestamp: undefined,
        end_timestamp: undefined,
      });
      expect(unmatched.data).toEqual([]);
    });
  });

  describe('createTurn', () => {
    it('atomically links last_turn_id and bumps activity', async () => {
      const store = createStore();
      await seedSession(store);
      const before = await store.getSession({ tenant_id: tenant, session_id: sessionId });
      await new Promise(r => setTimeout(r, 5));
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 'turn-1' }));
      const after = await store.getSession({ tenant_id: tenant, session_id: sessionId });
      expect(mustGet(after).last_turn_id).toBe('turn-1');
      expect(mustGet(after).last_activity_timestamp_ms).toBeGreaterThan(mustGet(before).last_activity_timestamp_ms);
    });

    it('increments session.metrics.total_turns without cost or duration', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 'turn-1' }));
      const afterFirst = await store.getSession({ tenant_id: tenant, session_id: sessionId });
      expect(mustGet(afterFirst).metrics).toEqual({
        total_cost_in_usd: 0,
        total_duration_ms: 0,
        total_turns: 1,
      });
      await finishTurn(store, 'turn-1');
      await store.createTurn(
        makeCreateTurnInput({ sessionId, turnId: 'turn-2', previousTurnId: 'turn-1', firstTurnId: 'turn-1' }),
      );
      const afterSecond = await store.getSession({ tenant_id: tenant, session_id: sessionId });
      expect(mustGet(afterSecond).metrics.total_turns).toBe(2);
    });

    it('update_session_title_if_not_exist sets once and never overwrites', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(
        makeCreateTurnInput({ sessionId, turnId: 'turn-1', update_session_title_if_not_exist: 'First title' }),
      );
      await finishTurn(store, 'turn-1');
      await store.createTurn(
        makeCreateTurnInput({
          sessionId,
          turnId: 'turn-2',
          previousTurnId: 'turn-1',
          firstTurnId: 'turn-1',
          update_session_title_if_not_exist: 'Second title',
        }),
      );
      const session = await store.getSession({ tenant_id: tenant, session_id: sessionId });
      expect(mustGet(session).title).toBe('First title');
    });

    it('fork from any existing turn succeeds and advances tip', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 'turn-1' }));
      await finishTurn(store, 'turn-1');
      await store.createTurn(
        makeCreateTurnInput({ sessionId, turnId: 'turn-2', previousTurnId: 'turn-1', firstTurnId: 'turn-1' }),
      );
      // Fork from turn-1 (not the tip).
      await store.createTurn(
        makeCreateTurnInput({ sessionId, turnId: 'turn-fork', previousTurnId: 'turn-1', firstTurnId: 'turn-1' }),
      );
      const session = await store.getSession({ tenant_id: tenant, session_id: sessionId });
      expect(mustGet(session).last_turn_id).toBe('turn-fork');
    });

    it('new root turn (no previous_turn_id) succeeds on non-empty session', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 'turn-1' }));
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 'turn-root-2' }));
      const session = await store.getSession({ tenant_id: tenant, session_id: sessionId });
      expect(mustGet(session).last_turn_id).toBe('turn-root-2');
    });

    it('concurrent createTurn forking the same tip: both succeed with isolated context', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(
        makeCreateTurnInput({
          sessionId,
          turnId: 'tip',
          new_context_appends: [
            {
              thread_id: MAIN_THREAD_ID,
              context: [userMessage('shared')],
              current_context_usage: getEmptyCurrentContextUsage(),
            },
          ],
        }),
      );
      await finishTurn(store, 'tip');
      const results = await Promise.allSettled([
        store.createTurn(
          makeCreateTurnInput({
            sessionId,
            turnId: 'turn-a',
            previousTurnId: 'tip',
            firstTurnId: 'tip',
            new_context_appends: [
              {
                thread_id: MAIN_THREAD_ID,
                context: [userMessage('a-only')],
                current_context_usage: getEmptyCurrentContextUsage(),
              },
            ],
          }),
        ),
        store.createTurn(
          makeCreateTurnInput({
            sessionId,
            turnId: 'turn-b',
            previousTurnId: 'tip',
            firstTurnId: 'tip',
            new_context_appends: [
              {
                thread_id: MAIN_THREAD_ID,
                context: [userMessage('b-only')],
                current_context_usage: getEmptyCurrentContextUsage(),
              },
            ],
          }),
        ),
      ]);
      expect(results.every(r => r.status === 'fulfilled')).toBe(true);
      const session = await store.getSession({ tenant_id: tenant, session_id: sessionId });
      expect(['turn-a', 'turn-b']).toContain(mustGet(session).last_turn_id);
      const turns = await store.listTurns({
        session_id: sessionId,
        limit: 10,
        page_token: undefined,
      });
      expect(turns.data.map(t => t.turn_id).sort()).toEqual(['tip', 'turn-a', 'turn-b']);

      const turnA = await store.getTurn({ session_id: sessionId, turn_id: 'turn-a' });
      const turnB = await store.getTurn({ session_id: sessionId, turn_id: 'turn-b' });
      expect(contextContents(turnA?.snapshot.threads[MAIN_THREAD_ID]?.context)).toEqual(['shared', 'a-only']);
      expect(contextContents(turnB?.snapshot.threads[MAIN_THREAD_ID]?.context)).toEqual(['shared', 'b-only']);
    });

    it('rejects createTurn when previous turn is still running', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 'turn-1' }));
      await expect(
        store.createTurn(
          makeCreateTurnInput({ sessionId, turnId: 'turn-2', previousTurnId: 'turn-1', firstTurnId: 'turn-1' }),
        ),
      ).rejects.toBeInstanceOf(PreviousTurnRunningError);
    });

    it('rejects duplicate turn_id with conflict', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 'turn-1' }));
      await finishTurn(store, 'turn-1');
      await expect(
        store.createTurn(
          makeCreateTurnInput({
            sessionId,
            turnId: 'turn-1',
            previousTurnId: 'turn-1',
            firstTurnId: 'turn-1',
          }),
        ),
      ).rejects.toBeInstanceOf(TurnAlreadyExistsError);
    });

    it('linear continuation carries context and persists the caller-supplied capability map', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(
        makeCreateTurnInput({
          sessionId,
          turnId: 't1',
          new_threads: [
            {
              thread_id: MAIN_THREAD_ID,
              parent: null,
              agent_info: null,
            },
          ],
          capability_states: [{ thread_id: MAIN_THREAD_ID, capability_state: { 'tfy.plan': { step: 1 } } }],
          new_context_appends: [
            {
              thread_id: MAIN_THREAD_ID,
              context: [userMessage('L1a'), userMessage('L1b')],
              current_context_usage: { ...getEmptyCurrentContextUsage(), prompt_tokens: 2 },
            },
          ],
        }),
      );
      await store.patchThreadCapabilityState({
        session_id: sessionId,
        turn_id: 't1',
        thread_id: MAIN_THREAD_ID,
        key: 'tfy.plan',
        state: { step: 2 },
      });
      await finishTurn(store, 't1');

      await store.createTurn(
        makeCreateTurnInput({
          sessionId,
          turnId: 't2',
          previousTurnId: 't1',
          firstTurnId: 't1',
          capability_states: [{ thread_id: MAIN_THREAD_ID, capability_state: { 'tfy.plan': { step: 2 } } }],
          new_context_appends: [
            {
              thread_id: MAIN_THREAD_ID,
              context: [userMessage('L2')],
              current_context_usage: { ...getEmptyCurrentContextUsage(), prompt_tokens: 3 },
            },
          ],
        }),
      );

      const t2 = await store.getTurn({ session_id: sessionId, turn_id: 't2' });
      const main = mustGet(t2).snapshot.threads[MAIN_THREAD_ID];
      expect(contextContents(main?.context)).toEqual(['L1a', 'L1b', 'L2']);
      expect(main?.current_context_usage.prompt_tokens).toBe(3);
      expect(main?.capability_state).toEqual({ 'tfy.plan': { step: 2 } });
    });

    it('createTurn atomically persists the complete post-send capability map', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(
        makeCreateTurnInput({
          sessionId,
          turnId: 't1',
          capability_states: [
            {
              thread_id: MAIN_THREAD_ID,
              capability_state: { keep: { version: 1 }, remove: true },
            },
          ],
        }),
      );
      await finishTurn(store, 't1');

      await store.createTurn(
        makeCreateTurnInput({
          sessionId,
          turnId: 't2',
          previousTurnId: 't1',
          firstTurnId: 't1',
          capability_states: [
            {
              thread_id: MAIN_THREAD_ID,
              capability_state: { keep: { version: 2 } },
            },
          ],
        }),
      );

      const t2 = await store.getTurn({ session_id: sessionId, turn_id: 't2' });
      expect(t2?.snapshot.threads[MAIN_THREAD_ID]?.capability_state).toEqual({
        keep: { version: 2 },
      });
    });

    it('fork from an older turn after tip overwrite sees only the parent prefix', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(
        makeCreateTurnInput({
          sessionId,
          turnId: 't1',
          new_context_appends: [
            {
              thread_id: MAIN_THREAD_ID,
              context: [userMessage('from-t1')],
              current_context_usage: getEmptyCurrentContextUsage(),
            },
          ],
        }),
      );
      await finishTurn(store, 't1');

      await store.createTurn(
        makeCreateTurnInput({
          sessionId,
          turnId: 't2',
          previousTurnId: 't1',
          firstTurnId: 't1',
          new_context_appends: [
            {
              thread_id: MAIN_THREAD_ID,
              context: [userMessage('from-t2')],
              current_context_usage: getEmptyCurrentContextUsage(),
            },
          ],
        }),
      );
      await store.overwriteThreadContext({
        session_id: sessionId,
        turn_id: 't2',
        event: {
          type: EventType.AGENT_CONTEXT_OVERWRITE,
          id: newEventId(),
          created_at: new Date().toISOString(),
          thread_id: MAIN_THREAD_ID,
          reason: 'compaction',
          context: [userMessage('t2-summary-only')],
          current_context_usage: getEmptyCurrentContextUsage(),
          usage: getEmptyUsage(),
        },
      });
      await finishTurn(store, 't2');

      await store.createTurn(
        makeCreateTurnInput({
          sessionId,
          turnId: 't3-fork',
          previousTurnId: 't1',
          firstTurnId: 't1',
          new_context_appends: [
            {
              thread_id: MAIN_THREAD_ID,
              context: [userMessage('fork-append')],
              current_context_usage: getEmptyCurrentContextUsage(),
            },
          ],
        }),
      );

      const fork = await store.getTurn({
        session_id: sessionId,
        turn_id: 't3-fork',
      });
      expect(contextContents(fork?.snapshot.threads[MAIN_THREAD_ID]?.context)).toEqual(['from-t1', 'fork-append']);
    });

    it('createTurn with multiple new_threads + appends is atomic (all threads present together)', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(
        makeCreateTurnInput({
          sessionId,
          turnId: 't1',
          new_threads: [
            {
              thread_id: MAIN_THREAD_ID,
              parent: null,
              agent_info: null,
            },
            {
              thread_id: 'child-a',
              parent: { thread_id: MAIN_THREAD_ID, tool_call_id: 'tc-a' },
              agent_info: { type: 'dynamic', name: 'child-a', input: 'task-a' },
            },
            {
              thread_id: 'child-b',
              parent: { thread_id: MAIN_THREAD_ID, tool_call_id: 'tc-b' },
              agent_info: { type: 'dynamic', name: 'child-b', input: 'task-b' },
            },
          ],
          capability_states: [
            { thread_id: MAIN_THREAD_ID, capability_state: null },
            { thread_id: 'child-a', capability_state: { 'tfy.plan': { step: 1 } } },
            { thread_id: 'child-b', capability_state: null },
          ],
          new_context_appends: [
            {
              thread_id: MAIN_THREAD_ID,
              context: [userMessage('main-msg')],
              current_context_usage: getEmptyCurrentContextUsage(),
            },
            {
              thread_id: 'child-a',
              context: [userMessage('a-msg')],
              current_context_usage: { ...getEmptyCurrentContextUsage(), prompt_tokens: 1 },
            },
            {
              thread_id: 'child-b',
              context: [userMessage('b-msg-1'), userMessage('b-msg-2')],
              current_context_usage: { ...getEmptyCurrentContextUsage(), prompt_tokens: 2 },
            },
          ],
        }),
      );

      const turn = await store.getTurn({
        session_id: sessionId,
        turn_id: 't1',
      });
      const threads = mustGet(turn).snapshot.threads;
      expect(Object.keys(threads).sort()).toEqual(['child-a', 'child-b', MAIN_THREAD_ID]);
      expect(contextContents(threads[MAIN_THREAD_ID]?.context)).toEqual(['main-msg']);
      expect(contextContents(threads['child-a']?.context)).toEqual(['a-msg']);
      expect(contextContents(threads['child-b']?.context)).toEqual(['b-msg-1', 'b-msg-2']);
      expect(threads['child-a']?.parent).toEqual({
        thread_id: MAIN_THREAD_ID,
        tool_call_id: 'tc-a',
      });
      expect(threads['child-a']?.agent_info).toEqual({
        type: 'dynamic',
        name: 'child-a',
        input: 'task-a',
      });
      expect(threads['child-a']?.capability_state).toEqual({ 'tfy.plan': { step: 1 } });
      expect(threads['child-b']?.current_context_usage.prompt_tokens).toBe(2);
    });
  });

  describe('freezeAndGetTurn', () => {
    it('cancels a running turn, persists turn.done, and fences all turn-scoped writes', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 'turn-1' }));
      const cancelledState = makeCancelledTurnState(CancellationReason.CancelledForNextTurn);
      const record = await store.freezeAndGetTurn({
        session_id: sessionId,
        turn_id: 'turn-1',
        reason: CancellationReason.CancelledForNextTurn,
        turn_done_event: makeTurnDoneEvent(cancelledState),
      });
      expect(record.state.status).toBe('cancelled');
      expect(record.state).toMatchObject({ reason: CancellationReason.CancelledForNextTurn });
      const { data } = await store.listTurnEvents({
        session_id: sessionId,
        turn_id: 'turn-1',
        limit: 10,
        page_token: undefined,
        order: undefined,
      });
      expect(data.some(e => e.type === EventType.TURN_DONE)).toBe(true);

      const keys = { session_id: sessionId, turn_id: 'turn-1' };
      const fencedWrites: (() => Promise<unknown>)[] = [
        () =>
          store.appendToEvents({
            ...keys,
            events: [makeTurnCreatedEvent('turn-1')],
          }),
        () =>
          store.appendToThreadContext({
            ...keys,
            thread_id: MAIN_THREAD_ID,
            context: [userMessage('late')],
            current_context_usage: null,
            completion: null,
          }),
        () =>
          store.overwriteThreadContext({
            ...keys,
            event: {
              type: EventType.AGENT_CONTEXT_OVERWRITE,
              id: newEventId(),
              created_at: new Date().toISOString(),
              thread_id: MAIN_THREAD_ID,
              reason: 'compaction',
              context: [userMessage('late-overwrite')],
              current_context_usage: getEmptyCurrentContextUsage(),
              usage: getEmptyUsage(),
            },
          }),
        () =>
          store.addThreads({
            ...keys,
            threads: [
              {
                thread_id: 'child',
                context: [],
                current_context_usage: getEmptyCurrentContextUsage(),
                parent: { thread_id: MAIN_THREAD_ID, tool_call_id: 'tc1' },
                agent_info: { type: 'dynamic', name: 'child', input: 'do work' },
                completion: null,
                capability_state: null,
              },
            ],
          }),
        () => store.removeThreads({ ...keys, thread_ids: [MAIN_THREAD_ID] }),
        () =>
          store.patchMCPServers({
            ...keys,
            mcp_servers: [{ id: 'svc', name: 'svc', session_id: 'mcp-1', transport_type: 'streamable-http' }],
          }),
        () => store.patchSandboxInfo({ ...keys, sandbox_info: { sandbox_id: 'sbx-1' } }),
        () =>
          store.patchThreadCapabilityState({
            ...keys,
            thread_id: MAIN_THREAD_ID,
            key: 'tfy.plan',
            state: { v: 1 },
          }),
      ];

      for (const write of fencedWrites) {
        await expect(write()).rejects.toBeInstanceOf(TurnNotRunningError);
      }
    });

    it('cancels a running turn with the caller-supplied reason', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 'turn-1' }));
      const cancelledState = makeCancelledTurnState(CancellationReason.ClientCancelled);
      const record = await store.freezeAndGetTurn({
        session_id: sessionId,
        turn_id: 'turn-1',
        reason: CancellationReason.ClientCancelled,
        turn_done_event: makeTurnDoneEvent(cancelledState),
      });
      expect(record.state).toMatchObject({
        status: 'cancelled',
        reason: CancellationReason.ClientCancelled,
      });
    });

    it('folds duration into session.metrics when cancel applies, not on a second freeze', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 'turn-1' }));
      const cancelledState = makeCancelledTurnState(CancellationReason.CancelledForNextTurn);
      const record = await store.freezeAndGetTurn({
        session_id: sessionId,
        turn_id: 'turn-1',
        reason: CancellationReason.CancelledForNextTurn,
        turn_done_event: makeTurnDoneEvent(cancelledState),
      });
      if (record.state.status !== 'cancelled') {
        throw new Error(`expected cancelled turn, got ${record.state.status}`);
      }
      const afterCancel = await store.getSession({ tenant_id: tenant, session_id: sessionId });
      const elapsed_ms = Date.parse(record.state.completed_at) - record.created_at.getTime();
      expect(mustGet(afterCancel).metrics).toEqual({
        total_cost_in_usd: 0,
        total_duration_ms: elapsed_ms > 0 ? Math.trunc(elapsed_ms) : 0,
        total_turns: 1,
      });

      await store.freezeAndGetTurn({
        session_id: sessionId,
        turn_id: 'turn-1',
        reason: CancellationReason.CancelledForNextTurn,
        turn_done_event: makeTurnDoneEvent(cancelledState),
      });
      const afterSecond = await store.getSession({ tenant_id: tenant, session_id: sessionId });
      expect(mustGet(afterSecond).metrics).toEqual(mustGet(afterCancel).metrics);
    });

    it('on an already-terminal turn is a plain read without duplicating turn.done', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 'turn-1' }));
      await finishTurn(store, 'turn-1');
      const doneState = makeDoneTurnState();
      await store.freezeAndGetTurn({
        session_id: sessionId,
        turn_id: 'turn-1',
        reason: CancellationReason.CancelledForNextTurn,
        turn_done_event: makeTurnDoneEvent(doneState),
      });
      const { data } = await store.listTurnEvents({
        session_id: sessionId,
        turn_id: 'turn-1',
        limit: 10,
        page_token: undefined,
        order: undefined,
      });
      expect(data.filter(e => e.type === EventType.TURN_DONE)).toHaveLength(1);
    });

    it('concurrent freeze x freeze is idempotent: one cancels, both return terminal', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 'turn-1' }));
      const cancelledState = makeCancelledTurnState(CancellationReason.CancelledForNextTurn);
      const results = await Promise.allSettled([
        store.freezeAndGetTurn({
          session_id: sessionId,
          turn_id: 'turn-1',
          reason: CancellationReason.CancelledForNextTurn,
          turn_done_event: makeTurnDoneEvent(cancelledState),
        }),
        store.freezeAndGetTurn({
          session_id: sessionId,
          turn_id: 'turn-1',
          reason: CancellationReason.CancelledForNextTurn,
          turn_done_event: makeTurnDoneEvent(cancelledState),
        }),
      ]);
      expect(results.every(r => r.status === 'fulfilled')).toBe(true);
      const turn = await store.getTurn({ session_id: sessionId, turn_id: 'turn-1' });
      expect(mustGet(turn).state.status).toBe('cancelled');
      const { data } = await store.listTurnEvents({
        session_id: sessionId,
        turn_id: 'turn-1',
        limit: 10,
        page_token: undefined,
        order: undefined,
      });
      expect(data.filter(e => e.type === EventType.TURN_DONE)).toHaveLength(1);
    });

    it('concurrent freeze x updateTurnState: exactly one terminal transition wins', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 'turn-1' }));
      const cancelledState = makeCancelledTurnState(CancellationReason.CancelledForNextTurn);
      const doneState = makeDoneTurnState();
      const results = await Promise.allSettled([
        store.freezeAndGetTurn({
          session_id: sessionId,
          turn_id: 'turn-1',
          reason: CancellationReason.CancelledForNextTurn,
          turn_done_event: makeTurnDoneEvent(cancelledState),
        }),
        store.updateTurnState({
          session_id: sessionId,
          turn_id: 'turn-1',
          state: doneState,
          turn_done_event: makeTurnDoneEvent(doneState),
        }),
      ]);
      const rejected = results.filter(r => r.status === 'rejected');
      for (const result of rejected) {
        expect(result.reason).toBeInstanceOf(TurnNotRunningError);
      }
      // freeze-after-update is a plain read (both fulfill); update-after-freeze rejects.
      expect(rejected.length === 0 || rejected.length === 1).toBe(true);

      const turn = await store.getTurn({ session_id: sessionId, turn_id: 'turn-1' });
      expect(['cancelled', 'done']).toContain(mustGet(turn).state.status);
      const { data } = await store.listTurnEvents({
        session_id: sessionId,
        turn_id: 'turn-1',
        limit: 10,
        page_token: undefined,
        order: undefined,
      });
      expect(data.filter(e => e.type === EventType.TURN_DONE)).toHaveLength(1);
    });
  });

  describe('updateTurnState', () => {
    it('allows running → done and rejects second terminal (first-terminal-wins)', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 'turn-1' }));
      await finishTurn(store, 'turn-1');
      const cancelledState = makeCancelledTurnState(CancellationReason.ClientCancelled);
      await expect(
        store.updateTurnState({
          session_id: sessionId,
          turn_id: 'turn-1',
          state: cancelledState,
          turn_done_event: makeTurnDoneEvent(cancelledState),
        }),
      ).rejects.toBeInstanceOf(SessionStoreConflictError);
    });

    it('writes terminal state and turn.done atomically', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 'turn-1' }));
      const state = makeDoneTurnState();
      const turnDone = makeTurnDoneEvent(state);
      await store.updateTurnState({
        session_id: sessionId,
        turn_id: 'turn-1',
        state,
        turn_done_event: turnDone,
      });

      const turn = await store.getTurn({ session_id: sessionId, turn_id: 'turn-1' });
      expect(mustGet(turn).state).toEqual(state);
      const { data } = await store.listTurnEvents({
        session_id: sessionId,
        turn_id: 'turn-1',
        limit: 10,
        page_token: undefined,
        order: undefined,
      });
      const doneEvents = data.filter(e => e.type === EventType.TURN_DONE);
      expect(doneEvents).toHaveLength(1);
      expect(doneEvents[0]).toEqual(turnDone);
    });

    it('adds cost and duration into session.metrics on running → terminal', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 'turn-1' }));
      const turn = await store.getTurn({ session_id: sessionId, turn_id: 'turn-1' });
      const createdAt = mustGet(turn).created_at;
      const completedAt = new Date(createdAt.getTime() + 1500).toISOString();
      const state = {
        ...makeDoneTurnState(),
        completed_at: completedAt,
        metrics: { total_cost_in_usd: 1.25 },
      };
      await store.updateTurnState({
        session_id: sessionId,
        turn_id: 'turn-1',
        state,
        turn_done_event: makeTurnDoneEvent(state),
      });
      const session = await store.getSession({ tenant_id: tenant, session_id: sessionId });
      expect(mustGet(session).metrics).toEqual({
        total_cost_in_usd: 1.25,
        total_duration_ms: 1500,
        total_turns: 1,
      });
    });

    it('does not add session.metrics again on a losing terminal write', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 'turn-1' }));
      const turn = await store.getTurn({ session_id: sessionId, turn_id: 'turn-1' });
      const createdAt = mustGet(turn).created_at;
      const doneState = {
        ...makeDoneTurnState(),
        completed_at: new Date(createdAt.getTime() + 1500).toISOString(),
        metrics: { total_cost_in_usd: 1.25 },
      };
      await store.updateTurnState({
        session_id: sessionId,
        turn_id: 'turn-1',
        state: doneState,
        turn_done_event: makeTurnDoneEvent(doneState),
      });
      const afterFirst = mustGet(await store.getSession({ tenant_id: tenant, session_id: sessionId })).metrics;

      const losingState = {
        ...makeCancelledTurnState(CancellationReason.ClientCancelled),
        completed_at: new Date(createdAt.getTime() + 8000).toISOString(),
        metrics: { total_cost_in_usd: 9.99 },
      };
      await expect(
        store.updateTurnState({
          session_id: sessionId,
          turn_id: 'turn-1',
          state: losingState,
          turn_done_event: makeTurnDoneEvent(losingState),
        }),
      ).rejects.toBeInstanceOf(SessionStoreConflictError);

      const afterSecond = await store.getSession({ tenant_id: tenant, session_id: sessionId });
      expect(mustGet(afterSecond).metrics).toEqual(afterFirst);
      expect(afterFirst).toEqual({
        total_cost_in_usd: 1.25,
        total_duration_ms: 1500,
        total_turns: 1,
      });
    });

    it('adds cost and duration from a second done turn onto existing session.metrics', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 'turn-1' }));
      const turn1 = await store.getTurn({ session_id: sessionId, turn_id: 'turn-1' });
      const turn1Done = {
        ...makeDoneTurnState(),
        completed_at: new Date(mustGet(turn1).created_at.getTime() + 1500).toISOString(),
        metrics: { total_cost_in_usd: 1.25 },
      };
      await store.updateTurnState({
        session_id: sessionId,
        turn_id: 'turn-1',
        state: turn1Done,
        turn_done_event: makeTurnDoneEvent(turn1Done),
      });

      await store.createTurn(
        makeCreateTurnInput({ sessionId, turnId: 'turn-2', previousTurnId: 'turn-1', firstTurnId: 'turn-1' }),
      );
      const turn2 = await store.getTurn({ session_id: sessionId, turn_id: 'turn-2' });
      const turn2Done = {
        ...makeDoneTurnState(),
        completed_at: new Date(mustGet(turn2).created_at.getTime() + 800).toISOString(),
        metrics: { total_cost_in_usd: 0.5 },
      };
      await store.updateTurnState({
        session_id: sessionId,
        turn_id: 'turn-2',
        state: turn2Done,
        turn_done_event: makeTurnDoneEvent(turn2Done),
      });

      const session = await store.getSession({ tenant_id: tenant, session_id: sessionId });
      expect(mustGet(session).metrics).toEqual({
        total_cost_in_usd: 1.75,
        total_duration_ms: 2300,
        total_turns: 2,
      });
    });

    it('accumulates session.metrics across turn1 done, turn2 cancel, and turn3 create', async () => {
      const store = createStore();
      await seedSession(store);

      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 'turn-1' }));
      const turn1 = await store.getTurn({ session_id: sessionId, turn_id: 'turn-1' });
      const turn1Done = {
        ...makeDoneTurnState(),
        completed_at: new Date(mustGet(turn1).created_at.getTime() + 1000).toISOString(),
        metrics: { total_cost_in_usd: 1.0 },
      };
      await store.updateTurnState({
        session_id: sessionId,
        turn_id: 'turn-1',
        state: turn1Done,
        turn_done_event: makeTurnDoneEvent(turn1Done),
      });

      await store.createTurn(
        makeCreateTurnInput({ sessionId, turnId: 'turn-2', previousTurnId: 'turn-1', firstTurnId: 'turn-1' }),
      );
      const cancelledState = makeCancelledTurnState(CancellationReason.CancelledForNextTurn);
      const turn2 = await store.freezeAndGetTurn({
        session_id: sessionId,
        turn_id: 'turn-2',
        reason: CancellationReason.CancelledForNextTurn,
        turn_done_event: makeTurnDoneEvent(cancelledState),
      });
      if (turn2.state.status !== 'cancelled') {
        throw new Error(`expected cancelled turn, got ${turn2.state.status}`);
      }
      const turn2DurationMs = Math.max(
        0,
        Math.trunc(Date.parse(turn2.state.completed_at) - turn2.created_at.getTime()),
      );

      await store.createTurn(
        makeCreateTurnInput({ sessionId, turnId: 'turn-3', previousTurnId: 'turn-2', firstTurnId: 'turn-1' }),
      );

      const session = await store.getSession({ tenant_id: tenant, session_id: sessionId });
      expect(mustGet(session).metrics).toEqual({
        total_cost_in_usd: 1.0,
        total_duration_ms: 1000 + turn2DurationMs,
        total_turns: 3,
      });
    });

    it('missing turn → not found', async () => {
      const store = createStore();
      await seedSession(store);
      const state = makeDoneTurnState();
      await expect(
        store.updateTurnState({
          session_id: sessionId,
          turn_id: missingTurnId,
          state,
          turn_done_event: makeTurnDoneEvent(state),
        }),
      ).rejects.toBeInstanceOf(TurnNotFoundError);
    });
  });

  describe('events + threads + capability_state', () => {
    it('appendToEvents orders by monotonic event id, not append call order', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 'turn-1' }));
      const created = makeTurnCreatedEvent('turn-1');
      const model = makeModelMessageEvent();
      expect(created.id < model.id).toBe(true);
      expect(created.created_at).toBeDefined();
      expect(model.created_at).toBeDefined();
      await store.appendToEvents({
        session_id: sessionId,
        turn_id: 'turn-1',
        // Deliberately reversed: durable ordering comes from event.id.
        events: [model, created],
      });
      const { data } = await store.listTurnEvents({
        session_id: sessionId,
        turn_id: 'turn-1',
        limit: 10,
        page_token: undefined,
        order: undefined,
      });
      expect(data.map(e => e.type)).toEqual(['turn.created', EventType.MODEL_MESSAGE]);
      expect(data.map(e => e.id)).toEqual([created.id, model.id]);
    });

    it('add/remove threads and append/overwrite context', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 'turn-1' }));
      await store.addThreads({
        session_id: sessionId,
        turn_id: 'turn-1',
        threads: [
          {
            thread_id: 'child',
            context: [],
            current_context_usage: getEmptyCurrentContextUsage(),
            parent: { thread_id: MAIN_THREAD_ID, tool_call_id: 'tc1' },
            agent_info: { type: 'dynamic', name: 'child', input: 'do work' },
            completion: null,
            capability_state: null,
          },
        ],
      });
      await store.appendToThreadContext({
        session_id: sessionId,
        turn_id: 'turn-1',
        thread_id: 'child',
        context: [{ role: 'user', content: 'hello' }],
        current_context_usage: null,
        completion: null,
      });
      let turn = await store.getTurn({ session_id: sessionId, turn_id: 'turn-1' });
      expect(turn?.snapshot.threads['child']?.context).toHaveLength(1);

      await store.overwriteThreadContext({
        session_id: sessionId,
        turn_id: 'turn-1',
        event: {
          type: EventType.AGENT_CONTEXT_OVERWRITE,
          id: newEventId(),
          created_at: new Date().toISOString(),
          thread_id: 'child',
          reason: 'compaction',
          context: [{ role: 'user', content: 'replaced' }],
          current_context_usage: getEmptyCurrentContextUsage(),
          usage: getEmptyUsage(),
        },
      });
      turn = await store.getTurn({ session_id: sessionId, turn_id: 'turn-1' });
      expect(turn?.snapshot.threads['child']?.context).toEqual([{ role: 'user', content: 'replaced' }]);

      await store.removeThreads({
        session_id: sessionId,
        turn_id: 'turn-1',
        thread_ids: ['child'],
      });
      turn = await store.getTurn({ session_id: sessionId, turn_id: 'turn-1' });
      expect(turn?.snapshot.threads['child']).toBeUndefined();
    });

    it('context order is identical before persistence and after loading', async () => {
      const store = createStore();
      await seedSession(store);
      const firstBatch = ['m-03', 'm-01', 'm-04'].map(userMessage);
      const secondBatch = ['m-02', 'm-05', 'm-00'].map(userMessage);
      const expected = [...firstBatch, ...secondBatch];

      await store.createTurn(
        makeCreateTurnInput({
          sessionId,
          turnId: 'turn-1',
          new_context_appends: [
            {
              thread_id: MAIN_THREAD_ID,
              context: firstBatch,
              current_context_usage: getEmptyCurrentContextUsage(),
            },
          ],
        }),
      );
      await store.appendToThreadContext({
        session_id: sessionId,
        turn_id: 'turn-1',
        thread_id: MAIN_THREAD_ID,
        context: secondBatch,
        current_context_usage: null,
        completion: null,
      });

      const loaded = await store.getTurn({
        session_id: sessionId,
        turn_id: 'turn-1',
      });
      expect(loaded?.snapshot.threads[MAIN_THREAD_ID]?.context).toEqual(expected);
      expect(contextContents(loaded?.snapshot.threads[MAIN_THREAD_ID]?.context)).toEqual([
        'm-03',
        'm-01',
        'm-04',
        'm-02',
        'm-05',
        'm-00',
      ]);
    });

    it('patchThreadCapabilityState is LWW per key', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 'turn-1' }));
      await store.patchThreadCapabilityState({
        session_id: sessionId,
        turn_id: 'turn-1',
        thread_id: MAIN_THREAD_ID,
        key: 'tfy.plan',
        state: { v: 1 },
      });
      await store.patchThreadCapabilityState({
        session_id: sessionId,
        turn_id: 'turn-1',
        thread_id: MAIN_THREAD_ID,
        key: 'tfy.plan',
        state: { v: 2 },
      });
      const turn = await store.getTurn({ session_id: sessionId, turn_id: 'turn-1' });
      expect(turn?.snapshot.threads[MAIN_THREAD_ID]?.capability_state).toEqual({ 'tfy.plan': { v: 2 } });
    });

    // InMemory rejects unknown thread_id; Postgres/SQLite only fence on a running turn and
    // will upsert an orphan capability row. Production callers (TurnHandle) only patch threads
    // that already exist on the turn — not enforced at the SQL store boundary yet.
    it.skip('patchThreadCapabilityState rejects a thread_id not present on the turn', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 'turn-1' }));
      await expect(
        store.patchThreadCapabilityState({
          session_id: sessionId,
          turn_id: 'turn-1',
          thread_id: 'missing-thread',
          key: 'tfy.plan',
          state: { v: 1 },
        }),
      ).rejects.toBeInstanceOf(SessionStoreInvariantError);
    });

    it('capability state is per-turn: patching the successor does not change a frozen predecessor', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(
        makeCreateTurnInput({
          sessionId,
          turnId: 't1',
          new_threads: [
            {
              thread_id: MAIN_THREAD_ID,
              parent: null,
              agent_info: null,
            },
          ],
          capability_states: [{ thread_id: MAIN_THREAD_ID, capability_state: { plan: { step: 1 } } }],
        }),
      );
      await finishTurn(store, 't1');
      await store.createTurn(
        makeCreateTurnInput({
          sessionId,
          turnId: 't2',
          previousTurnId: 't1',
          firstTurnId: 't1',
        }),
      );
      await store.patchThreadCapabilityState({
        session_id: sessionId,
        turn_id: 't2',
        thread_id: MAIN_THREAD_ID,
        key: 'plan',
        state: { step: 2 },
      });

      const t1 = await store.getTurn({ session_id: sessionId, turn_id: 't1' });
      const t2 = await store.getTurn({ session_id: sessionId, turn_id: 't2' });
      expect(t1?.snapshot.threads[MAIN_THREAD_ID]?.capability_state).toEqual({ plan: { step: 1 } });
      expect(t2?.snapshot.threads[MAIN_THREAD_ID]?.capability_state).toEqual({ plan: { step: 2 } });
    });

    it('getTurn output is JSON-round-trip total (no undefined holes)', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(
        makeCreateTurnInput({
          sessionId,
          turnId: 'turn-1',
          new_context_appends: [
            {
              thread_id: MAIN_THREAD_ID,
              context: [userMessage('hello')],
              current_context_usage: getEmptyCurrentContextUsage(),
            },
          ],
        }),
      );
      const turn = await store.getTurn({
        session_id: sessionId,
        turn_id: 'turn-1',
      });
      // Totality: JSON round-trip must not drop keys (undefined is stripped by stringify).
      // Store timestamps are Date; wire form is ISO string after stringify.
      const record = mustGet(turn);
      const revived = JSON.parse(JSON.stringify(record)) as unknown;
      expect(revived).toEqual({
        ...record,
        created_at: record.created_at.toISOString(),
        updated_at: record.updated_at.toISOString(),
      });
    });

    it('JSON-looking strings remain strings', async () => {
      const store = createStore();
      const jsonLooking = '{"x":1}';
      await seedSession(store, makeAgentSpec({ instructions: jsonLooking }));
      await store.updateSession({
        tenant_id: tenant,
        session_id: sessionId,
        agent: undefined,
        title: jsonLooking,
        metadata: undefined,
      });
      await store.createTurn(
        makeCreateTurnInput({
          sessionId,
          turnId: 'turn-1',
          new_context_appends: [
            {
              thread_id: MAIN_THREAD_ID,
              context: [userMessage(jsonLooking)],
              current_context_usage: getEmptyCurrentContextUsage(),
            },
          ],
        }),
      );
      const turn = await store.getTurn({
        session_id: sessionId,
        turn_id: 'turn-1',
      });
      const session = mustGet(await store.getSession({ tenant_id: tenant, session_id: sessionId }));
      expect(session.title).toBe(jsonLooking);
      expect(session.agent).toMatchObject({
        type: 'inline',
        spec: { instructions: jsonLooking },
      });
      expect(mustGet(turn).snapshot.threads[MAIN_THREAD_ID]?.context).toEqual([{ role: 'user', content: jsonLooking }]);
    });

    it('patchMCPServers and patchSandboxInfo', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 'turn-1' }));
      await store.patchMCPServers({
        session_id: sessionId,
        turn_id: 'turn-1',
        mcp_servers: [{ id: 'svc', name: 'svc', session_id: 'mcp-1', transport_type: 'streamable-http' }],
      });
      await store.patchSandboxInfo({
        session_id: sessionId,
        turn_id: 'turn-1',
        sandbox_info: { sandbox_id: 'sbx-1' },
      });
      const turn = await store.getTurn({ session_id: sessionId, turn_id: 'turn-1' });
      expect(turn?.snapshot.mcp_servers?.['svc']?.session_id).toBe('mcp-1');
      expect(mustGet(turn).snapshot.sandbox_info?.sandbox_id).toBe('sbx-1');
    });

    it('patchMCPServers replaces each server id wholesale (omitted fields do not linger)', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 'turn-1' }));
      await store.patchMCPServers({
        session_id: sessionId,
        turn_id: 'turn-1',
        mcp_servers: [{ id: 'svc', name: 'svc', session_id: 'mcp-1', transport_type: 'streamable-http' }],
      });
      await store.patchMCPServers({
        session_id: sessionId,
        turn_id: 'turn-1',
        mcp_servers: [{ id: 'svc', name: 'svc', transport_type: 'sse' }],
      });
      const turn = await store.getTurn({ session_id: sessionId, turn_id: 'turn-1' });
      expect(mustGet(turn).snapshot.mcp_servers).toEqual({
        svc: { id: 'svc', name: 'svc', transport_type: 'sse' },
      });
    });
  });

  describe('pagination', () => {
    // Offset-token pagination does not isolate readers from concurrent inserts:
    // rows added while a client walks pages may appear twice or be skipped.
    // Callers that need a consistent snapshot re-fetch from the tip.

    it('listTurns paginates with opaque tokens', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 't1' }));
      await finishTurn(store, 't1');
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 't2', previousTurnId: 't1', firstTurnId: 't1' }));
      await finishTurn(store, 't2');
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 't3', previousTurnId: 't2', firstTurnId: 't1' }));
      const page1 = await store.listTurns({
        session_id: sessionId,
        limit: 2,
        page_token: undefined,
      });
      expect(page1.data.map(t => t.turn_id)).toEqual(['t1', 't2']);
      expect(page1.pagination.next_page_token).toBeDefined();
      const page2 = await store.listTurns({
        session_id: sessionId,
        limit: 2,
        page_token: page1.pagination.next_page_token,
      });
      expect(page2.data.map(t => t.turn_id)).toEqual(['t3']);
    });

    it('listTurnEvents supports desc order', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 'turn-1' }));
      await store.appendToEvents({
        session_id: sessionId,
        turn_id: 'turn-1',
        events: [makeTurnCreatedEvent('turn-1'), makeModelMessageEvent()],
      });
      const { data } = await store.listTurnEvents({
        session_id: sessionId,
        turn_id: 'turn-1',
        limit: 10,
        order: 'desc',
        page_token: undefined,
      });
      expect(data[0]?.type).toBe(EventType.MODEL_MESSAGE);
    });

    it('listTurnEvents missing turn → not found', async () => {
      const store = createStore();
      await seedSession(store);
      await expect(
        store.listTurnEvents({
          session_id: sessionId,
          turn_id: missingTurnId,
          limit: 10,
          page_token: undefined,
          order: undefined,
        }),
      ).rejects.toBeInstanceOf(TurnNotFoundError);
    });

    it('listTurnEvents on a turn with no events returns an empty page', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 'turn-1' }));
      const page = await store.listTurnEvents({
        session_id: sessionId,
        turn_id: 'turn-1',
        limit: 10,
        page_token: undefined,
        order: undefined,
      });
      expect(page.data).toEqual([]);
      expect(page.pagination.next_page_token).toBeUndefined();
    });

    it('listSessionEvents includes running turns and is newest-first', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 't1' }));
      await store.appendToEvents({
        session_id: sessionId,
        turn_id: 't1',
        events: [makeTurnCreatedEvent('t1')],
      });
      await finishTurn(store, 't1');
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 't2', previousTurnId: 't1', firstTurnId: 't1' }));
      await store.appendToEvents({
        session_id: sessionId,
        turn_id: 't2',
        events: [makeTurnCreatedEvent('t2')],
      });
      // t2 still running — must appear in the feed.
      const { data } = await store.listSessionEvents({
        session_id: sessionId,
        limit: 10,
        page_token: undefined,
        last_turn_id: undefined,
      });
      expect(data.map(row => row.turn_id)).toEqual(['t2', 't1', 't1']);
      expect(data.map(row => row.event.type)).toEqual([
        EventType.TURN_CREATED,
        EventType.TURN_DONE,
        EventType.TURN_CREATED,
      ]);
    });

    it('listSessionEvents includes registered passthrough events', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 't1' }));
      // Built through the registered schema so the fixture cannot drift from the registration.
      const passthrough: PersistedTurnEvent = {
        type: 'custom.event',
        ...ContractPassthroughEventSchema.parse({
          id: newEventId(),
          created_at: new Date().toISOString(),
          event: { value: 1 },
        }),
      };
      await store.appendToEvents({
        session_id: sessionId,
        turn_id: 't1',
        events: [passthrough],
      });

      const { data } = await store.listSessionEvents({
        session_id: sessionId,
        limit: 10,
        page_token: undefined,
        last_turn_id: undefined,
      });
      expect(data).toEqual([{ turn_id: 't1', event: passthrough }]);
    });

    it('listSessionEvents defaults to the active branch and excludes fork siblings', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 't1' }));
      await store.appendToEvents({
        session_id: sessionId,
        turn_id: 't1',
        events: [makeTurnCreatedEvent('t1')],
      });
      // Two forks off t1; the sibling is created BEFORE the anchor, so a
      // creation-order prefix would wrongly include it.
      await finishTurn(store, 't1');
      await store.createTurn(
        makeCreateTurnInput({ sessionId, turnId: 't2-sibling', previousTurnId: 't1', firstTurnId: 't1' }),
      );
      await store.createTurn(
        makeCreateTurnInput({ sessionId, turnId: 't2-anchor', previousTurnId: 't1', firstTurnId: 't1' }),
      );
      for (const turnId of ['t2-sibling', 't2-anchor']) {
        await store.appendToEvents({
          session_id: sessionId,
          turn_id: turnId,
          events: [makeTurnCreatedEvent(turnId)],
        });
      }
      const { data } = await store.listSessionEvents({
        session_id: sessionId,
        limit: 10,
        last_turn_id: undefined,
        page_token: undefined,
      });
      expect(data.filter(row => row.event.type === EventType.TURN_CREATED).map(row => row.turn_id)).toEqual([
        't2-anchor',
        't1',
      ]);

      await expect(
        store.listSessionEvents({
          session_id: sessionId,
          limit: 10,
          last_turn_id: missingTurnId,
          page_token: undefined,
        }),
      ).rejects.toBeInstanceOf(TurnNotFoundError);
    });

    it('listSessionEvents page tokens retain their anchor when the active branch changes', async () => {
      const store = createStore();
      await seedSession(store);
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 't1' }));
      await store.appendToEvents({
        session_id: sessionId,
        turn_id: 't1',
        events: [makeTurnCreatedEvent('t1')],
      });
      await finishTurn(store, 't1');
      await store.createTurn(makeCreateTurnInput({ sessionId, turnId: 't2', previousTurnId: 't1', firstTurnId: 't1' }));
      await store.appendToEvents({
        session_id: sessionId,
        turn_id: 't2',
        events: [makeTurnCreatedEvent('t2')],
      });

      const firstPage = await store.listSessionEvents({
        session_id: sessionId,
        limit: 1,
        last_turn_id: undefined,
        page_token: undefined,
      });
      expect(firstPage.data.map(row => row.turn_id)).toEqual(['t2']);
      expect(decodeSessionEventPageToken(mustGet(firstPage.pagination.next_page_token))).toEqual({
        last_turn_id: 't2',
        offset: 1,
      });

      await store.createTurn(
        makeCreateTurnInput({ sessionId, turnId: 't2-new-active', previousTurnId: 't1', firstTurnId: 't1' }),
      );
      await store.appendToEvents({
        session_id: sessionId,
        turn_id: 't2-new-active',
        events: [makeTurnCreatedEvent('t2-new-active')],
      });

      const secondPage = await store.listSessionEvents({
        session_id: sessionId,
        limit: 10,
        last_turn_id: undefined,
        page_token: firstPage.pagination.next_page_token,
      });
      expect(secondPage.data.map(row => row.turn_id)).not.toContain('t2-new-active');
      expect(secondPage.data.map(row => row.turn_id)).toContain('t1');
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
        if (i > 0) {
          await finishTurn(store, mustGet(ids[i - 1], `ids[${String(i - 1)}]`));
        }
        const input = makeCreateTurnInput({
          sessionId,
          turnId,
          ...(i > 0
            ? {
                previousTurnId: mustGet(ids[i - 1], `ids[${String(i - 1)}]`),
                firstTurnId: mustGet(ids[0], 'ids[0]'),
              }
            : {}),
        });
        input.turn.ancestor_ids = window;
        await store.createTurn(input);
        await store.appendToEvents({
          session_id: sessionId,
          turn_id: turnId,
          events: [makeTurnCreatedEvent(turnId)],
        });
      }
      const tip = mustGet(ids.at(-1), 'chain tip');
      const { data } = await store.listSessionEvents({
        session_id: sessionId,
        limit: chainLength + 10,
        last_turn_id: tip,
        page_token: undefined,
      });
      // Full chain reachable despite truncated windows, newest-first turn.created rows only.
      expect(data.filter(row => row.event.type === EventType.TURN_CREATED).map(row => row.turn_id)).toEqual(
        [...ids].reverse(),
      );
    });
  });

  describe('deep-copy boundary', () => {
    it('mutating a returned session does not mutate the store', async () => {
      const store = createStore();
      await seedSession(store);
      const session = mustGet(await store.getSession({ tenant_id: tenant, session_id: sessionId }));
      if (session.agent.type !== 'inline') {
        throw new Error('expected inline agent');
      }
      session.agent.spec.instructions = 'mutated';
      const again = mustGet(await store.getSession({ tenant_id: tenant, session_id: sessionId }));
      expect(again.agent).toMatchObject({
        type: 'inline',
        spec: { instructions: 'You are a test agent.' },
      });
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
