/**
 * Bound session handle: starts turns via {@link SessionHandle.createTurn}.
 */
import { newEventId } from '../core/events/schema';
import type { AgentDefinition } from '../core/runtime/AgentDefinition';
import { AgentThread } from '../core/runtime/AgentThread';
import type {
  AgentThreadAppendContext,
  AgentThreadSendBatch,
  AgentThreadSnapshot,
} from '../core/runtime/AgentThread.types';
import { AgentThreadOrchestrator } from '../core/runtime/AgentThreadOrchestrator';
import {
  isApprovalDecisionMessage,
  isClientSideToolResponseMessage,
  isInputUserMessage,
} from '../core/runtime/contextUtils';
import type { CreateDynamicSubAgentThread } from '../core/runtime/CreateDynamicSubAgentThread';
import type { Sandbox } from '../core/sandbox/Sandbox';
import type { AgentTracing } from '../core/tracing/AgentTracing';
import { builtinsFromSpec } from './builtinsFromSpec';
import type { ITurnResourceResolver, ResolvedAgentDefinition } from './ITurnResourceResolver';
import type { SessionRecord } from './models/SessionRecord';
import { MAIN_THREAD_ID, type TurnRecord, type TurnSnapshot } from './models/TurnRecord';
import type { AgentSpec } from './schemas/agentSpec';
import type { SessionEventItem } from './schemas/events';
import { EventType, type TurnDoneEvent } from './schemas/events';
import type { TokenPagination } from './schemas/pagination';
import type { SessionAgent } from './schemas/session';
import type { TurnInputItem } from './schemas/turn';
import { CancellationReason } from './schemas/turn';
import type { ISessionStore, NewThreadInit, TurnContextAppend, TurnRecordWithoutSnapshot } from './store/ISessionStore';
import { TurnHandle } from './TurnHandle';

/** How many recent ancestors SessionHandle persists on each turn. Store-local. */
const MAX_TURN_ANCESTORS = 20;

function resolvePreviousTurnId(requested: string | undefined, lastTurnId: string | null | undefined): string | null {
  if (requested === 'none') {
    return null;
  }
  if (requested === undefined || requested === 'auto') {
    return lastTurnId ?? null;
  }
  return requested;
}

function toSendBatch(input: TurnInputItem[] | undefined): AgentThreadSendBatch {
  if (!input || input.length === 0) {
    return [];
  }
  if (input.every(msg => isApprovalDecisionMessage(msg) || isClientSideToolResponseMessage(msg))) {
    return input;
  }
  if (input.every(isInputUserMessage)) {
    return input;
  }
  throw new Error('input must be homogeneous: all user messages, or all approval/tool-response messages');
}

function toNewThreadInit(snapshot: AgentThreadSnapshot): NewThreadInit {
  const { context, current_context_usage, completion, capability_state, ...rest } = snapshot;
  void context;
  void current_context_usage;
  void completion;
  void capability_state;
  return rest;
}

function collectContextAppends(
  events: AsyncGenerator<AgentThreadAppendContext, void, unknown>,
): Promise<TurnContextAppend[]> {
  return (async () => {
    const appendMap = new Map<string, TurnContextAppend>();
    for await (const event of events) {
      const existing = appendMap.get(event.thread_id);
      if (existing) {
        existing.context.push(...event.context);
        if (event.current_context_usage !== undefined) {
          existing.current_context_usage = event.current_context_usage;
        }
      } else {
        appendMap.set(event.thread_id, {
          thread_id: event.thread_id,
          context: [...event.context],
          current_context_usage: event.current_context_usage ?? null,
        });
      }
    }
    return [...appendMap.values()];
  })();
}

function cancelledTurnDoneEvent(reason: CancellationReason): TurnDoneEvent {
  return {
    type: EventType.TURN_DONE,
    id: newEventId(),
    created_at: new Date().toISOString(),
    state: {
      status: 'cancelled',
      reason,
      completed_at: new Date().toISOString(),
    },
    thread_id: null,
  };
}

