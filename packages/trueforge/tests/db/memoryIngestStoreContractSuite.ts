/**
 * Backend-agnostic behavioural contract for IMemoryIngestStore.
 * Runs under jest against a fresh store per test (see backend test files).
 */
import {
  AgentSpecSchema,
  MAIN_THREAD_ID,
  type CreatedBySubject,
  type ISessionStore,
  type PersistedTurnEvent,
  type SessionMetadata,
  type TerminalTurnState,
  type TurnInputItem,
} from '@truefoundry/trueforge-core/agent-session';
import {
  makeCreateTurnInput,
  makeDoneTurnState,
  makeTurnDoneEvent,
} from '../../../trueforge-core/tests/agent-session/testHelpers';
import type { IMemoryIngestStore } from '../../src/db/memoryIngestStore';
import { reply } from '../unit/memory/turnFixtures';

const TENANT = 'default';
const OWNER: CreatedBySubject = { subject_id: 'owner', subject_type: 'user', subject_display_name: 'Owner' };
const UI: SessionMetadata = { 'tfg.source': 'ui' };
const SPEC = AgentSpecSchema.parse({ model: { name: 'test-provider/test-model' }, instructions: 'test' });
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const HOUR_AGO = () => new Date(Date.now() - 60 * 60 * 1000);
const IN_A_MINUTE = () => new Date(Date.now() + 60 * 1000);

/** Every session updated since `since`; an empty paused range. */
function recent(since: Date) {
  return { recent_since: since, paused_from: since, paused_until: since };
}

export interface MemoryIngestStoreContractEnv {
  store: IMemoryIngestStore;
  sessionStore: ISessionStore;
  /** Registry agent row whose manifest carries the agent memory toggle. */
  seedAgent: (input: { tenant_id: string; agent_id: string; memory_enabled: boolean }) => Promise<void>;
}

