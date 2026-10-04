/**
 * Durable turn handle. {@link TurnHandle.stream} is execute-once (persist-before-yield).
 */
import { AgentHarnessError } from '../core/errors';
import type {
  MCPAuthRequiredEvent,
  ModelMessageDeltaEvent,
  ThreadDoneEvent,
  TurnUserEvent,
} from '../core/events/schema';
import { EventType as HarnessEventType, newEventId } from '../core/events/schema';
import {
  InternalEventType,
  type AgentThreadExecutionEvent,
  type AgentThreadExecutionResult,
  type InternalMCPAuthRequiredEvent,
  type InternalThreadDoneEvent,
  type InternalTurnStateEvent,
} from '../core/runtime/AgentThread.types';
import type { AgentThreadOrchestrator } from '../core/runtime/AgentThreadOrchestrator';
import { getEmptyCurrentContextUsage } from '../core/runtime/contextUsage';
import { isInternalThreadDoneCancelled } from '../core/runtime/contextUtils';
import type { AgentThreadMetrics } from '../core/runtime/metrics';
import type { ITurnResourceResolver } from './ITurnResourceResolver';
import type { TurnRecord } from './models/TurnRecord';
import {
  EventType,
  type PersistedTurnEvent,
  type TurnCreatedEvent,
  type TurnDoneEvent,
  type TurnUpdateEvent,
} from './schemas/events';
import type { TokenPagination } from './schemas/pagination';
import {
  CancellationReason,
  type NonTerminalTurnState,
  type TerminalTurnState,
  type TurnInputItem,
  type TurnMetrics,
  type TurnState,
} from './schemas/turn';
import type { ISessionStore } from './store/ISessionStore';
import { TurnNotRunningError } from './store/SessionStoreErrors';

/** Streaming yield union — deltas pass through; never persisted. No sequence_number. */
export type TurnStreamingEvent = PersistedTurnEvent | ModelMessageDeltaEvent;

function cancellationReasonFromAbortReason(abortReason: unknown): CancellationReason {
  if (abortReason === CancellationReason.ServerExecutionTimeout) {
    return CancellationReason.ServerExecutionTimeout;
  }
  if (abortReason === CancellationReason.CancelledForNextTurn) {
    return CancellationReason.CancelledForNextTurn;
  }
  if (abortReason === CancellationReason.Abandoned) {
    return CancellationReason.Abandoned;
  }
  return CancellationReason.ClientCancelled;
}

function toThreadDoneEvent(event: InternalThreadDoneEvent): ThreadDoneEvent {
  if (isInternalThreadDoneCancelled(event)) {
    // Public thread.done is done|error only. Cancelled children are dropped, not shown.
    throw new Error('unreachable: cancelled AGENT_DONE cannot be converted to thread.done');
  }
  const state =
    event.status === 'error'
      ? { status: 'error' as const, error: event.error, ...(event.output && { output: event.output }) }
      : { status: 'done' as const, output: event.output };
  return {
    type: HarnessEventType.THREAD_DONE,
    id: newEventId(),
    created_at: new Date().toISOString(),
    parent: event.parent,
    thread_id: event.thread_id,
    title: event.title,
    state,
  };
}

function toMCPAuthRequiredEvent(event: InternalMCPAuthRequiredEvent): MCPAuthRequiredEvent {
  return {
    type: HarnessEventType.MCP_AUTH_REQUIRED,
    id: event.id,
    created_at: event.created_at,
    thread_id: event.thread_id,
    mcp_servers: event.mcp_servers.map(({ thread_ids, ...server }) => {
      void thread_ids;
      return server;
    }),
  };
}

function turnMetricsFromAgentThreadMetrics(metrics: AgentThreadMetrics): TurnMetrics {
  return {
    total_input_tokens: metrics.total_input_tokens,
    total_output_tokens: metrics.total_output_tokens,
    total_tokens: metrics.total_tokens,
    total_cache_read_tokens: metrics.total_cache_read_tokens,
    total_cache_write_tokens: metrics.total_cache_write_tokens,
    total_reasoning_tokens: metrics.total_reasoning_tokens,
    total_cost_in_usd: metrics.total_cost_in_usd,
  };
}

