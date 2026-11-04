import {
  memoryIngestLoop,
  runMemoryIngestPass,
  type MemoryIngestConfig,
  type MemoryIngestDeps,
} from '../../../src/controller/memoryIngest';
import type {
  IMemoryIngestStore,
  ListMemoryIngestCandidatesInput,
  MemoryIngestCandidate,
  MemoryIngestCursor,
  MemoryIngestModelMessage,
  MemoryIngestTurn,
  UpsertMemoryIngestCursorInput,
} from '../../../src/db/memoryIngestStore';
import { MemoryIngestError, type IngestExchangeInput, type MemoryProvider } from '../../../src/memory/MemoryProvider';
import { TenantAllowlistMemorySettings } from '../../../src/memory/MemorySettings';
import { memoryScopeKey } from '../../../src/memory/scope';
import {
  answer,
  askCall,
  at,
  doneState,
  pausedState,
  reply,
  RUNNING,
  T0,
  turn,
  userMessage,
} from '../memory/turnFixtures';

const MINUTE = 60_000;
const NOW = new Date(T0 + 60 * MINUTE);

const CONFIG: MemoryIngestConfig = {
  intervalMs: 5 * MINUTE,
  maxSessionsPerRun: 50,
  maxExchangesPerSession: 20,
  lookbackMs: 120 * MINUTE,
  pauseTimeoutMs: 720 * MINUTE,
};

interface FakeSession {
  candidate: Omit<MemoryIngestCandidate, 'cursor' | 'tip_turn_id'>;
  turns: MemoryIngestTurn[];
  messages: MemoryIngestModelMessage[];
}

/** In-memory store: the SQL eligibility filters are covered by the store contract suite. */
class FakeStore implements IMemoryIngestStore {
  readonly sessions = new Map<string, FakeSession>();
  readonly cursors = new Map<string, MemoryIngestCursor>();
  readonly upserts: UpsertMemoryIngestCursorInput[] = [];

  add(session: FakeSession): void {
    this.sessions.set(session.candidate.session_id, session);
  }

  async listCandidateSessions(input: ListMemoryIngestCandidatesInput): Promise<MemoryIngestCandidate[]> {
    const candidates: { updatedAt: string; candidate: MemoryIngestCandidate }[] = [];
    for (const session of this.sessions.values()) {
      if (input.tenant_ids !== undefined && !input.tenant_ids.includes(session.candidate.tenant_id)) {
        continue;
      }
      const tip = session.turns[session.turns.length - 1];
      if (tip === undefined) {
        continue;
      }
      const cursor = this.cursors.get(session.candidate.session_id) ?? null;
      // session.updated_at moves when a turn is created.
      const sessionUpdatedAt = tip.created_at;
      const updatedMs = Date.parse(sessionUpdatedAt);
      const tipPaused = tip.state.status === 'done' && tip.state.required_actions.length > 0;
      const inRange =
        updatedMs >= input.recent_since.getTime() ||
        (tipPaused && updatedMs >= input.paused_from.getTime() && updatedMs < input.paused_until.getTime());
      if (cursor?.last_ingested_turn_id === tip.turn_id || !inRange) {
        continue;
      }
      candidates.push({
        updatedAt: sessionUpdatedAt,
        candidate: { ...session.candidate, tip_turn_id: tip.turn_id, cursor },
      });
    }
    const key = (c: (typeof candidates)[number]) => `${c.updatedAt}|${c.candidate.session_id}`;
    return candidates
      .sort((a, b) => key(a).localeCompare(key(b)))
      .slice(0, input.limit)
      .map(c => c.candidate);
  }

  async listSessionTurns(input: { session_id: string }): Promise<MemoryIngestTurn[]> {
    return this.sessions.get(input.session_id)?.turns ?? [];
  }

  async listMainThreadModelMessages(input: {
    session_id: string;
    turn_ids: readonly string[];
  }): Promise<MemoryIngestModelMessage[]> {
    const messages = this.sessions.get(input.session_id)?.messages ?? [];
    return messages.filter(entry => input.turn_ids.includes(entry.turn_id));
  }

  async upsertCursor(input: UpsertMemoryIngestCursorInput): Promise<void> {
    this.upserts.push(input);
    this.cursors.set(input.session_id, { ...input, updated_at: NOW.toISOString() });
  }
}

