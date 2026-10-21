/**
 * Durable turn handle. {@link TurnHandle.stream} is execute-once (persist-before-yield).
 */
import { AgentHarnessError, InvalidAgentSendInputError } from '../core/errors';
import type {
  MCPAuthRequiredEvent,
  MCPServerInitInfo,
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
import { waitUntilAborted } from '../core/util/abort';
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
  type LegacyTurnInputItem,
  type NonTerminalTurnState,
  type TerminalTurnState,
  type TurnMetrics,
  type TurnState,
} from './schemas/turn';
import type { ISessionStore } from './store/ISessionStore';
import { TurnNotRunningError, TurnOwnershipLostError } from './store/SessionStoreErrors';

/** Streaming yield union — deltas pass through; never persisted. No sequence_number. */
export type TurnStreamingEvent = PersistedTurnEvent | ModelMessageDeltaEvent;

/**
 * Abort reason for keepalive offload and for dropping a stale local handle.
 * The generator stops and the resolver closes. The turn row is left as it is.
 */
export const TurnOffloadReason = 'turn-offload';

export function isTurnOffloadReason(reason: unknown): boolean {
  return reason === TurnOffloadReason;
}

function abortOnReturn<T>(generator: AsyncGenerator<T>, abortController: AbortController): AsyncGenerator<T> {
  const returnGenerator = generator.return.bind(generator);
  generator.return = value => {
    if (!abortController.signal.aborted) {
      abortController.abort(CancellationReason.ClientCancelled);
    }
    return returnGenerator(value);
  };
  return generator;
}

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
    thread_id: null, // We are not sending thread on the wire event.
    mcp_servers: event.mcp_servers,
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

/** A live turn is running or paused. Terminal rows are not executed. */
function executableTurnStatus(state: TurnState): NonTerminalTurnState['status'] {
  if (state.status === 'running' || state.status === 'paused') {
    return state.status;
  }
  throw new Error(`Cannot execute a ${state.status} turn`);
}

export class TurnHandle<TTurnCustom extends object = Record<string, never>> {
  private readonly store: ISessionStore<object, TTurnCustom>;
  private turn: TurnRecord<TTurnCustom>;
  private readonly orchestrator: AgentThreadOrchestrator;
  private readonly resolver: ITurnResourceResolver<TTurnCustom>;
  private readonly abortController: AbortController;
  private streamStarted = false;