/** Result used to close out the executor generator on any early exit (abort / abandon / throw). */
const EMPTY_EXECUTION_RESULT: AgentThreadExecutionResult = {
  status: 'done',
  output: null,
};

function turnDoneEvent(state: TerminalTurnState, createdAtIso: string): TurnDoneEvent {
  return {
    type: EventType.TURN_DONE,
    id: newEventId(),
    created_at: createdAtIso,
    state,
    thread_id: null,
  };
}

/** Map the way a turn ended (abort / error / abandon / executor result) to a terminal state. */
function resolveTerminalState(input: {
  signal: AbortSignal;
  caughtError: Error | undefined;
  executeResult: AgentThreadExecutionResult | undefined;
  metrics: TurnMetrics;
  completed_at: string;
}): TerminalTurnState {
  const { signal, caughtError, executeResult, metrics, completed_at } = input;
  if (signal.aborted) {
    return {
      status: 'cancelled',
      reason: cancellationReasonFromAbortReason(signal.reason),
      completed_at,
      metrics,
    };
  }
  if (caughtError) {
    return { status: 'error', message: caughtError.message, completed_at, metrics };
  }
  if (executeResult === undefined) {
    // Consumer abandoned the stream before the executor returned a terminal result.
    return { status: 'cancelled', reason: CancellationReason.ClientCancelled, completed_at, metrics };
  }
  if (executeResult.root_agent_error) {
    return { status: 'error', message: executeResult.root_agent_error.error, completed_at, metrics };
  }
  return {
    status: 'done',
    output: executeResult.output,
    required_actions: [],
    completed_at,
    metrics,
  };
}

export class TurnHandle<TTurnCustom extends object = Record<string, never>> {
  private readonly store: ISessionStore<object, TTurnCustom>;
  private turn: TurnRecord<TTurnCustom>;
  private readonly orchestrator: AgentThreadOrchestrator | undefined;
  private readonly resolver: ITurnResourceResolver<TTurnCustom> | undefined;
  private readonly signal: AbortSignal | undefined;
  private streamStarted = false;

  constructor(options: {
    store: ISessionStore<object, TTurnCustom>;
    turn: TurnRecord<TTurnCustom>;
    orchestrator?: AgentThreadOrchestrator | undefined;
    resolver?: ITurnResourceResolver<TTurnCustom> | undefined;
    signal?: AbortSignal | undefined;
  }) {
    this.store = options.store;
    this.turn = options.turn;
    this.orchestrator = options.orchestrator;
    this.resolver = options.resolver;
    this.signal = options.signal;
  }

  /** Store-only handle (e.g. from {@link SessionHandle.getTurn}) — stream() is not available. */
  static fromRecord<TCustom extends object = Record<string, never>>(options: {
    store: ISessionStore<object, TCustom>;
    turn: TurnRecord<TCustom>;
  }): TurnHandle<TCustom> {
    return new TurnHandle(options);
  }

  static async get<TCustom extends object = Record<string, never>>(options: {
    store: ISessionStore<object, TCustom>;
    session_id: string;
    turn_id: string;
  }): Promise<TurnHandle<TCustom> | undefined> {
    const turn = await options.store.getTurn({
      session_id: options.session_id,
      turn_id: options.turn_id,
    });
    if (!turn) {
      return undefined;
    }
    return TurnHandle.fromRecord({
      store: options.store,
      turn,
    });
  }

  get id(): string {
    return this.turn.turn_id;
  }

  get session_id(): string {
    return this.turn.session_id;
  }

  get previous_turn_id(): string | null {
    return this.turn.previous_turn_id;
  }

  get input(): TurnInputItem[] {
    return this.turn.input;
  }

  get state(): TurnState {
    return this.turn.state;
  }