/** Ingestion never reads or writes memory directly. */
const RETRIEVAL_UNUSED = {
  getUserSummary: () => Promise.reject(new Error('not used by ingestion')),
  search: () => Promise.reject(new Error('not used by ingestion')),
  addMemory: () => Promise.reject(new Error('not used by ingestion')),
};

function fakeProvider(fail: (input: IngestExchangeInput) => boolean = () => false) {
  const calls: IngestExchangeInput[] = [];
  const provider: MemoryProvider = {
    ...RETRIEVAL_UNUSED,
    name: 'zep',
    async ingestExchange(input) {
      calls.push(input);
      if (fail(input)) {
        throw new Error('memory provider unavailable');
      }
      return { externalThreadId: input.externalThreadId ?? `thread-${input.exchange.sessionId}` };
    },
  };
  return { provider, calls };
}

function fakeLogger() {
  return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function deps({
  store,
  provider,
  logger = fakeLogger(),
  config = {},
  enabledTenants = ['acme'],
}: {
  store: FakeStore;
  provider: MemoryProvider;
  logger?: ReturnType<typeof fakeLogger>;
  config?: Partial<MemoryIngestConfig>;
  /** Stands in for `TRUEFOUNDRY_MEMORY_TENANT_ALLOWLIST`. */
  enabledTenants?: string[];
}): MemoryIngestDeps {
  return {
    store,
    provider,
    settings: { listEnabledTenantIds: async () => enabledTenants },
    logger: logger as never,
    config: { ...CONFIG, ...config },
    now: () => NOW,
  };
}

function session({
  id,
  tenant = 'acme',
  agentId = null,
  agentMemoryEnabled = false,
  turns,
  messages = [],
}: {
  id: string;
  tenant?: string;
  agentId?: string | null;
  agentMemoryEnabled?: boolean;
  turns: MemoryIngestTurn[];
  messages?: MemoryIngestModelMessage[];
}): FakeSession {
  return {
    candidate: {
      session_id: id,
      tenant_id: tenant,
      created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'User One' },
      agent_id: agentId,
      tfg_source: 'ui',
      create_agent_session: false,
      agent_memory_enabled: agentMemoryEnabled,
    },
    turns,
    messages,
  };
}

/** Closed exchange: one user message answered at `minute`. */
function closedTurn(id: string, previous: string | null, minute: number): MemoryIngestTurn {
  return turn({
    id,
    previous,
    input: [userMessage(`message ${id}`)],
    state: doneState({ completedAt: at(minute * MINUTE), output: reply(`reply ${id}`) }),
    createdAt: at((minute - 1) * MINUTE),
  });
}

const signal = () => new AbortController().signal;