export function runMemoryIngestStoreContractSuite(getEnv: () => MemoryIngestStoreContractEnv): void {
  async function createSession({
    session_id,
    metadata = UI,
    agent_id = null,
    scheduled = false,
  }: {
    session_id: string;
    metadata?: SessionMetadata;
    agent_id?: string | null;
    scheduled?: boolean;
  }) {
    await getEnv().sessionStore.createSession({
      tenant_id: TENANT,
      session_id,
      created_by_subject: OWNER,
      agent: agent_id === null ? { type: 'inline', spec: SPEC } : { type: 'reference', id: agent_id, name: 'Agent' },
      custom: null,
      metadata,
      external_id: null,
      source: scheduled ? { type: 'schedule', id: 'sched-1', run_id: 'run-1' } : null,
    });
  }

  async function addTurn({
    session_id,
    turn_id,
    previous_turn_id = null,
    input = [{ type: 'user.message', content: `hello from ${turn_id}` }],
    events = [],
    state = makeDoneTurnState(),
  }: {
    session_id: string;
    turn_id: string;
    previous_turn_id?: string | null;
    input?: TurnInputItem[];
    events?: PersistedTurnEvent[];
    state?: TerminalTurnState;
  }) {
    const { sessionStore } = getEnv();
    const created = makeCreateTurnInput({ sessionId: session_id, turnId: turn_id, previousTurnId: previous_turn_id });
    await sessionStore.createTurn({ ...created, turn: { ...created.turn, input } });
    if (events.length > 0) {
      await sessionStore.appendToEvents({ session_id, turn_id, events });
    }
    await sessionStore.updateTurnTerminalState({
      session_id,
      turn_id,
      state,
      turn_done_event: makeTurnDoneEvent(state),
    });
  }

  async function candidateIds(since: Date = HOUR_AGO()): Promise<string[]> {
    const candidates = await getEnv().store.listCandidateSessions({ ...recent(since), limit: 100 });
    return candidates.map(candidate => candidate.session_id);
  }

  it('lists a UI session by its tip turn with the parsed creator and no cursor', async () => {
    await createSession({ session_id: 's1' });
    await addTurn({ session_id: 's1', turn_id: 't1' });

    const [candidate, ...rest] = await getEnv().store.listCandidateSessions({
      ...recent(HOUR_AGO()),
      limit: 10,
    });
    expect(rest).toEqual([]);
    expect(candidate).toMatchObject({
      session_id: 's1',
      tenant_id: TENANT,
      created_by_subject: OWNER,
      agent_id: null,
      tfg_source: 'ui',
      agent_memory_enabled: false,
      tip_turn_id: 't1',
      cursor: null,
    });
    expect(candidate?.tip_updated_at).toMatch(ISO_UTC);
    expect(candidate?.session_updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}Z$/);
  });

  it('skips scheduled, non-UI, turnless and out-of-window sessions', async () => {
    await createSession({ session_id: 'scheduled', scheduled: true });
    await addTurn({ session_id: 'scheduled', turn_id: 't1' });
    await createSession({ session_id: 'api', metadata: {} });
    await addTurn({ session_id: 'api', turn_id: 't1' });
    await createSession({ session_id: 'empty' });
    await createSession({ session_id: 'ui' });
    await addTurn({ session_id: 'ui', turn_id: 't1' });

    expect(await candidateIds()).toEqual(['ui']);
    expect(await candidateIds(new Date(Date.now() + 60_000))).toEqual([]);
  });

  it('lists only sessions paused on the user from the paused range', async () => {
    await createSession({ session_id: 'paused' });
    const pausedState: TerminalTurnState = {
      status: 'done',
      output: null,
      completed_at: new Date().toISOString(),
      required_actions: [
        {
          type: 'tool.response_required',
          id: 'evt-req',
          created_at: new Date().toISOString(),
          thread_id: MAIN_THREAD_ID,
          tool_calls: [{ id: 'call-1', source_event_id: 'evt-ask' }],
        },
      ],
    };
    await addTurn({ session_id: 'paused', turn_id: 't1', state: pausedState });
    await createSession({ session_id: 'closed' });
    await addTurn({ session_id: 'closed', turn_id: 't1' });

    // Nothing is recent; both sessions fall inside the paused range.
    const candidates = await getEnv().store.listCandidateSessions({
      recent_since: IN_A_MINUTE(),
      paused_from: HOUR_AGO(),
      paused_until: IN_A_MINUTE(),
      limit: 10,
    });
    expect(candidates.map(c => c.session_id)).toEqual(['paused']);
  });

  it('includes sessions on a registry agent only when its memory is enabled, even from the UI', async () => {
    const { seedAgent } = getEnv();
    await seedAgent({ tenant_id: TENANT, agent_id: 'agent-on', memory_enabled: true });
    await seedAgent({ tenant_id: TENANT, agent_id: 'agent-off', memory_enabled: false });
    await createSession({ session_id: 'on', metadata: {}, agent_id: 'agent-on' });
    await addTurn({ session_id: 'on', turn_id: 't1' });
    await createSession({ session_id: 'off', metadata: {}, agent_id: 'agent-off' });
    await addTurn({ session_id: 'off', turn_id: 't1' });
    await createSession({ session_id: 'ui-off', agent_id: 'agent-off' });
    await addTurn({ session_id: 'ui-off', turn_id: 't1' });

    const candidates = await getEnv().store.listCandidateSessions({ ...recent(HOUR_AGO()), limit: 10 });
    expect(candidates.map(c => [c.session_id, c.agent_id, c.agent_memory_enabled])).toEqual([['on', 'agent-on', true]]);
  });

  it('drops a session once its tip is ingested and returns it with the cursor after a new turn', async () => {
    const { store } = getEnv();
    await createSession({ session_id: 's1' });
    await addTurn({ session_id: 's1', turn_id: 't1' });

    await store.upsertCursor({
      session_id: 's1',
      last_ingested_turn_id: 't1',
      external_thread_id: 'thread-1',
      last_error: null,
    });
    expect(await candidateIds()).toEqual([]);

    await addTurn({ session_id: 's1', turn_id: 't2', previous_turn_id: 't1' });
    const [candidate] = await store.listCandidateSessions({ ...recent(HOUR_AGO()), limit: 10 });
    expect(candidate?.tip_turn_id).toBe('t2');
    expect(candidate?.cursor).toMatchObject({
      session_id: 's1',
      last_ingested_turn_id: 't1',
      external_thread_id: 'thread-1',
      last_error: null,
    });
    expect(candidate?.cursor?.updated_at).toMatch(ISO_UTC);
  });

  it('keeps a session listed when only an error was recorded, and upsert overwrites the cursor', async () => {
    const { store } = getEnv();
    await createSession({ session_id: 's1' });
    await addTurn({ session_id: 's1', turn_id: 't1' });
    await store.upsertCursor({
      session_id: 's1',
      last_ingested_turn_id: null,
      external_thread_id: null,
      last_error: 'boom',
    });
    const [failed] = await store.listCandidateSessions({ ...recent(HOUR_AGO()), limit: 10 });
    expect(failed?.cursor).toMatchObject({ last_ingested_turn_id: null, external_thread_id: null, last_error: 'boom' });

    await store.upsertCursor({
      session_id: 's1',
      last_ingested_turn_id: 't1',
      external_thread_id: 'thread-1',
      last_error: null,
    });
    expect(await candidateIds()).toEqual([]);
  });

  it('orders by session update time, honours the limit and continues after a keyset', async () => {
    for (const session_id of ['a', 'b', 'c']) {
      await createSession({ session_id });
    }
    for (const session_id of ['b', 'c', 'a']) {
      await addTurn({ session_id, turn_id: 't1' });
      // SQLite timestamps have millisecond resolution.
      await new Promise(resolve => setTimeout(resolve, 5));
    }

    expect(await candidateIds()).toEqual(['b', 'c', 'a']);
    const { store } = getEnv();
    const limited = await store.listCandidateSessions({ ...recent(HOUR_AGO()), limit: 2 });
    expect(limited.map(c => c.session_id)).toEqual(['b', 'c']);

    const [, last] = limited;
    if (last === undefined) {
      throw new Error('expected two candidates');
    }
    const after = { session_updated_at: last.session_updated_at, session_id: last.session_id };
    const next = await store.listCandidateSessions({ ...recent(HOUR_AGO()), after, limit: 2 });
    expect(next.map(c => c.session_id)).toEqual(['a']);
  });

  it('lets a session be deleted while keeping its cursor for provider cleanup', async () => {
    const { store, sessionStore } = getEnv();
    await createSession({ session_id: 's1' });
    await addTurn({ session_id: 's1', turn_id: 't1' });
    await store.upsertCursor({
      session_id: 's1',
      last_ingested_turn_id: 'old',
      external_thread_id: 'thread',
      last_error: null,
    });

    await sessionStore.deleteSession({ tenant_id: TENANT, session_id: 's1' });
    expect(await candidateIds()).toEqual([]);

    // Re-creating the id surfaces the surviving row.
    await createSession({ session_id: 's1' });
    await addTurn({ session_id: 's1', turn_id: 't1' });
    const [candidate] = await store.listCandidateSessions({ ...recent(HOUR_AGO()), limit: 10 });
    expect(candidate?.cursor).toMatchObject({ last_ingested_turn_id: 'old', external_thread_id: 'thread' });
  });

  it('returns turn input without attachment data, keeping text parts in order and other items whole', async () => {
    const { store } = getEnv();
    await createSession({ session_id: 's1' });
    await addTurn({
      session_id: 's1',
      turn_id: 't1',
      input: [
        {
          type: 'user.message',
          content: [
            { type: 'text', text: 'first' },
            { type: 'file', name: 'big.pdf', data: `data:application/pdf;base64,${'A'.repeat(10_000)}` },
            { type: 'text', text: 'second' },
          ],
        },
        { type: 'user.message', content: 'plain' },
        { type: 'user.tool_response', thread_id: MAIN_THREAD_ID, tool_call_id: 'call-1', content: 'Thai' },
      ],
    });

    const [turn] = await store.listSessionTurns({ session_id: 's1' });
    expect(turn?.input).toEqual([
      {
        type: 'user.message',
        content: [
          { type: 'text', text: 'first' },
          { type: 'text', text: 'second' },
        ],
      },
      { type: 'user.message', content: 'plain' },
      { type: 'user.tool_response', thread_id: MAIN_THREAD_ID, tool_call_id: 'call-1', content: 'Thai' },
    ]);
  });

  it('lists every turn with input and state, and only main-thread model messages of the requested turns', async () => {
    const { store } = getEnv();
    await createSession({ session_id: 's1' });
    const main = reply('main reply', 'evt-1');
    const subagent = { ...reply('subagent reply', 'evt-2'), thread_id: 'sub-1' };
    await addTurn({ session_id: 's1', turn_id: 't1', events: [main, subagent] });
    await addTurn({
      session_id: 's1',
      turn_id: 't2',
      previous_turn_id: 't1',
      input: [{ type: 'user.message', content: 'second' }],
      events: [reply('later', 'evt-3')],
    });

    const turns = await store.listSessionTurns({ session_id: 's1' });
    expect(turns.map(turn => [turn.turn_id, turn.previous_turn_id, turn.state.status])).toEqual([
      ['t1', null, 'done'],
      ['t2', 't1', 'done'],
    ]);
    expect(turns[1]?.input).toEqual([{ type: 'user.message', content: 'second' }]);
    expect(turns[0]?.created_at).toMatch(ISO_UTC);

    const messages = await store.listMainThreadModelMessages({ session_id: 's1', turn_ids: ['t1'] });
    expect(messages).toEqual([{ turn_id: 't1', message: main }]);
    expect(main.thread_id).toBe(MAIN_THREAD_ID);
    expect(await store.listMainThreadModelMessages({ session_id: 's1', turn_ids: [] })).toEqual([]);
  });
}