  get created_at(): Date {
    return this.turn.created_at;
  }

  get custom(): TTurnCustom | null {
    return this.turn.custom;
  }

  get record(): TurnRecord<TTurnCustom> {
    return this.turn;
  }

  /**
   * Resume a live, paused turn with a mid-turn inbound event batch (approval decisions, tool
   * responses, approval policies — any mix). The batch is forwarded untouched to the orchestrator,
   * which routes each kind internally, then wakes the parked executor so {@link stream} emits the
   * resulting events and the turn continues.
   */
  send(events: TurnUserEvent[]): void {
    const orchestrator = this.requireLiveOrchestrator('send');
    for (const batch of orchestrator.send(events)) {
      // TODO: persist `batch` here — under the per-turn transition lock — before resuming
      // the generator to enqueue. Deferred for now; we drain the
      // generator without a durable write so the in-memory flow can be exercised end to end.
      void batch;
    }
    orchestrator.notifyWake();
  }

  private requireLiveOrchestrator(method: string): AgentThreadOrchestrator {
    if (!this.orchestrator) {
      throw new Error(`TurnHandle.${method}() is only available on a live turn from SessionHandle.createTurn()`);
    }
    return this.orchestrator;
  }

  /**
   * Executes the turn. Single consumer, callable ONCE — a second call throws:
   * this generator IS the execution (persist-before-yield). Execute-only: the
   * input was already sent and validated in run(); nothing is sent here.
   * Sole terminal writer — done/cancelled/error is written to the store from
   * inside this generator; honors the AbortSignal passed to run(). On every
   * exit path the resolver is closed best-effort in a finally, after the
   * terminal write.
   *
   * Two consumption patterns (both caller-side; this method is identical for both):
   *
   *   // STREAMING — pipe events out as they happen (e.g. SSE):
   *   for await (const e of turn.stream()) yield sse(e);
   *
   *   // NON-STREAMING — drain in background, respond immediately with the
   *   // running turn. The caller owns the active-turn registry, the .catch
   *   // (store-write failures reject the drain; agent errors do NOT — they
   *   // become terminal 'error' events inside), and graceful shutdown.
   *   const drain = (async () => { for await (const _ of turn.stream()); })()
   *     .catch(err => logger.error('turn drain failed', err));
   *   activeTurns.set(turn.id, { controller, drain });
   *   drain.finally(() => activeTurns.delete(turn.id));
   *   return turnCreatedResponse(turn);
   *
   * Yields the delta-inclusive streaming union: deltas pass through to the
   * consumer but are NEVER persisted. Events carry no sequence_number; yield
   * order ≡ persist order (single sequential generator), so callers that need
   * numbering (e.g. SSE resume) stamp it at their own transport boundary.
   */
  async *stream(): AsyncGenerator<TurnStreamingEvent> {
    if (this.streamStarted) {
      throw new Error('TurnHandle.stream() is single-use and was already called');
    }
    this.streamStarted = true;

    const orchestrator = this.orchestrator;
    const resolver = this.resolver;
    const signal = this.signal;
    if (!orchestrator || !resolver || !signal) {
      throw new Error('TurnHandle.stream() is only available on turns returned from SessionHandle.createTurn()');
    }

    let caughtError: Error | undefined;
    let executeResult: AgentThreadExecutionResult | undefined;

    try {
      yield await this.persistTurnCreated();
      executeResult = yield* this.executeAndPersist(orchestrator, signal);
    } catch (error) {
      caughtError = error instanceof Error ? error : new Error(String(error));
    } finally {
      // Sole terminal writer. A concurrent freeze (TurnNotRunningError) — whether it surfaced
      // mid-drain (as caughtError) or on our own terminal write — makes the store's state
      // authoritative, so we emit a turn.done built from that state instead of writing our own.
      let turnDone: TurnDoneEvent;
      try {
        turnDone =
          this.eventFromStoreConflict(caughtError, orchestrator) ??
          (await this.persistTurnTerminal({ signal, caughtError, executeResult, orchestrator }));
      } catch (error) {
        const storeDone = this.eventFromStoreConflict(error, orchestrator);
        if (!storeDone) {
          await this.closeResolver(resolver);
          // eslint-disable-next-line no-unsafe-finally -- terminal-state write failed; reject the stream
          throw error;
        }
        turnDone = storeDone;
      }
      await this.closeResolver(resolver);
      yield turnDone;
    }
  }