  constructor(options: {
    store: ISessionStore<object, TTurnCustom>;
    turn: TurnRecord<TTurnCustom>;
    orchestrator: AgentThreadOrchestrator;
    resolver: ITurnResourceResolver<TTurnCustom>;
    abortController: AbortController;
  }) {
    this.store = options.store;
    this.turn = options.turn;
    this.orchestrator = options.orchestrator;
    this.resolver = options.resolver;
    this.abortController = options.abortController;
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

  get input(): LegacyTurnInputItem[] {
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

  async *send(events: TurnUserEvent[]): AsyncGenerator<TurnUserEvent[], void> {
    yield* this.orchestrator.send(events);
    this.orchestrator.wake();
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
  stream(): AsyncGenerator<TurnStreamingEvent> {
    if (this.streamStarted) {
      throw new Error('TurnHandle.stream() is single-use and was already called');
    }
    this.streamStarted = true;
    const signal = this.abortController.signal;

    // A consumer can leave early (break, or iterator.return()) while execute is parked
    // on wakeSignal.wait() at a pause. return() does not cancel that await, so the
    // generator cannot finish, and the terminal write and resolver close never run.
    // Aborting first is what wakes the wait: execute listens for abort and notifies
    // the latch. The loop then sees the signal and returns. A turn that finishes on
    // its own does not call return(), so it is not aborted. An abort that already
    // happened (shutdown, timeout, barge-in) keeps its reason.
    return abortOnReturn(this.streamExecution(this.orchestrator, this.resolver, signal), this.abortController);
  }

  private async *streamExecution(
    orchestrator: AgentThreadOrchestrator,
    resolver: ITurnResourceResolver<TTurnCustom>,
    signal: AbortSignal,
  ): AsyncGenerator<TurnStreamingEvent> {
    let caughtError: Error | undefined;
    let executeResult: AgentThreadExecutionResult | undefined;
    let ownershipLost: TurnOwnershipLostError | undefined;
    const turnStatus = executableTurnStatus(this.turn.state);
    try {
      if (turnStatus === 'running') {
        yield await this.persistTurnCreated();
      }
      executeResult = yield* this.executeAndPersist(orchestrator, signal, turnStatus);
    } catch (error) {
      caughtError = error instanceof Error ? error : new Error(String(error));
      if (caughtError instanceof TurnOwnershipLostError) {
        // executeAndPersist already waited for abort. Skip the terminal write.
        // The row belongs to the other replica.
        ownershipLost = caughtError;
      }
    } finally {
      // Terminal write stays in finally so a consumer break still closes the turn.
      let turnDone: TurnDoneEvent | undefined;
      // Offload ends the in-memory run only. A terminal write would cancel a turn that is still paused.
      if (!ownershipLost && !isTurnOffloadReason(signal.reason)) {
        try {
          // TurnNotRunningError: another writer already terminated the turn — defer to its state.
          if (caughtError instanceof TurnNotRunningError) {
            turnDone = this.turnDoneFromStoreConflict(caughtError, orchestrator);
          } else {
            turnDone = await this.persistTurnTerminal({
              signal,
              caughtError,
              executeResult,
              orchestrator,
            });
          }
        } catch (error) {
          if (error instanceof TurnOwnershipLostError) {
            ownershipLost = error;
          } else if (error instanceof TurnNotRunningError) {
            turnDone = this.turnDoneFromStoreConflict(error, orchestrator);
          } else {
            await this.closeResolver(resolver);
            // eslint-disable-next-line no-unsafe-finally -- terminal-state write failed; reject the stream
            throw error;
          }
        }
      }
      await this.closeResolver(resolver);
      if (turnDone) {
        yield turnDone;
      }
    }
    if (ownershipLost) {
      throw ownershipLost;
    }
  }

  /**
   * Queue inbox rows onto the orchestrator before execute starts.
   * A row the paused snapshot already applied fails validation; skip it so a
   * crash between persist and consume does not apply the same decision twice.
   */
  async replayUnconsumedInbox(): Promise<void> {
    const rows = await this.store.listUnconsumedTurnInboundEvents({
      session_id: this.turn.session_id,
      turn_id: this.turn.turn_id,
    });
    for (const event of rows) {
      try {
        for await (const batch of this.orchestrator.send([event])) {
          void batch;
        }
      } catch (error) {
        if (error instanceof InvalidAgentSendInputError) {
          continue;
        }
        throw error;
      }
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
      active_executor_id: this.turn.active_executor_id,
      events: [turnCreated],
    });
    return turnCreated;
  }

  private async *executeAndPersist(
    orchestrator: AgentThreadOrchestrator,
    signal: AbortSignal,
    turnStatus: NonTerminalTurnState['status'],
  ): AsyncGenerator<TurnStreamingEvent, AgentThreadExecutionResult> {
    const generator = orchestrator.execute({ signal, turnStatus });
    try {
      let iterResult = await generator.next();
      while (!iterResult.done) {
        const event = iterResult.value;
        if (event.type === InternalEventType.TURN_STATE) {
          const turnUpdate = await this.persistTurnNonTerminal(event.transition);
          if (turnUpdate) {
            yield turnUpdate;
          }
        } else {
          yield* this.persistExecutionEvent(event);
        }
        iterResult = await generator.next();
      }
      return iterResult.value;
    } catch (error) {
      if (error instanceof TurnOwnershipLostError) {
        // The write lost the owner check. Leave this generator suspended.
        // Offload, or a later event on this replica, aborts the handle.
        // return() before that would unwind the loop and drop it from memory.
        await waitUntilAborted(signal);
      }
      throw error;
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
      active_executor_id: this.turn.active_executor_id,
      state: terminalState,
      turn_done_event: turnDone,
    });
    this.turn = { ...this.turn, state: terminalState, updated_at: updatedAt };
    return turnDone;
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

  private async persistTurnNonTerminal(
    transition: InternalTurnStateEvent['transition'],
  ): Promise<TurnUpdateEvent | null> {
    const state: NonTerminalTurnState = transition.status === 'paused' ? { status: 'paused' } : { status: 'running' };
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
      active_executor_id: this.turn.active_executor_id,
      state,
      turn_update_event: turnUpdate,
    });
    this.turn = { ...this.turn, state, updated_at: updatedAt };
    return turnUpdate;
  }

