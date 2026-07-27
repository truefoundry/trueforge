/**
 * Bound session handle: starts turns via {@link SessionHandle.createTurn}.
 */
import { ulid } from 'ulid';
import type { AgentDefinition } from '../core/runtime/AgentDefinition';
import { AgentThread } from '../core/runtime/AgentThread';
import type { AgentThreadSendBatch, AgentThreadSnapshot } from '../core/runtime/AgentThread.types';
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
import type { ITurnResourceResolver } from './ITurnResourceResolver';
import type { SessionRecord } from './models/SessionRecord';
import { MAIN_THREAD_ID, type TurnRecord } from './models/TurnRecord';
import type { SessionEventItem } from './schemas/events';
import type { TokenPagination } from './schemas/pagination';
import type { TurnInputItem } from './schemas/turn';
import type { ISessionStore } from './store/ISessionStore';
import { TurnHandle } from './TurnHandle';

/** How many recent ancestors SessionHandle persists on each turn. Store-local. */
const MAX_TURN_ANCESTORS = 20;
function resolvePreviousTurnId(
  requested: string | null | undefined,
  lastTurnId: string | undefined,
): string | undefined {
  if (requested === null) {
    return undefined;
  }
  if (requested === undefined || requested === 'auto') {
    return lastTurnId;
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

function threadsRecordFromMap(threads: Map<string, AgentThread>): Record<string, AgentThreadSnapshot> {
  const out: Record<string, AgentThreadSnapshot> = {};
  for (const [id, thread] of threads) {
    out[id] = thread.toSnapshot();
  }
  return out;
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

  get tenant_name(): string {
    return this.session.tenant_name;
  }

  get agent_spec() {
    return this.session.agent_spec;
  }

  get custom(): TSessionCustom | undefined {
    return this.session.custom;
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
   * `previous_turn_id`: omitted/`'auto'` → session tip; `null` → new root
   * (no parent, even on a non-empty session); string → fork from that turn
   * (must exist). Concurrent `'auto'` forks both succeed.
   */
  async createTurn(input: {
    input?: TurnInputItem[] | undefined;
    /** 'auto'/omitted → session.last_turn_id; null → new root; id → fork from that turn. */
    previous_turn_id?: string | null | undefined;
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
      ? await this.store.getTurn({
          tenant_name: this.tenant_name,
          session_id: this.session.session_id,
          turn_id: previousTurnId,
        })
      : undefined;

    const custom = typeof input.custom === 'function' ? input.custom(previous?.custom) : input.custom;

    const spec = this.session.agent_spec;
    // Dispose-on-early-failure: any resource acquired below (sandbox handle,
    // MCP connections) is owned by createTurn() until the TurnHandle is returned; from then
    // on TurnHandle.stream()'s finally owns resolver.close(). On any throw in this
    // acquisition phase we close the resolver (best-effort, error swallowed)
    // and rethrow — same pattern as the gateway's sessionTurnHandler, which
    // wraps getAgent/handler.init and calls gatewayStore.dispose() on failure.
    try {
      const tracing = input.resolver.createTracing();
      const sandbox = await input.resolver.resolveSandbox({
        spec,
        existing: previous?.snapshot.sandbox_info,
        previousTurn: previous,
        signal: input.signal,
        tracing,
      });

      const agentThreads = await this.buildThreads({
        previous,
        resolver: input.resolver,
        sandbox,
        tracing,
        signal: input.signal,
      });

      const createDynamicSubAgentThread = this.makeCreateDynamicSubAgentThread({
        resolver: input.resolver,
        previous,
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
      for await (const event of orchestrator.send(sendBatch)) {
        void event; // drain only
      }

      const turnId = ulid().toLowerCase();
      const now = new Date().toISOString();
      const turnRecord: TurnRecord<TTurnCustom> = {
        turn_id: turnId,
        session_id: this.session.session_id,
        first_turn_id: previous?.first_turn_id ?? turnId,
        // Truncate to a recent window; stores spill if they need older ancestors.
        ancestor_ids: previous ? [...previous.ancestor_ids, previous.turn_id].slice(-MAX_TURN_ANCESTORS) : [],
        previous_turn_id: previousTurnId,
        state: { status: 'running' },
        input: input.input ?? [],
        snapshot: {
          threads: threadsRecordFromMap(agentThreads),
          mcp_servers: previous?.snapshot.mcp_servers,
          sandbox_info: previous?.snapshot.sandbox_info,
        },
        created_at: now,
        updated_at: now,
        custom,
      };

      await this.store.createTurn({
        tenant_name: this.tenant_name,
        turn: turnRecord,
        update_session_title_if_not_exist: input.update_session_title_if_not_exist,
      });

      const refreshed = await this.store.getSession({
        tenant_name: this.tenant_name,
        session_id: this.session.session_id,
      });
      if (refreshed) {
        this.session = refreshed;
      }

      return new TurnHandle({
        store: this.store,
        tenantName: this.tenant_name,
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

  /** Returns the turn handle (store-backed; not executable), or undefined if not found. */
  async getTurn(turn_id: string): Promise<TurnHandle<TTurnCustom> | undefined> {
    const turn = await this.store.getTurn({
      tenant_name: this.tenant_name,
      session_id: this.session.session_id,
      turn_id,
    });
    if (!turn) {
      return undefined;
    }
    return TurnHandle.fromRecord({
      store: this.store,
      tenantName: this.tenant_name,
      turn,
    });
  }

  /** Paginated list of this session's turn records. */
  async listTurns(input: {
    limit: number;
    page_token?: string | undefined;
  }): Promise<{ data: TurnRecord<TTurnCustom>[]; pagination: TokenPagination }> {
    return this.store.listTurns({
      tenant_name: this.tenant_name,
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
      tenant_name: this.tenant_name,
      session_id: this.session.session_id,
      limit: input.limit,
      page_token: input.page_token,
      last_turn_id: input.last_turn_id,
    });
  }

  private async buildThreads(input: {
    previous: TurnRecord<TTurnCustom> | undefined;
    resolver: ITurnResourceResolver<TTurnCustom>;
    sandbox: Sandbox | undefined;
    tracing: AgentTracing;
    signal: AbortSignal;
  }): Promise<Map<string, AgentThread>> {
    const snapshots = input.previous?.snapshot.threads;
    const threadIds = snapshots ? Object.keys(snapshots) : [MAIN_THREAD_ID];
    const map = new Map<string, AgentThread>();
    for (const threadId of threadIds) {
      const data = snapshots?.[threadId];
      map.set(
        threadId,
        await this.buildThread({
          threadId,
          data,
          resolver: input.resolver,
          previous: input.previous,
          sandbox: input.sandbox,
          tracing: input.tracing,
          signal: input.signal,
        }),
      );
    }
    return map;
  }

  private async buildThread(input: {
    threadId: string;
    data?: AgentThreadSnapshot | undefined;
    resolver: ITurnResourceResolver<TTurnCustom>;
    previous: TurnRecord<TTurnCustom> | undefined;
    sandbox: Sandbox | undefined;
    tracing: AgentTracing;
    signal: AbortSignal;
  }): Promise<AgentThread> {
    const { definition, extraCapabilities } = await input.resolver.resolveAgentDefinition({
      spec: this.session.agent_spec,
      thread_id: input.threadId,
      agent_info: input.data?.agent_info,
      previousTurn: input.previous,
      signal: input.signal,
      tracing: input.tracing,
    });
    const isChild = Boolean(input.data?.parent);
    const capabilities = [
      ...builtinsFromSpec({
        spec: this.session.agent_spec,
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
      title: input.data?.agent_info?.name ?? (isChild ? input.threadId : 'main'),
      sandbox: input.sandbox,
      context: input.data?.context,
      currentContextUsage: input.data?.current_context_usage,
      parent: input.data?.parent,
      agentInfo: input.data?.agent_info,
      preComputedCompletion: input.data?.completion,
      capabilities,
      capabilityState: input.data?.capability_state,
      tracing: input.tracing,
      logger: input.resolver.logger,
    });
  }

  private makeCreateDynamicSubAgentThread(input: {
    resolver: ITurnResourceResolver<TTurnCustom>;
    previous: TurnRecord<TTurnCustom> | undefined;
    sandbox: Sandbox | undefined;
    tracing: AgentTracing;
  }): CreateDynamicSubAgentThread {
    return async params => {
      const { definition, extraCapabilities } = await input.resolver.resolveAgentDefinition({
        spec: this.session.agent_spec,
        thread_id: params.threadId,
        agent_info: params.request,
        previousTurn: input.previous,
        signal: params.signal,
        tracing: input.tracing,
      });
      const childDefinition: AgentDefinition = {
        ...definition,
        toolSets: params.parentDefinition.toolSets ?? definition.toolSets,
        ...(params.request.model !== undefined
          ? {
              model: params.request.model,
              modelClient: definition.modelClient,
            }
          : {}),
        // The delegated task goes in as the initial user message; the sub-agent
        // system prompt is SUB_AGENT_IDENTITY (added by AgentThread.buildInstruction).
        instruction: undefined,
        messages: [{ role: 'user', content: params.request.input }],
        // Sub-agents should return free-form summaries to the parent, not the user-facing structured response.
        responseFormat: undefined,
      };
      const capabilities = [
        ...builtinsFromSpec({
          spec: this.session.agent_spec,
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