  private async persistTurnCreated(): Promise<TurnCreatedEvent> {
    const turnCreated: TurnCreatedEvent = {
      type: EventType.TURN_CREATED,
      id: newEventId(),
      turn_id: this.turn.turn_id,
      previous_turn_id: this.turn.previous_turn_id,
      ...(this.turn.input.length > 0 ? { input: this.turn.input } : {}),
      state: { status: 'running' },
      created_at: this.turn.created_at.toISOString(),
      thread_id: null,
    };
    await this.store.appendToEvents({
      session_id: this.turn.session_id,
      turn_id: this.turn.turn_id,
      events: [turnCreated],
    });
    return turnCreated;
  }

  /**
   * Drain the executor, persisting each event (plus turn-state pause/resume transitions) and
   * yielding anything the consumer should see; returns the terminal execution result. The
   * executor parks internally while paused, so a paused turn simply blocks on `generator.next()`
   * here until it is woken (new input) or the signal aborts.
   */
  private async *executeAndPersist(
    orchestrator: AgentThreadOrchestrator,
    signal: AbortSignal,
  ): AsyncGenerator<TurnStreamingEvent, AgentThreadExecutionResult> {
    const generator = orchestrator.execute({ signal });
    try {
      let iterResult = await generator.next();
      while (!iterResult.done) {
        const event = iterResult.value;
        const yielded =
          event.type === InternalEventType.TURN_STATE
            ? await this.persistTurnNonTerminal(event.transition)
            : await this.persistExecutionEvent(event);
        if (Array.isArray(yielded)) {
          for (const e of yielded) {
            yield e;
          }
        } else if (yielded) {
          yield yielded;
        }
        iterResult = await generator.next();
      }
      return iterResult.value;
    } finally {
      await generator.return(EMPTY_EXECUTION_RESULT);
    }
  }

  private async persistTurnTerminal(input: {
    signal: AbortSignal;
    caughtError: Error | undefined;
    executeResult: AgentThreadExecutionResult | undefined;
    orchestrator: AgentThreadOrchestrator;
  }): Promise<TurnDoneEvent> {
    const updatedAt = new Date();
    const createdAtIso = updatedAt.toISOString();
    const metrics = turnMetricsFromAgentThreadMetrics(input.orchestrator.getMetrics());
    const terminalState = resolveTerminalState({
      signal: input.signal,
      caughtError: input.caughtError,
      executeResult: input.executeResult,
      metrics,
      completed_at: createdAtIso,
    });
    const turnDone = turnDoneEvent(terminalState, createdAtIso);
    await this.store.updateTurnTerminalState({
      session_id: this.turn.session_id,
      turn_id: this.turn.turn_id,
      state: terminalState,
      turn_done_event: turnDone,
    });
    this.turn = { ...this.turn, state: terminalState, updated_at: updatedAt };
    return turnDone;
  }

  /** A TurnNotRunningError means another writer already terminated the turn — defer to its state. */
  private eventFromStoreConflict(error: unknown, orchestrator: AgentThreadOrchestrator): TurnDoneEvent | undefined {
    return error instanceof TurnNotRunningError ? this.turnDoneFromStoreConflict(error, orchestrator) : undefined;
  }

  private turnDoneFromStoreConflict(
    error: TurnNotRunningError,
    orchestrator: AgentThreadOrchestrator,
    updatedAt: Date = new Date(),
  ): TurnDoneEvent {
    const state: TerminalTurnState = {
      ...error.state,
      metrics: turnMetricsFromAgentThreadMetrics(orchestrator.getMetrics()),
    };
    this.turn = { ...this.turn, state, updated_at: updatedAt };
    return turnDoneEvent(state, updatedAt.toISOString());
  }