function threadsRecordFromMap(threads: Map<string, AgentThread>): Record<string, AgentThreadSnapshot> {
  const out: Record<string, AgentThreadSnapshot> = {};
  for (const [id, thread] of threads) {
    out[id] = thread.toSnapshot();
  }
  return out;
}

// Current-turn thread ids. Main (`MAIN_THREAD_ID`) is always present — first turn
// synthesizes it; later turns always carry it in the previous snapshot.
function threadIdsForCurrentTurn(snapshot: TurnSnapshot | undefined): string[] {
  return snapshot ? Object.keys(snapshot.threads) : [MAIN_THREAD_ID];
}

export class SessionHandle<
  TSessionCustom extends object = Record<string, never>,
  TTurnCustom extends object = Record<string, never>,
> {
  private readonly store: ISessionStore<TSessionCustom, TTurnCustom>;
  private session: SessionRecord<TSessionCustom>;

  constructor(options: { store: ISessionStore<TSessionCustom, TTurnCustom>; session: SessionRecord<TSessionCustom> }) {
    this.store = options.store;
    this.session = options.session;
  }

  get session_id(): string {
    return this.session.session_id;
  }

  get tenant_id(): string {
    return this.session.tenant_id;
  }

  get agent(): SessionAgent {
    return this.session.agent;
  }

  get custom(): TSessionCustom | null {
    return this.session.custom;
  }

  get metadata(): SessionRecord<TSessionCustom>['metadata'] {
    return this.session.metadata;
  }

  get record(): SessionRecord<TSessionCustom> {
    return this.session;
  }

  /**
   * Prepares and commits a new turn — NO execution happens here (execution =
   * TurnHandle.stream()). Builds threads from the previous turn's snapshot, then
   * sends the input through the orchestrator fully drained (validation +
   * context append; empty input still preflights threads awaiting user input),
   * then persists via one atomic store.createTurn LAST. A send/validation
   * failure therefore persists nothing. The returned turn is durable with
   * state { status: 'running' }.
   *
   * On any failure, createTurn() closes the resolver (best-effort) before rethrowing,
   * so resources acquired here (e.g. a sandbox VM) never outlive a failed run.
   * On success, ownership of resolver.close() passes to TurnHandle.stream().
   *
   * `previous_turn_id`: omitted/`'auto'` → session tip; `'none'` → new root
   * (no parent, even on a non-empty session); string → fork from that turn
   * (must exist). Concurrent `'auto'` forks both succeed.
   */
  async createTurn(input: {
    turn_id: string;
    input?: TurnInputItem[] | undefined;
    /** 'auto'/omitted → session.last_turn_id; 'none' → new root; id → fork from that turn. */
    previous_turn_id?: string | undefined;
    signal: AbortSignal;
    resolver: ITurnResourceResolver<TTurnCustom>;
    /** Value = stored as-is. Fn = merge over previous turn's custom. Omitted = undefined. */
    custom?: TTurnCustom | ((previous?: TTurnCustom) => TTurnCustom) | undefined;
    /**
     * Forwarded to store.createTurn: sets session.title in the same atomic
     * unit IF the session has none; never overwrites. The caller derives the
     * value (e.g. from the first user message) — the library does not.
     */
    update_session_title_if_not_exist?: string | undefined;
  }): Promise<TurnHandle<TTurnCustom>> {
    const previousTurnId = resolvePreviousTurnId(input.previous_turn_id, this.session.last_turn_id);
    const previous = previousTurnId
      ? await this.freezeTurn({
          turn_id: previousTurnId,
          reason: CancellationReason.CancelledForNextTurn,
        })
      : undefined;

    const custom = typeof input.custom === 'function' ? input.custom(previous?.custom ?? undefined) : input.custom;

    // Dispose-on-early-failure: any resource acquired below (sandbox handle,
    // MCP connections) is owned by createTurn() until the TurnHandle is returned; from then
    // on TurnHandle.stream()'s finally owns resolver.close(). On any throw in this
    // acquisition phase we close the resolver (best-effort, error swallowed)
    // and rethrow — same pattern as the gateway's sessionTurnHandler, which
    // wraps getAgent/handler.init and calls gatewayStore.dispose() on failure.
    try {
      const tracing = input.resolver.createTracing();
      const agent = this.session.agent;
      const spec = agent.type === 'inline' ? agent.spec : await input.resolver.resolveAgentSpec({ agent_id: agent.id });
      const sandbox = await input.resolver.resolveSandbox({
        spec,
        existing: previous?.snapshot.sandbox_info ?? undefined,
        previousTurn: previous,
        signal: input.signal,
        tracing,
      });

      const definitionsByThreadId = await this.resolveAgentDefinitions({
        previous,
        resolver: input.resolver,
        spec,
        tracing,
        signal: input.signal,
      });

      // Wire Code Mode once from main toolSets before threads share the sandbox.
      const mainDefinition = definitionsByThreadId.get(MAIN_THREAD_ID);
      if (!mainDefinition) {
        throw new Error('Unreachable: missing resolved agent definition for main thread');
      }
      if (sandbox) {
        sandbox.configureCodeMode(mainDefinition.definition.toolSets ?? []);
      }

      const agentThreads = this.buildThreads({
        previous,
        resolver: input.resolver,
        spec,
        sandbox,
        tracing,
        definitionsByThreadId,
      });

      const createDynamicSubAgentThread = this.makeCreateDynamicSubAgentThread({
        resolver: input.resolver,
        previous,
        spec,
        sandbox,
        tracing,
      });

      const orchestrator = new AgentThreadOrchestrator({
        agentThreads,
        createDynamicSubAgentThread,
        tracing,
        logger: input.resolver.logger,
      });

      // SEND BEFORE COMMIT — validate + append; throw ⇒ nothing persisted.
      const sendBatch = toSendBatch(input.input);
      const new_context_appends = await collectContextAppends(orchestrator.send(sendBatch));

      const turnId = input.turn_id;
      const now = new Date();

      const new_threads: NewThreadInit[] = [];
      if (!previous) {
        const root = agentThreads.get(MAIN_THREAD_ID);
        if (root) {
          new_threads.push(toNewThreadInit(root.toSnapshot()));
        }
      } else {
        for (const [threadId, thread] of agentThreads) {
          if (previous.snapshot.threads[threadId] === undefined) {
            new_threads.push(toNewThreadInit(thread.toSnapshot()));
          }
        }
      }

      const turnInit: TurnRecordWithoutSnapshot<TTurnCustom> = {
        turn_id: turnId,
        session_id: this.session.session_id,
        first_turn_id: previous?.first_turn_id ?? turnId,
        ancestor_ids: previous ? [...previous.ancestor_ids, previous.turn_id].slice(-MAX_TURN_ANCESTORS) : [],
        previous_turn_id: previousTurnId,
        state: { status: 'running' },
        input: input.input ?? [],
        created_at: now,
        updated_at: now,
        custom: custom ?? null,
      };

      const turnRecord: TurnRecord<TTurnCustom> = {
        ...turnInit,
        snapshot: {
          threads: threadsRecordFromMap(agentThreads),
          mcp_servers: previous?.snapshot.mcp_servers ?? null,
          sandbox_info: previous?.snapshot.sandbox_info ?? null,
        },
      };

      await this.store.createTurn({
        turn: turnInit,
        new_threads,
        new_context_appends,
        capability_states: [...agentThreads].map(([thread_id, thread]) => ({
          thread_id,
          capability_state: thread.toSnapshot().capability_state,
        })),
        update_session_title_if_not_exist: input.update_session_title_if_not_exist ?? null,
      });

      const refreshed = await this.store.getSession({
        tenant_id: this.tenant_id,
        session_id: this.session.session_id,
      });
      if (refreshed) {
        this.session = refreshed;
      }

      return new TurnHandle({
        store: this.store,
        turn: turnRecord,
        orchestrator,
        resolver: input.resolver,
        signal: input.signal,
      });
    } catch (error) {
      await input.resolver.close().catch((closeError: unknown) => {
        input.resolver.logger.warn('TurnResourceResolver.close() failed after createTurn() error', {
          err: closeError,
        });
      });
      throw error;
    }
  }

  /**
   * Conditionally cancel a running turn in this session and return the
   * now-immutable record. Already-terminal turns are returned unchanged.
   * Missing turn → {@link TurnNotFoundError}.
   */
  async freezeTurn(input: { turn_id: string; reason: CancellationReason }): Promise<TurnRecord<TTurnCustom>> {
    return this.store.freezeAndGetTurn({
      session_id: this.session.session_id,
      turn_id: input.turn_id,
      reason: input.reason,
      turn_done_event: cancelledTurnDoneEvent(input.reason),
    });
  }

  /** Returns the turn handle (store-backed; not executable), or undefined if not found. */
  async getTurn(turn_id: string): Promise<TurnHandle<TTurnCustom> | undefined> {
    return TurnHandle.get({
      store: this.store,
      session_id: this.session.session_id,
      turn_id,
    });
  }

  /** Paginated list of this session's turn rows (no snapshot). */
  async listTurns(input: {
    limit: number;
    page_token?: string | undefined;
  }): Promise<{ data: TurnRecordWithoutSnapshot<TTurnCustom>[]; pagination: TokenPagination }> {
    return this.store.listTurns({
      session_id: this.session.session_id,
      limit: input.limit,
      page_token: input.page_token,
    });
  }

  /**
   * Paginated session-wide feed of persisted events across turns, including
   * turn.created / turn.done lifecycle events. Reads from the store only —
   * nothing is synthesized on read.
   */
  async listEvents(input: {
    limit: number;
    page_token?: string | undefined;
    last_turn_id?: string | undefined;
  }): Promise<{
    data: SessionEventItem[];
    pagination: TokenPagination;
  }> {
    return this.store.listSessionEvents({
      session_id: this.session.session_id,
      limit: input.limit,
      page_token: input.page_token,
      last_turn_id: input.last_turn_id,
    });
  }

  private async resolveAgentDefinitions(input: {
    previous: TurnRecord<TTurnCustom> | undefined;
    resolver: ITurnResourceResolver<TTurnCustom>;
    spec: AgentSpec;
    tracing: AgentTracing;
    signal: AbortSignal;
  }): Promise<Map<string, ResolvedAgentDefinition>> {
    const snapshots = input.previous?.snapshot.threads;
    const threadIds = threadIdsForCurrentTurn(input.previous?.snapshot);
    const definitionsByThreadId = new Map<string, ResolvedAgentDefinition>();
    await Promise.all(
      threadIds.map(async threadId => {
        const previousThreadSnapshot = snapshots?.[threadId];
        const resolved = await input.resolver.resolveAgentDefinition({
          spec: input.spec,
          agent_info: previousThreadSnapshot?.agent_info ?? undefined,
          previousTurn: input.previous,
          signal: input.signal,
          tracing: input.tracing,
        });
        definitionsByThreadId.set(threadId, resolved);
      }),
    );
    return definitionsByThreadId;
  }

  private buildThreads(input: {
    previous: TurnRecord<TTurnCustom> | undefined;
    resolver: ITurnResourceResolver<TTurnCustom>;
    spec: AgentSpec;
    sandbox: Sandbox | undefined;
    tracing: AgentTracing;
    definitionsByThreadId: ReadonlyMap<string, ResolvedAgentDefinition>;
  }): Map<string, AgentThread> {
    const snapshots = input.previous?.snapshot.threads;
    const map = new Map<string, AgentThread>();
    for (const threadId of threadIdsForCurrentTurn(input.previous?.snapshot)) {
      const resolvedDefinition = input.definitionsByThreadId.get(threadId);
      if (!resolvedDefinition) {
        throw new Error(`Unreachable: missing resolved agent definition for thread '${threadId}'`);
      }
      map.set(
        threadId,
        this.buildThread({
          threadId,
          previousThreadSnapshot: snapshots?.[threadId],
          resolver: input.resolver,
          spec: input.spec,
          sandbox: input.sandbox,
          tracing: input.tracing,
          resolvedDefinition,
        }),
      );
    }
    return map;
  }

  private buildThread(input: {
    threadId: string;
    previousThreadSnapshot?: AgentThreadSnapshot | undefined;
    resolver: ITurnResourceResolver<TTurnCustom>;
    spec: AgentSpec;
    sandbox: Sandbox | undefined;
    tracing: AgentTracing;
    resolvedDefinition: ResolvedAgentDefinition;
  }): AgentThread {
    const { definition, extraCapabilities } = input.resolvedDefinition;
    const isChild = Boolean(input.previousThreadSnapshot?.parent);
    const capabilities = [
      ...builtinsFromSpec({
        spec: input.spec,
        definition,
        isChild,
        sandboxAvailable: Boolean(input.sandbox),
        tracing: input.tracing,
        logger: input.resolver.logger,
      }),
      ...(extraCapabilities ?? []),
    ];
    return new AgentThread({
      definition,
      threadId: input.threadId,
      title: input.previousThreadSnapshot?.agent_info?.name ?? (isChild ? input.threadId : 'main'),
      sandbox: input.sandbox,
      context: input.previousThreadSnapshot?.context,
      currentContextUsage: input.previousThreadSnapshot?.current_context_usage,
      parent: input.previousThreadSnapshot?.parent ?? undefined,
      agentInfo: input.previousThreadSnapshot?.agent_info ?? undefined,
      preComputedCompletion: input.previousThreadSnapshot?.completion ?? undefined,
      capabilities,
      capabilityState: input.previousThreadSnapshot?.capability_state ?? undefined,
      tracing: input.tracing,
      logger: input.resolver.logger,
    });
  }

  private makeCreateDynamicSubAgentThread(input: {
    resolver: ITurnResourceResolver<TTurnCustom>;
    previous: TurnRecord<TTurnCustom> | undefined;
    spec: AgentSpec;
    sandbox: Sandbox | undefined;
    tracing: AgentTracing;
  }): CreateDynamicSubAgentThread {
    return async params => {
      const { definition, extraCapabilities } = await input.resolver.resolveAgentDefinition({
        spec: input.spec,
        agent_info: params.request,
        previousTurn: input.previous,
        signal: params.signal,
        tracing: input.tracing,
      });
      // Model override (request.model) is resolved inside resolveAgentDefinition
      // into modelClient — do not re-label a stale client here.
      const childDefinition: AgentDefinition = {
        ...definition,
        toolSets: params.parentDefinition.toolSets ?? definition.toolSets,
        // The delegated task goes in as the initial user message; the sub-agent
        // system prompt is SUB_AGENT_IDENTITY (added by AgentThread.buildInstruction).
        instruction: undefined,
        messages: [{ role: 'user', content: params.request.input }],
        // Sub-agents should return free-form summaries to the parent, not the user-facing structured response.
        responseFormat: undefined,
      };
      const capabilities = [
        ...builtinsFromSpec({
          spec: input.spec,
          definition: childDefinition,
          isChild: true,
          sandboxAvailable: Boolean(input.sandbox),
          tracing: input.tracing,
          logger: input.resolver.logger,
        }),
        ...(extraCapabilities ?? []),
      ];
      return new AgentThread({
        definition: childDefinition,
        threadId: params.threadId,
        title: params.request.name,
        sandbox: input.sandbox,
        parent: params.parent,
        agentInfo: params.request,
        capabilities,
        tracing: input.tracing,
        logger: input.resolver.logger,
      });
    };
  }
}