  private async *persistExecutionEvent(
    event: Exclude<AgentThreadExecutionEvent, InternalTurnStateEvent>,
  ): AsyncGenerator<TurnStreamingEvent, void, unknown> {
    const scope = {
      session_id: this.turn.session_id,
      turn_id: this.turn.turn_id,
      active_executor_id: this.turn.active_executor_id,
    };

    switch (event.type) {
      case HarnessEventType.MODEL_MESSAGE:
      case HarnessEventType.MODEL_MESSAGE_DELTA:
        // Stream only — durable model content lands via AGENT_CONTEXT_APPEND.output.
        yield event;
        return;

      case HarnessEventType.TOOL_RESPONSE:
        await this.store.appendToEvents({
          ...scope,
          events: [event],
        });
        yield event;
        return;

      case InternalEventType.AGENT_CREATE_SUBAGENT:
        return;

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
        return;
      }

      case HarnessEventType.AGENT_CONTEXT_OVERWRITE: {
        await this.store.overwriteThreadContext({ ...scope, event });
        return;
      }

      case InternalEventType.AGENT_CONTEXT_APPEND: {
        await this.store.appendToThreadContext({
          ...scope,
          thread_id: event.thread_id,
          context: event.context,
          current_context_usage: event.current_context_usage,
          completion: event.completion ?? null,
        });
        const userEvents = [...event.output, ...event.applied_user_events];
        if (userEvents.length > 0) {
          await this.store.appendToEvents({
            ...scope,
            events: userEvents,
          });
        }
        if (event.applied_user_events.length > 0) {
          await this.store.markTurnInboundEventsConsumed({
            ...scope,
            event_ids: event.applied_user_events.map(out => out.id),
          });
        }
        yield* event.applied_user_events;
        return;
      }

      case InternalEventType.MCP_AUTH_CONTINUE: {
        await this.store.patchThreadsMCPAuth({
          ...scope,
          thread_ids: event.thread_ids,
          pending_mcp_auth: false,
        });
        await this.store.appendToEvents({
          ...scope,
          events: [event.event],
        });
        await this.store.markTurnInboundEventsConsumed({
          ...scope,
          event_ids: [event.event.id],
        });
        yield event.event;
        return;
      }

      case InternalEventType.APPROVAL_POLICY_APPLY: {
        // Sequential today; once a DB store lands these collapse into one transaction.
        for (const append of event.context_appends) {
          await this.store.appendToThreadContext({
            ...scope,
            thread_id: append.thread_id,
            context: append.context,
            current_context_usage: append.current_context_usage,
            completion: null,
          });
        }
        if (event.mcp_servers_patches.length > 0) {
          await this.store.patchMCPServers({ ...scope, mcp_servers: event.mcp_servers_patches });
        }
        await this.store.appendToEvents({
          ...scope,
          events: [event.event],
        });
        await this.store.markTurnInboundEventsConsumed({
          ...scope,
          event_ids: [event.event.id],
        });
        yield event.event;
        return;
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
          return;
        }
        if (!event.parent) {
          return;
        }
        const threadDone = toThreadDoneEvent(event);
        await this.store.appendToEvents({
          ...scope,
          events: [threadDone],
        });
        yield threadDone;
        return;
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
              pending_mcp_auth: false,
              capability_state: null,
            },
          ],
        });
        await this.store.appendToEvents({
          ...scope,
          events: [event],
        });
        yield event;
        return;
      }

      case InternalEventType.MCP_AUTH_REQUIRED: {
        const authEvent = toMCPAuthRequiredEvent(event);
        await this.store.patchThreadsMCPAuth({
          ...scope,
          thread_ids: [event.thread_id],
          pending_mcp_auth: true,
        });
        await this.store.appendToEvents({
          ...scope,
          events: [authEvent],
        });
        yield authEvent;
        return;
      }

      case HarnessEventType.MCP_INITIALIZE: {
        await this.store.patchMCPServers({
          ...scope,
          mcp_servers: event.mcp_servers.map((initInfo: MCPServerInitInfo) => ({
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
        yield event;
        return;
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
        yield event;
        return;
      }

      case HarnessEventType.TOOL_APPROVAL_REQUIRED:
      case HarnessEventType.TOOL_RESPONSE_REQUIRED: {
        await this.store.appendToEvents({
          ...scope,
          events: [event],
        });
        yield event;
        return;
      }

      default: {
        // Registered passthrough (orchestrator unwraps PASSTHROUGH before yield).
        await this.store.appendToEvents({
          ...scope,
          events: [event],
        });
        yield event;
        return;
      }
    }
  }
}
