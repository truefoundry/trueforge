/**
 * Durable turn handle. {@link TurnHandle.stream} is execute-once (persist-before-yield).
 */
import { AgentHarnessError } from '../core/errors';
import type { MCPAuthRequiredEvent, ModelMessageDeltaEvent, ThreadDoneEvent } from '../core/events/schema';
import { EventType as HarnessEventType, newEventId } from '../core/events/schema';
import {
  InternalEventType,
  type AgentThreadExecutionEvent,
  type AgentThreadExecutionResult,
  type InternalMCPAuthRequiredEvent,
  type InternalThreadDoneEvent,
} from '../core/runtime/AgentThread.types';
import type { AgentThreadOrchestrator } from '../core/runtime/AgentThreadOrchestrator';
import { getEmptyCurrentContextUsage } from '../core/runtime/contextUsage';
import type { AgentThreadMetrics } from '../core/runtime/metrics';
import type { ITurnResourceResolver } from './ITurnResourceResolver';
import type { TurnRecord } from './models/TurnRecord';
import { EventType, type PersistedTurnEvent, type TurnCreatedEvent, type TurnDoneEvent } from './schemas/events';
import type { TokenPagination } from './schemas/pagination';
import {
  CancellationReason,
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
    let frozenByStore = false;
    let executeResult: AgentThreadExecutionResult | undefined;
    let generator: AsyncGenerator<AgentThreadExecutionEvent, AgentThreadExecutionResult, unknown> | undefined;

    try {
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
      yield turnCreated;

      generator = orchestrator.execute({ signal });
      let iterResult = await generator.next();
      while (!iterResult.done) {
        const event = iterResult.value;
        try {
          const yielded = await this.persistExecutionEvent(event);
          if (yielded) {
            yield yielded;
          }
        } catch (error) {
          if (error instanceof TurnNotRunningError) {
            frozenByStore = true;
            const emptyResult: AgentThreadExecutionResult = {
              output: null,
              required_actions: [],
            };
            await generator.return(emptyResult);
            // Cleared so the finally block does not close the generator a second time.
            generator = undefined;
            const updatedAt = new Date();
            const createdAtIso = updatedAt.toISOString();
            const state: TerminalTurnState = {
              ...error.state,
              metrics: turnMetricsFromAgentThreadMetrics(orchestrator.getMetrics()),
            };
            this.turn = { ...this.turn, state, updated_at: updatedAt };
            yield {
              type: EventType.TURN_DONE,
              id: newEventId(),
              created_at: createdAtIso,
              state,
              thread_id: null,
            };
            return;
          }
          throw error;
        }
        iterResult = await generator.next();
      }
      executeResult = iterResult.value;
    } catch (error) {
      caughtError = error instanceof Error ? error : new Error(String(error));
    } finally {
      if (generator) {
        const emptyResult: AgentThreadExecutionResult = {
          output: null,
          required_actions: [],
        };
        await generator.return(emptyResult);
      }

      const updatedAt = new Date();
      const createdAtIso = updatedAt.toISOString();
      const metrics = turnMetricsFromAgentThreadMetrics(orchestrator.getMetrics());
      let terminalState: TerminalTurnState;
      if (signal.aborted) {
        terminalState = {
          status: 'cancelled',
          reason: cancellationReasonFromAbortReason(signal.reason),
          completed_at: createdAtIso,
          metrics,
        };
      } else if (caughtError) {
        terminalState = {
          status: 'error',
          message: caughtError.message,
          completed_at: createdAtIso,
          metrics,
        };
      } else if (executeResult?.root_agent_error) {
        terminalState = {
          status: 'error',
          message: executeResult.root_agent_error.error,
          completed_at: createdAtIso,
          metrics,
        };
      } else if (executeResult === undefined) {
        // Consumer abandoned the generator (break/return) without aborting —
        // no executeResult, no error, signal not aborted.
        terminalState = {
          status: 'cancelled',
          reason: CancellationReason.ClientCancelled,
          completed_at: createdAtIso,
          metrics,
        };
      } else {
        terminalState = {
          status: 'done',
          output: executeResult.output,
          required_actions: executeResult.required_actions,
          completed_at: createdAtIso,
          metrics,
        };
      }

      const turnDone: TurnDoneEvent = {
        type: EventType.TURN_DONE,
        id: newEventId(),
        created_at: createdAtIso,
        state: terminalState,
        thread_id: null,
      };

      if (!frozenByStore) {
        try {
          await this.store.updateTurnState({
            session_id: this.turn.session_id,
            turn_id: this.turn.turn_id,
            state: terminalState,
            turn_done_event: turnDone,
          });
          this.turn = { ...this.turn, state: terminalState, updated_at: updatedAt };
        } catch (persistError) {
          if (persistError instanceof TurnNotRunningError) {
            const state: TerminalTurnState = { ...persistError.state, metrics };
            this.turn = { ...this.turn, state, updated_at: updatedAt };
            await resolver.close().catch(() => {
              /* no-op */
            });
            yield {
              type: EventType.TURN_DONE,
              id: newEventId(),
              created_at: createdAtIso,
              state,
              thread_id: null,
            };
            // eslint-disable-next-line no-unsafe-finally -- deliberate: a concurrent freeze during the terminal write makes the store's state authoritative, so the stream ends here
            return;
          }
          // Store-write failures reject the stream (caller drain .catch).
          await resolver.close().catch(() => {
            /* no-op */
          });
          // eslint-disable-next-line no-unsafe-finally -- deliberate: the terminal-state write runs in finally and its failure must reject the stream
          throw persistError;
        }
      }

      await resolver.close().catch((err: unknown) => {
        resolver.logger.warn('TurnResourceResolver.close() failed', { err });
      });

      if (!frozenByStore) {
        yield turnDone;
      }
    }
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
   * Persist side effects for one execution event; return a streaming yield when
   * the event should be emitted to the consumer (null = side-effect only / skip).
   */
  private async persistExecutionEvent(event: AgentThreadExecutionEvent): Promise<TurnStreamingEvent | null> {
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

      case InternalEventType.AGENT_DONE: {
        if (!event.parent) {
          return null;
        }
        const threadDone = toThreadDoneEvent(event);
        await this.store.removeThreads({
          ...scope,
          thread_ids: [event.thread_id],
        });
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