  private async closeResolver(resolver: ITurnResourceResolver<TTurnCustom>): Promise<void> {
    await resolver.close().catch((err: unknown) => {
      resolver.logger.warn('TurnResourceResolver.close() failed', { err });
    });
  }

  /** Paginated read of this turn's persisted events. */
  async listEvents(input: {
    limit: number;
    page_token?: string | undefined;
    order?: 'asc' | 'desc' | undefined;
  }): Promise<{
    data: PersistedTurnEvent[];
    pagination: TokenPagination;
  }> {
    return this.store.listTurnEvents({
      session_id: this.turn.session_id,
      turn_id: this.turn.turn_id,
      limit: input.limit,
      page_token: input.page_token,
      order: input.order,
    });
  }

  /**
   * Persist a non-terminal turn-state transition (paused ↔ running) emitted by the
   * executor loop as it parks/resumes. Writes a `turn.update` event + the live state,
   * updates the in-memory turn, and returns the event to stream to the consumer.
   */
  private async persistTurnNonTerminal(
    transition: InternalTurnStateEvent['transition'],
  ): Promise<TurnUpdateEvent | null> {
    const state: NonTerminalTurnState =
      transition.status === 'paused'
        ? {
            status: 'paused',
            // No aggregate for now; per-event action requests are persisted on the stream.
            action_required_on_events: [],
          }
        : { status: 'running' };
    const updatedAt = new Date();
    const turnUpdate: TurnUpdateEvent = {
      type: EventType.TURN_UPDATE,
      id: newEventId(),
      state,
      created_at: updatedAt.toISOString(),
      thread_id: null,
    };
    await this.store.updateTurnNonTerminalState({
      session_id: this.turn.session_id,
      turn_id: this.turn.turn_id,
      state,
      turn_update_event: turnUpdate,
    });
    this.turn = { ...this.turn, state, updated_at: updatedAt };
    return turnUpdate;
  }