describe('runMemoryIngestPass', () => {
  it("never hands the user's display name to the provider", async () => {
    const store = new FakeStore();
    store.add(session({ id: 's1', turns: [closedTurn('t1', null, 10)] }));
    const { provider, calls } = fakeProvider();

    await runMemoryIngestPass({ deps: deps({ store, provider }), signal: signal() });

    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls)).not.toContain('User One');
  });

  it('sends finished exchanges in order, stops at the first unfinished one and checkpoints each send', async () => {
    const store = new FakeStore();
    store.add(
      session({
        id: 's1',
        turns: [
          closedTurn('t1', null, 10),
          closedTurn('t2', 't1', 20),
          turn({
            id: 't3',
            previous: 't2',
            input: [userMessage('still going')],
            state: RUNNING,
            createdAt: at(59 * MINUTE),
          }),
        ],
      }),
    );
    const { provider, calls } = fakeProvider();

    await runMemoryIngestPass({ deps: deps({ store, provider }), signal: signal() });

    expect(calls.map(call => [call.exchange.lastTurnId, call.externalThreadId])).toEqual([
      ['t1', null],
      ['t2', 'thread-s1'],
    ]);
    expect(calls[0]?.scope.key).toBe(memoryScopeKey({ tenantId: 'acme', agentKey: 'trueforge', subjectId: 'user-1' }));
    expect(calls[0]?.exchange.messages.map(m => [m.role, m.content, m.extract])).toEqual([
      ['user', 'message t1', true],
      ['assistant', 'reply t1', false],
    ]);
    expect(store.upserts.map(u => u.last_ingested_turn_id)).toEqual(['t1', 't2']);
    expect(store.cursors.get('s1')).toMatchObject({ external_thread_id: 'thread-s1', last_error: null });
  });

  it('looks back 2 hours for all sessions and 12-14 hours only for paused ones', async () => {
    const store = new FakeStore();
    const list = jest.spyOn(store, 'listCandidateSessions');
    // Last turn started 3 hours ago and finished: out of the recent range.
    store.add(session({ id: 'stale', turns: [closedTurn('t1', null, -119)] }));
    // Paused on a question 13 hours ago: in the paused range, and past the pause timeout.
    store.add(
      session({
        id: 'paused',
        turns: [
          turn({
            id: 'u1',
            previous: null,
            input: [userMessage('Plan dinner')],
            state: pausedState({ completedAt: at(-12 * 60 * MINUTE + MINUTE), toolCallId: 'call-1' }),
            createdAt: at(-12 * 60 * MINUTE),
          }),
        ],
      }),
    );
    const { provider, calls } = fakeProvider();

    await runMemoryIngestPass({ deps: deps({ store, provider }), signal: signal() });

    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        recent_since: new Date(NOW.getTime() - 120 * MINUTE),
        paused_from: new Date(NOW.getTime() - 14 * 60 * MINUTE),
        paused_until: new Date(NOW.getTime() - 12 * 60 * MINUTE),
      }),
    );
    expect(calls.map(call => call.exchange.sessionId)).toEqual(['paused']);
  });

  it('sends an exchange that finished just before the run', async () => {
    const store = new FakeStore();
    store.add(session({ id: 's1', turns: [closedTurn('t1', null, 59.5)] }));
    const { provider, calls } = fakeProvider();

    const summary = await runMemoryIngestPass({
      deps: deps({ store, provider }),
      signal: signal(),
    });

    expect(calls.map(call => call.exchange.lastTurnId)).toEqual(['t1']);
    expect(summary.sessions_by_outcome).toEqual({ ingested: 1 });
  });

  it('reads only sessions of allowlisted tenants, so others never take a run slot', async () => {
    const store = new FakeStore();
    store.add(session({ id: 's1', tenant: 'other', turns: [closedTurn('t1', null, 10)] }));
    store.add(session({ id: 's2', tenant: 'other', turns: [closedTurn('t1', null, 11)] }));
    store.add(session({ id: 's3', turns: [closedTurn('t1', null, 12)] }));
    const { provider, calls } = fakeProvider();

    const summary = await runMemoryIngestPass({
      deps: deps({ store, provider, config: { maxSessionsPerRun: 1 } }),
      signal: signal(),
    });

    expect(calls.map(call => call.exchange.sessionId)).toEqual(['s3']);
    expect(store.upserts.map(upsert => upsert.session_id)).toEqual(['s3']);
    expect(summary).toMatchObject({ sessions: 1, backlog: false, sessions_by_outcome: { ingested: 1 } });
  });

  it("reads every tenant's sessions when the allowlist is empty", async () => {
    const store = new FakeStore();
    store.add(session({ id: 's1', turns: [closedTurn('t1', null, 10)] }));
    store.add(session({ id: 's2', tenant: 'other', turns: [closedTurn('t1', null, 11)] }));
    const { provider, calls } = fakeProvider();

    const summary = await runMemoryIngestPass({
      deps: { ...deps({ store, provider }), settings: new TenantAllowlistMemorySettings({ tenantIds: [] }) },
      signal: signal(),
    });

    expect(calls.map(call => call.exchange.sessionId)).toEqual(['s1', 's2']);
    expect(summary).toMatchObject({ sessions: 2, sessions_by_outcome: { ingested: 2 } });
  });

  it('follows the agent manifest: skips UI sessions on an agent with memory off, uses the agent scope when on', async () => {
    const store = new FakeStore();
    store.add(session({ id: 'off', agentId: 'chef', turns: [closedTurn('t1', null, 10)] }));
    store.add(session({ id: 'on', agentId: 'chef', agentMemoryEnabled: true, turns: [closedTurn('t1', null, 11)] }));
    const { provider, calls } = fakeProvider();

    const summary = await runMemoryIngestPass({
      deps: deps({ store, provider }),
      signal: signal(),
    });

    expect(summary.sessions_by_outcome).toEqual({ memory_disabled: 1, ingested: 1 });
    expect(calls.map(call => [call.exchange.sessionId, call.scope.key])).toEqual([
      ['on', memoryScopeKey({ tenantId: 'acme', agentKey: 'chef', subjectId: 'user-1' })],
    ]);
    expect(calls[0]?.exchange.messages.some(message => 'name' in message)).toBe(false);
  });

  it('records the error and keeps the checkpoint when the provider fails', async () => {
    const store = new FakeStore();
    store.add(session({ id: 's1', turns: [closedTurn('t1', null, 10), closedTurn('t2', 't1', 20)] }));
    const { provider, calls } = fakeProvider(input => input.exchange.lastTurnId === 't2');
    const logger = fakeLogger();

    const summary = await runMemoryIngestPass({
      deps: deps({ store, provider, logger }),
      signal: signal(),
    });

    expect(calls).toHaveLength(2);
    expect(store.cursors.get('s1')).toMatchObject({
      last_ingested_turn_id: 't1',
      last_error: 'memory provider unavailable',
    });
    expect(summary).toMatchObject({ exchanges_sent: 1, exchanges_failed: 1, sessions_by_outcome: { failed: 1 } });
    expect(logger.error).toHaveBeenCalledWith(
      'Memory ingest failed for session',
      expect.objectContaining({
        session_id: 's1',
        last_error: 'memory provider unavailable',
        reportable_error: expect.anything(),
      }),
    );
  });

  it('after a failure, asks the provider to check before resending only the exchange that failed', async () => {
    const store = new FakeStore();
    store.add(
      session({
        id: 's1',
        turns: [closedTurn('t1', null, 10), closedTurn('t2', 't1', 20), closedTurn('t3', 't2', 30)],
      }),
    );
    let failT2 = true;
    const { provider, calls } = fakeProvider(input => failT2 && input.exchange.lastTurnId === 't2');
    const run = () => runMemoryIngestPass({ deps: deps({ store, provider }), signal: signal() });

    await run();
    failT2 = false;
    await run();

    expect(calls.map(call => [call.exchange.lastTurnId, call.mayAlreadyBeStored])).toEqual([
      ['t1', false],
      ['t2', false],
      ['t2', true],
      ['t3', false],
    ]);
    expect(store.cursors.get('s1')).toMatchObject({ last_ingested_turn_id: 't3', last_error: null });
  });

  it('saves a thread the provider created before failing, so the retry reuses it', async () => {
    const store = new FakeStore();
    store.add(session({ id: 's1', turns: [closedTurn('t1', null, 10)] }));
    const provider: MemoryProvider = {
      ...RETRIEVAL_UNUSED,
      name: 'zep',
      async ingestExchange() {
        throw new MemoryIngestError({ message: 'add failed', externalThreadId: 'created-thread', cause: null });
      },
    };

    await runMemoryIngestPass({ deps: deps({ store, provider }), signal: signal() });

    expect(store.cursors.get('s1')).toMatchObject({
      last_ingested_turn_id: null,
      external_thread_id: 'created-thread',
      last_error: 'add failed',
    });
  });

  it('continues after the checkpoint in the stored provider thread', async () => {
    const store = new FakeStore();
    store.add(session({ id: 's1', turns: [closedTurn('t1', null, 10), closedTurn('t2', 't1', 20)] }));
    store.cursors.set('s1', {
      session_id: 's1',
      last_ingested_turn_id: 't1',
      external_thread_id: 'existing-thread',
      last_error: null,
      updated_at: at(0),
    });
    const { provider, calls } = fakeProvider();

    const summary = await runMemoryIngestPass({
      deps: deps({ store, provider }),
      signal: signal(),
    });

    expect(calls.map(call => [call.exchange.lastTurnId, call.externalThreadId])).toEqual([['t2', 'existing-thread']]);
    expect(summary.sessions_by_outcome).toEqual({ ingested: 1 });
    expect(store.cursors.get('s1')).toMatchObject({
      last_ingested_turn_id: 't2',
      external_thread_id: 'existing-thread',
    });
  });

  it('sends only the new branch after the user edits an ingested turn', async () => {
    const store = new FakeStore();
    store.add(
      session({
        id: 's1',
        turns: [closedTurn('t1', null, 10), closedTurn('t2', 't1', 20), closedTurn('t2-edit', 't1', 30)],
      }),
    );
    store.cursors.set('s1', {
      session_id: 's1',
      last_ingested_turn_id: 't2',
      external_thread_id: 'thread-s1',
      last_error: null,
      updated_at: at(0),
    });
    const { provider, calls } = fakeProvider();
    const logger = fakeLogger();

    const summary = await runMemoryIngestPass({
      deps: deps({ store, provider, logger }),
      signal: signal(),
    });

    expect(calls.map(call => call.exchange.lastTurnId)).toEqual(['t2-edit']);
    expect(summary.sessions_by_outcome).toEqual({ ingested: 1 });
    expect(logger.warn).toHaveBeenCalledWith(
      'Memory checkpoint is off the active path; resuming after the fork point',
      expect.objectContaining({ session_id: 's1', last_ingested_turn_id: 't2' }),
    );
  });

  it('sends a timed-out question as partial, then the answer with its question as a continuation', async () => {
    const store = new FakeStore();
    const paused = turn({
      id: 'u1',
      previous: null,
      input: [userMessage('Plan dinner')],
      state: pausedState({ completedAt: at(-12.5 * 60 * MINUTE), toolCallId: 'call-1' }),
      createdAt: at(-12.5 * 60 * MINUTE - MINUTE),
    });
    const fakeSession = session({
      id: 's1',
      turns: [paused],
      messages: [{ turn_id: 'u1', message: askCall({ toolCallId: 'call-1', question: 'Which cuisine?' }) }],
    });
    store.add(fakeSession);
    const { provider, calls } = fakeProvider();
    const run = () => runMemoryIngestPass({ deps: deps({ store, provider }), signal: signal() });

    await run();
    expect(calls[0]?.exchange.messages.map(m => m.content)).toEqual(['Plan dinner']);
    expect(store.cursors.get('s1')?.last_ingested_turn_id).toBe('u1');

    fakeSession.turns.push(
      turn({
        id: 'a2',
        previous: 'u1',
        input: [answer({ toolCallId: 'call-1', content: 'Thai' })],
        state: doneState({ completedAt: at(30 * MINUTE), output: reply('Green curry it is') }),
        createdAt: at(29 * MINUTE),
      }),
    );
    await run();
    expect(calls[1]?.exchange.messages.map(m => m.content)).toEqual([
      '(Answering "Which cuisine?") Thai',
      'Green curry it is',
    ]);
    expect(calls[1]?.externalThreadId).toBe('thread-s1');
  });

  it('caps exchanges per session and sessions per run; each run starts from the oldest unfinished session', async () => {
    const store = new FakeStore();
    store.add(session({ id: 'a', turns: [closedTurn('t1', null, 10), closedTurn('t2', 't1', 40)] }));
    store.add(session({ id: 'b', turns: [closedTurn('t1', null, 20)] }));
    store.add(session({ id: 'c', turns: [closedTurn('t1', null, 30)] }));
    const { provider, calls } = fakeProvider();
    const logger = fakeLogger();
    const runDeps = deps({ store, provider, logger, config: { maxSessionsPerRun: 2, maxExchangesPerSession: 1 } });

    const first = await runMemoryIngestPass({ deps: runDeps, signal: signal() });
    expect(calls.map(call => `${call.exchange.sessionId}/${call.exchange.lastTurnId}`)).toEqual(['b/t1', 'c/t1']);
    expect(first).toMatchObject({ sessions: 2, backlog: true });

    const second = await runMemoryIngestPass({ deps: runDeps, signal: signal() });
    expect(calls.slice(2).map(call => `${call.exchange.sessionId}/${call.exchange.lastTurnId}`)).toEqual(['a/t1']);
    expect(second.backlog).toBe(false);

    await runMemoryIngestPass({ deps: runDeps, signal: signal() });
    expect(calls.slice(3).map(call => `${call.exchange.sessionId}/${call.exchange.lastTurnId}`)).toEqual(['a/t2']);
  });

  it('logs a run summary with session and exchange counts', async () => {
    const store = new FakeStore();
    store.add(session({ id: 's1', turns: [closedTurn('t1', null, 50), closedTurn('t2', 't1', 58)] }));
    const { provider } = fakeProvider();
    const logger = fakeLogger();

    await runMemoryIngestPass({ deps: deps({ store, provider, logger }), signal: signal() });

    expect(logger.info).toHaveBeenCalledWith('Memory ingest run finished', {
      sessions: 1,
      backlog: false,
      sessions_by_outcome: { ingested: 1 },
      exchanges_sent: 2,
      exchanges_failed: 0,
      duration_ms: 0,
    });
  });

  it('stops between sessions once the controller is shutting down', async () => {
    const store = new FakeStore();
    store.add(session({ id: 's1', turns: [closedTurn('t1', null, 10)] }));
    const { provider, calls } = fakeProvider();
    const controller = new AbortController();
    controller.abort();

    await memoryIngestLoop(deps({ store, provider })).tick(controller.signal);

    expect(calls).toHaveLength(0);
  });
});