  /**
   * Persist side effects for one execution event; return a streaming yield when
   * the event should be emitted to the consumer (null = side-effect only / skip).
   */
  private async persistExecutionEvent(
    event: Exclude<AgentThreadExecutionEvent, InternalTurnStateEvent>,
  ): Promise<TurnStreamingEvent | TurnStreamingEvent[] | null> {
    const scope = {
      session_id: this.turn.session_id,
      turn_id: this.turn.turn_id,
    };

    switch (event.type) {
      case HarnessEventType.MODEL_MESSAGE:
      case HarnessEventType.MODEL_MESSAGE_DELTA:
        // Stream only — durable model content lands via AGENT_CONTEXT_APPEND.output.
        return event;

      case HarnessEventType.TOOL_RESPONSE:
        await this.store.appendToEvents({
          ...scope,
          events: [event],
        });
        return event;

      case InternalEventType.AGENT_CREATE_SUBAGENT:
        return null;

      case InternalEventType.CAPABILITY_STATE: {
        // Persist boundary: types exclude undefined; reject it at runtime so stores never see it.
        const state: unknown = event.state;
        if (state === undefined) {
          throw new AgentHarnessError(
            'capability_state_error',
            `CAPABILITY_STATE for key '${event.key}' must not be undefined — use null to clear durable state`,
          );
        }
        await this.store.patchThreadCapabilityState({
          ...scope,
          thread_id: event.thread_id,
          key: event.key,
          state: event.state,
        });
        return null;
      }

      case HarnessEventType.AGENT_CONTEXT_OVERWRITE: {
        await this.store.overwriteThreadContext({ ...scope, event });
        return null;
      }

      case InternalEventType.AGENT_CONTEXT_APPEND: {
        await this.store.appendToThreadContext({
          ...scope,
          thread_id: event.thread_id,
          context: event.context,
          current_context_usage: event.current_context_usage ?? null,
          completion: event.completion ?? null,
        });
        if (event.output.length > 0) {
          await this.store.appendToEvents({
            ...scope,
            events: event.output,
          });
        }
        return null;
      }

      case InternalEventType.USER_EVENTS_COMMIT: {
        // One applied batch of user events. Each write fires only if its array is non-empty. These
        // run sequentially today; once a DB store lands they collapse into one transaction (and the
        // consumed_event_ids drive a mark-consumed write against the durable inbound inbox).
        for (const append of event.context_appends) {
          await this.store.appendToThreadContext({
            ...scope,
            thread_id: append.thread_id,
            context: append.context,
            current_context_usage: append.current_context_usage ?? null,
            completion: append.completion ?? null,
          });
          if (append.output.length > 0) {
            await this.store.appendToEvents({ ...scope, events: append.output });
          }
        }
        for (const overwrite of event.context_overwrites) {
          await this.store.overwriteThreadContext({ ...scope, event: overwrite });
        }
        if (event.mcp_patch.length > 0) {
          await this.store.patchMCPServers({ ...scope, mcp_servers: event.mcp_patch });
        }
        if (event.applied_user_events.length > 0) {
          await this.store.appendToEvents({ ...scope, events: event.applied_user_events });
        }
        // TODO(durable-inbox): mark event.consumed_event_ids consumed once the DB store + inbound
        // inbox land; today inbound events are not persisted at send, so there is nothing to mark.
        return event.applied_user_events;
      }

      case InternalEventType.AGENT_DONE: {
        if (event.parent) {
          await this.store.removeThreads({
            ...scope,
            thread_ids: [event.thread_id],
          });
        }
        if (isInternalThreadDoneCancelled(event)) {
          // Do not send thread.done to the user for a cancelled child.
          return null;
        }
        if (!event.parent) {
          return null;
        }
        const threadDone = toThreadDoneEvent(event);
        await this.store.appendToEvents({
          ...scope,
          events: [threadDone],
        });
        return threadDone;
      }

      case HarnessEventType.THREAD_CREATED: {
        await this.store.addThreads({
          ...scope,
          threads: [
            {
              thread_id: event.thread_id,
              parent: event.parent,
              agent_info: event.agent_info,
              context: [],
              current_context_usage: getEmptyCurrentContextUsage(),
              completion: null,
              capability_state: null,
            },
          ],
        });
        await this.store.appendToEvents({
          ...scope,
          events: [event],
        });
        return event;
      }

      case InternalEventType.MCP_AUTH_REQUIRED: {
        const authEvent = toMCPAuthRequiredEvent(event);
        await this.store.appendToEvents({
          ...scope,
          events: [authEvent],
        });
        return authEvent;
      }

      case HarnessEventType.MCP_INITIALIZE: {
        await this.store.patchMCPServers({
          ...scope,
          mcp_servers: event.mcp_servers.map(initInfo => ({
            id: initInfo.id,
            name: initInfo.name,
            session_id: initInfo.session_id,
            transport_type: initInfo.transport_type,
            approval_policies: initInfo.approval_policies,
          })),
        });
        await this.store.appendToEvents({
          ...scope,
          events: [event],
        });
        return event;
      }

      case HarnessEventType.SANDBOX_CREATED: {
        await this.store.patchSandboxInfo({
          ...scope,
          sandbox_info: { sandbox_id: event.sandbox_id },
        });
        await this.store.appendToEvents({
          ...scope,
          events: [event],
        });
        return event;
      }

      case HarnessEventType.TOOL_APPROVAL_REQUIRED:
      case HarnessEventType.TOOL_RESPONSE_REQUIRED: {
        await this.store.appendToEvents({
          ...scope,
          events: [event],
        });
        return event;
      }

      default: {
        // Registered passthrough (orchestrator unwraps PASSTHROUGH before yield).
        await this.store.appendToEvents({
          ...scope,
          events: [event],
        });
        return event;
      }
    }
  }
}
