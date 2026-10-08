import type { Logger } from 'winston';
import { AgentHarnessError, InvalidAgentSendInputError } from '../errors';
import {
  EventType,
  newEventId,
  type MCPServerInitInfo,
  type ModelMessageEvent,
  type ToolApprovalPolicy,
  type ToolApprovalPolicyItem,
  type ToolResponseEvent,
  type TurnUserEvent,
  type UserMCPAuthContinueEvent,
  type UserMessage,
  type UserToolApprovalEvent,
  type UserToolApprovalPolicyEvent,
  type UserToolResponseEvent,
} from '../events/schema';
import type { LLMToolMessage } from '../llm/LLMTypes';
import type { AgentExecutionTrace, AgentTracing } from '../tracing/AgentTracing';
import { onSignalAbort } from '../util/abort';
import { mergeAsyncGenerators, signalable, type Signalable } from '../util/promiseUtils';
import { AgentThread } from './AgentThread';
import {
  InternalEventType,
  type AgentThreadAppendContext,
  type AgentThreadEvent,
  type AgentThreadExecutionEvent,
  type AgentThreadExecutionResult,
  type ApplyUserEventsOutput,
  type UserEventsCommitEvent,
} from './AgentThread.types';
import {
  assistantMessageContentToStringForSubAgent,
  getThreadId,
  isInternalThreadDoneCancelled,
  isInternalThreadDoneError,
  isUserMessageBatch,
} from './contextUtils';
import type { CreateDynamicSubAgentThread } from './CreateDynamicSubAgentThread';
import { addAgentThreadMetrics, createEmptyAgentThreadMetrics, type AgentThreadMetrics } from './metrics';

const MAX_PARALLEL_SUB_AGENTS = 5;
const CANCELED_BECAUSE_USER_SENT_NEW_MESSAGE = 'Canceled because user sent a new message.';

function getActiveAgentThreads(agentThreads: Map<string, AgentThread>): AgentThread[] {
  const nodes = new Set(agentThreads.keys());
  const parentNodes = new Set(
    [...agentThreads.values()].map(a => a.parent?.thread_id).filter((a): a is string => Boolean(a)),
  );
  const leaves = [...nodes].filter(id => !parentNodes.has(id));
  if (leaves.length === 0) {
    throw new Error('We cannot have zero leave agents');
  }
  return leaves.map(id => {
    const agentThread = agentThreads.get(id);
    if (!agentThread) {
      throw new Error('unreachable');
    }
    return agentThread;
  });
}

function wrapGeneratorWithTrace<T, TReturn = void, TNext = unknown>(
  trace: AgentExecutionTrace,
  generator: AsyncGenerator<T, TReturn, TNext>,
): AsyncGenerator<T, TReturn, TNext> {
  const wrapped: AsyncGenerator<T, TReturn, TNext> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    next(...[value]: [] | [TNext]) {
      return trace.runInContext(() => (value === undefined ? generator.next() : generator.next(value)));
    },
    return(value: TReturn | PromiseLike<TReturn>) {
      return trace.runInContext(() => generator.return(value));
    },
    throw(e: unknown) {
      return trace.runInContext(() => generator.throw(e));
    },
    [Symbol.asyncDispose]() {
      return generator[Symbol.asyncDispose]();
    },
  };
  return wrapped;
}

interface RootAgentSpanHandle {
  trace: AgentExecutionTrace;
  wrapThreadWithContext(thread: AgentThread, signal?: AbortSignal): AsyncGenerator<AgentThreadEvent>;
  setOutputFromEvent(chunk: AgentThreadEvent): void;
  finalize(thread: AgentThread, error?: unknown): void;
  end(): void;
}

function createRootAgentSpan(mainThread: AgentThread, tracing: AgentTracing): RootAgentSpanHandle {
  const trace = tracing.startRootSpan(
    JSON.stringify({ instructions: mainThread.definition.instruction, messages: mainThread.definition.messages }),
  );
  let rootAgentErrorMessage: string | undefined;
  let rootAgentCompleted = false;

  return {
    trace,
    wrapThreadWithContext(thread: AgentThread, signal?: AbortSignal) {
      return wrapGeneratorWithTrace(trace, thread.execute({ signal }));
    },
    setOutputFromEvent(chunk: AgentThreadEvent) {
      rootAgentCompleted = true;
      if (chunk.type === InternalEventType.AGENT_DONE) {
        if (isInternalThreadDoneError(chunk)) {
          rootAgentErrorMessage = chunk.error;
          trace.setOutput(JSON.stringify({ error: chunk.error }));
        } else if (isInternalThreadDoneCancelled(chunk)) {
          trace.setOutput(JSON.stringify({ cancelled: chunk.reason }));
        } else {
          const content = assistantMessageContentToStringForSubAgent(chunk.output.content);
          trace.setOutput(JSON.stringify({ result: content }));
        }
      }
    },
    finalize(thread: AgentThread, error?: unknown) {
      trace.setMetrics(thread.getAgentThreadMetrics());
      if (error) {
        trace.setError(error);
      } else if (rootAgentErrorMessage || !rootAgentCompleted) {
        trace.setError(rootAgentErrorMessage ?? 'Agent execution interrupted');
      } else {
        trace.setSuccess();
      }
    },
    end() {
      trace.end();
    },
  };
}

/** @internal Exported for sub-agent span finalization tests. */
export async function* wrapWithSubAgentSpan(
  parentTrace: AgentExecutionTrace,
  currentThread: AgentThread,
  signal?: AbortSignal,
): AsyncGenerator<AgentThreadEvent> {
  const agentInfo = currentThread.agentInfo;
  if (!agentInfo) {
    throw new Error('Sub-agent thread is missing agentInfo');
  }
  const subTrace = parentTrace.startSubAgent(agentInfo.name, JSON.stringify({ instructions: agentInfo.input }));
  const generator = wrapGeneratorWithTrace(subTrace, currentThread.execute({ signal }));

  try {
    for await (const event of generator) {
      if (event.type === InternalEventType.AGENT_DONE) {
        if (isInternalThreadDoneCancelled(event)) {
          subTrace.setOutput(JSON.stringify({ cancelled: event.reason }));
          subTrace.setMetrics(currentThread.getAgentThreadMetrics());
          subTrace.setError(event.reason);
        } else if (isInternalThreadDoneError(event)) {
          subTrace.setOutput(JSON.stringify({ error: event.error }));
          subTrace.setMetrics(currentThread.getAgentThreadMetrics());
          subTrace.setError(event.error);
        } else {
          const content = assistantMessageContentToStringForSubAgent(event.output.content);
          subTrace.setOutput(JSON.stringify({ result: content }));
          subTrace.setMetrics(currentThread.getAgentThreadMetrics());
          subTrace.setSuccess();
        }
        // end() only in finally so every path finalizes exactly once
      }
      yield event;
    }
  } catch (error) {
    subTrace.setError(error);
    throw error;
  } finally {
    subTrace.end();
  }
}

export interface AgentThreadOrchestratorInput {
  agentThreads: Map<string, AgentThread>;
  createDynamicSubAgentThread: CreateDynamicSubAgentThread;
  tracing: AgentTracing;
  logger: Logger;
}

export class AgentThreadOrchestrator {
  private readonly agentThreads: Map<string, AgentThread>;
  private readonly createDynamicSubAgentThread: CreateDynamicSubAgentThread;
  private readonly tracing: AgentTracing;
  private readonly logger: Logger;
  // Finished sub-agents removed from `agentThreads`; kept so totals still include them.
  private finishedSubAgentMetrics: AgentThreadMetrics = createEmptyAgentThreadMetrics();
  private readonly wakeSignal: Signalable = signalable();
  private readonly pendingTurnEvents: TurnUserEvent[] = [];
  // Last-seen MCP server init records (by id)/
  private readonly mcpServerInitInfoById = new Map<string, MCPServerInitInfo>();

  constructor(params: AgentThreadOrchestratorInput) {
    this.agentThreads = params.agentThreads;
    this.createDynamicSubAgentThread = params.createDynamicSubAgentThread;
    this.tracing = params.tracing;
    this.logger = params.logger.child({ module: 'AgentThreadOrchestrator' });
  }

  public wake(): void {
    this.wakeSignal.notify();
  }

  /**
   * Turn-wide metrics so far: live threads plus finished sub-agents.
   * Safe mid-flight and after cancel/error (`execute()` may not return).
   * Each thread is counted once — a sub-agent moves from live → finished atomically.
   */
  public getMetrics(): AgentThreadMetrics {
    const total = createEmptyAgentThreadMetrics();
    addAgentThreadMetrics(total, this.finishedSubAgentMetrics);
    for (const thread of this.agentThreads.values()) {
      addAgentThreadMetrics(total, thread.getAgentThreadMetrics());
    }
    return total;
  }

  private getMainThread(): AgentThread {
    for (const thread of this.agentThreads.values()) {
      if (!thread.parent) {
        return thread;
      }
    }
    throw new Error('Unreachable: no root thread found');
  }

  private getChildThreads(): AgentThread[] {
    return [...this.agentThreads.values()].filter(thread => thread.parent !== undefined);
  }

  private *applyToThread(
    threadId: string,
    messages: (UserToolApprovalEvent | UserToolResponseEvent | UserMCPAuthContinueEvent | LLMToolMessage)[],
  ): Generator<ApplyUserEventsOutput, void, unknown> {
    const thread = this.agentThreads.get(threadId);
    if (!thread) {
      throw new Error(`AgentThreadOrchestrator.applyToThread: unknown threadId ${threadId}`);
    }
    yield* thread.send(messages);
  }

  // Pure: every `server_name` must match a currently-configured user MCP tool set. Returns one
  // error string per unknown name (empty when all valid). Applies nothing.
  private validateApprovalPolicies(policies: ToolApprovalPolicyItem[]): string[] {
    const knownServerNames = new Set<string>();
    for (const thread of this.agentThreads.values()) {
      for (const toolSet of thread.getUserToolSets()) {
        knownServerNames.add(toolSet.name);
      }
    }

    const errors: string[] = [];
    policies.forEach((policy, index) => {
      if (!knownServerNames.has(policy.server_name)) {
        errors.push(`policies[${String(index)}]: unknown server_name '${policy.server_name}'`);
      }
    });
    return errors;
  }

  // Record each (already-validated) policy on its matching user tool sets, then resolve any
  // already-pending approvals the policy now covers. The orchestrator owns all policy semantics; the
  // thread only exposes its tool sets + context primitives. Last write wins for a given (server, tool).
  //
  // Gathers everything into a single UserEventsCommitEvent (the orchestrator is the sole emitter for a
  // policy, so the echo + patch fire exactly once even though application fans across threads):
  //  - per-thread context appends recording approvals covered by the policy;
  //  - MCP server patches with the merged full records for the affected servers (so the sticky policy
  //    survives into future turns);
  //  - one UserToolApprovalPolicyEvent echo per originating input event, each carrying the id stamped
  //    at send so a consumer can mark that inbound event consumed.
  private *applyApprovalPolicies(
    policyEvents: UserToolApprovalPolicyEvent[],
  ): Generator<UserEventsCommitEvent, void, unknown> {
    // Flatten to items only for applying/patching; the event boundaries drive the output events.
    const policies = policyEvents.flatMap(event => event.policies);
    const affected = new Set(policies.map(p => p.server_name));
    // Full policy map per server, taken from the tool set as it is updated.
    const approvalPoliciesByServer = new Map<string, Record<string, ToolApprovalPolicy>>();
    const commit: UserEventsCommitEvent = {
      type: InternalEventType.USER_EVENTS_COMMIT,
      context_appends: [],
      mcp_servers_patches: [],
      applied_user_events: [],
    };

    // Apply policies to tool sets.
    for (const thread of this.agentThreads.values()) {
      let appliedAny = false;
      for (const policy of policies) {
        for (const toolSet of thread.getUserToolSets()) {
          if (toolSet.name === policy.server_name) {
            toolSet.setApprovalPolicy(policy.name, policy.policy);
            approvalPoliciesByServer.set(toolSet.name, toolSet.getApprovalPolicies());
            appliedAny = true;
          }
        }
      }
      if (!appliedAny) {
        continue;
      }

      // Resolve any already-pending approvals the new policies cover.
      for (const event of thread.resolveApprovalsCoveredByPolicy()) {
        commit.context_appends.push(event);
      }
    }

    // Prepare MCP patch records.
    for (const record of this.mcpServerInitInfoById.values()) {
      if (!affected.has(record.name)) {
        continue;
      }
      commit.mcp_servers_patches.push({
        ...record,
        approval_policies: approvalPoliciesByServer.get(record.name) ?? record.approval_policies,
      });
    }
    // One output event per originating input event.
    for (const event of policyEvents) {
      commit.applied_user_events.push(event);
    }
    yield commit;
  }

  // Validate decisions against both committed context and decisions already accepted into the
  // turn-level queue. Pure + synchronous: returns every validation error without applying anything.
  private validateDecisionEvents(messages: (UserToolApprovalEvent | UserToolResponseEvent)[]): string[] {
    const grouped = new Map<string, typeof messages>();
    const validationErrors: string[] = [];
    for (const event of this.pendingTurnEvents) {
      if (event.type === EventType.USER_TOOL_APPROVAL_POLICY || event.type === EventType.USER_MCP_AUTH_CONTINUE) {
        continue;
      }
      const queued = grouped.get(event.thread_id) ?? [];
      queued.push(event);
      grouped.set(event.thread_id, queued);
    }

    const affectedThreads = new Set<string>();
    for (const msg of messages) {
      const threadId = msg.thread_id;
      if (!this.agentThreads.has(threadId)) {
        validationErrors.push(`unknown thread_id: ${threadId}`);
        continue;
      }
      const batch = grouped.get(threadId) ?? [];
      batch.push(msg);
      grouped.set(threadId, batch);
      affectedThreads.add(threadId);
    }

    for (const threadId of affectedThreads) {
      const thread = this.agentThreads.get(threadId);
      if (!thread) {
        throw new Error(`AgentThreadOrchestrator.send: unknown threadId ${threadId}`);
      }
      try {
        thread.validateSendInput(grouped.get(threadId) ?? []);
      } catch (e) {
        if (e instanceof AgentHarnessError && e.code === 'invalid_send_input') {
          validationErrors.push(`thread ${threadId}: ${e.message}`);
        } else {
          throw e;
        }
      }
    }
    return validationErrors;
  }

  public send(input: UserMessage[]): AsyncGenerator<AgentThreadAppendContext, void, unknown>;
  public send(input: TurnUserEvent[]): AsyncGenerator<TurnUserEvent[], void, unknown>;
  public async *send(
    input: UserMessage[] | TurnUserEvent[],
  ): AsyncGenerator<AgentThreadAppendContext | TurnUserEvent[], void, unknown> {
    if (input.length === 0) {
      return;
    }

    if (isUserMessageBatch(input)) {
      // A new turn may be created while the previous turn is running or paused:
      // cancel live children, close their open parent calls, then append the new
      // user input to the main thread immediately.
      const messages = input;
      const mainThread = this.getMainThread();
      const toolIdToClosureMessages = new Map<string, LLMToolMessage>();
      for (const thread of this.getChildThreads()) {
        for (const event of thread.cancel(CANCELED_BECAUSE_USER_SENT_NEW_MESSAGE)) {
          yield event;
          if (event.completion) {
            const toolMessage = event.completion.send_to_parent;
            toolIdToClosureMessages.set(toolMessage.tool_call_id, toolMessage);
          }
        }
      }
      yield* mainThread.closeAllOpenToolCalls({
        toolIdToClosureMessages,
        defaultToolClosureContent: CANCELED_BECAUSE_USER_SENT_NEW_MESSAGE,
      });

      yield* mainThread.sendUserMessages(messages);
      return;
    }

    const events = input;
    const decisions: (UserToolApprovalEvent | UserToolResponseEvent)[] = [];
    for (const event of events) {
      switch (event.type) {
        case EventType.USER_MCP_AUTH_CONTINUE:
        case EventType.USER_TOOL_APPROVAL_POLICY:
          break;
        case EventType.USER_TOOL_APPROVAL:
        case EventType.USER_TOOL_RESPONSE:
          // UserToolApproval | UserToolResponse.
          decisions.push(event);
          break;
        default: {
          const _exhaustive: never = event;
          throw new Error(`Unsupported turn user event: ${JSON.stringify(_exhaustive)}`);
        }
      }
    }

    // All-or-nothing validation up front: collect every decision and policy error before rejecting.
    const decisionErrors = this.validateDecisionEvents(decisions);
    const policyErrors = this.validateApprovalPolicies(
      events.flatMap(event => (event.type === EventType.USER_TOOL_APPROVAL_POLICY ? event.policies : [])),
    );
    const validationErrors = [
      ...decisionErrors.map(error => `invalid decision: ${error}`),
      ...policyErrors.map(error => `invalid approval policy: ${error}`),
    ];
    if (validationErrors.length > 0) {
      throw new InvalidAgentSendInputError(validationErrors.join('; '));
    }

    if (events.length > 0) {
      yield events;
      this.pendingTurnEvents.push(...events);
    }
  }

  private async *processAgentStreamChunk(
    chunk: AgentThreadEvent,
    signal: AbortSignal,
  ): AsyncGenerator<AgentThreadExecutionEvent, void, unknown> {
    if (chunk.type === InternalEventType.PASSTHROUGH) {
      yield chunk.event;
      return;
    }

    if (!('thread_id' in chunk) || chunk.thread_id == null) {
      yield chunk;
      return;
    }

    const currentThread = this.agentThreads.get(chunk.thread_id);
    if (!currentThread) {
      throw new Error('unreachable');
    }

    switch (chunk.type) {
      case EventType.MCP_INITIALIZE:
        for (const server of chunk.mcp_servers) {
          this.mcpServerInitInfoById.set(server.id, server);
        }
        yield chunk;
        return;
      case EventType.TOOL_APPROVAL_REQUIRED:
      case EventType.TOOL_RESPONSE_REQUIRED:
        yield chunk;
        return;
      case InternalEventType.AGENT_DONE: {
        if (chunk.parent) {
          const parentThread = this.agentThreads.get(chunk.parent.thread_id);
          if (!parentThread) {
            throw new Error('unreachable: parent thread missing');
          }
          const subAgentToolIsOpen = parentThread.hasOpenToolCallId(chunk.parent.tool_call_id);
          if (subAgentToolIsOpen) {
            const parentToolResponse: ToolResponseEvent = {
              type: EventType.TOOL_RESPONSE,
              id: newEventId(),
              created_at: new Date().toISOString(),
              thread_id: chunk.parent.thread_id,
              tool_call_id: chunk.send_to_parent.tool_call_id,
              content: '',
            };
            yield parentToolResponse;
            yield* this.applyToThread(chunk.parent.thread_id, [chunk.send_to_parent]);
          }
          yield chunk;
          // Move metrics to the finished bucket and drop the live entry with no `yield` between,
          // so getMetrics() counts this sub-agent once. After `yield chunk` per durable-state.
          addAgentThreadMetrics(this.finishedSubAgentMetrics, currentThread.getAgentThreadMetrics());
          this.agentThreads.delete(chunk.thread_id);
          return;
        }
        yield chunk;
        return;
      }
      case InternalEventType.AGENT_CREATE_SUBAGENT: {
        const parent = {
          tool_call_id: chunk.tool_call_id,
          thread_id: chunk.thread_id,
        };
        const subAgentThreadId = getThreadId();
        const subAgentThread = await this.createDynamicSubAgentThread({
          parentDefinition: currentThread.definition,
          request: chunk.agent_info,
          threadId: subAgentThreadId,
          parent,
          signal,
        });

        yield {
          type: EventType.THREAD_CREATED,
          id: newEventId(),
          agent_info: {
            type: 'dynamic',
            name: chunk.agent_info.name,
            input: chunk.agent_info.input,
            model: chunk.agent_info.model,
          },
          created_at: new Date().toISOString(),
          parent,
          title: chunk.agent_info.name,
          thread_id: subAgentThreadId,
        };
        this.agentThreads.set(subAgentThreadId, subAgentThread);
        return;
      }
      default:
        yield chunk;
        return;
    }
  }

  public async *execute({
    signal,
  }: {
    signal: AbortSignal;
  }): AsyncGenerator<AgentThreadExecutionEvent, AgentThreadExecutionResult, unknown> {
    const { agentThreads } = this;

    let caughtError: unknown;
    let output: ModelMessageEvent | null = null;
    let rootAgentError: AgentThreadExecutionResult['root_agent_error'];
    let rootFinished = false;
    let turnPaused = false;

    const mainThread = this.getMainThread();
    const rootSpan = createRootAgentSpan(mainThread, this.tracing);

    // Abort unparks the loop; it then observes signal.aborted and returns.
    onSignalAbort(signal, () => {
      this.wakeSignal.notify();
    });

    const done = (): AgentThreadExecutionResult => ({
      status: 'done',
      output,
      root_agent_error: rootAgentError,
    });
    // Read through a function so flow analysis doesn't narrow these across awaits / loop
    // back-edges: `signal.aborted` can flip during `await wake.wait()` (abort callback), and
    // `rootFinished` is set deep inside the batch loop.
    const isAborted = (): boolean => signal.aborted;
    const rootSettled = (): boolean => rootFinished || rootAgentError !== undefined;

    try {
      for (;;) {
        if (isAborted() || rootSettled()) {
          return done();
        }

        // Apply accepted user events in the same order they entered the turn-level queue.
        for (const event of this.pendingTurnEvents.splice(0)) {
          switch (event.type) {
            case EventType.USER_TOOL_APPROVAL_POLICY:
              yield* this.applyApprovalPolicies([event]);
              break;
            case EventType.USER_TOOL_APPROVAL:
            case EventType.USER_TOOL_RESPONSE:
              yield* this.applyToThread(event.thread_id, [event]);
              break;
            case EventType.USER_MCP_AUTH_CONTINUE: {
              // MCP auth continue is applied to all threads, but
              // event is only yielded once.
              yield {
                type: InternalEventType.MCP_AUTH_CONTINUE,
                event,
                thread_ids: [...this.agentThreads.keys()],
              };

              for (const threadId of this.agentThreads.keys()) {
                yield* this.applyToThread(threadId, [event]);
              }
              break;
            }
          }
        }

        const active = getActiveAgentThreads(agentThreads);
        const runnable = active.filter(thread => thread.isRunnable());

        if (runnable.length === 0) {
          if (!turnPaused) {
            yield { type: InternalEventType.TURN_STATE, transition: { status: 'paused' } };
            turnPaused = true;
          }
          await this.wakeSignal.wait();
          if (isAborted()) {
            return done();
          }
          continue;
        }

        if (turnPaused) {
          yield { type: InternalEventType.TURN_STATE, transition: { status: 'running' } };
          turnPaused = false;
        }

        for (let i = 0; i < runnable.length; i += MAX_PARALLEL_SUB_AGENTS) {
          const batch = runnable.slice(i, i + MAX_PARALLEL_SUB_AGENTS);
          const generators = batch.map(thread =>
            thread.parent
              ? wrapWithSubAgentSpan(rootSpan.trace, thread, signal)
              : rootSpan.wrapThreadWithContext(thread, signal),
          );

          for await (const chunk of mergeAsyncGenerators(generators, this.logger)) {
            switch (chunk.type) {
              case InternalEventType.AGENT_DONE: {
                // Root-thread AGENT_DONE finalizes the turn: capture trace output before routing
                // and record the terminal result after. Sub-agent done routes like any other event
                // (its span finalizes in wrapWithSubAgentSpan), so would overwrite root output.
                if (!chunk.parent) {
                  rootSpan.setOutputFromEvent(chunk);
                }
                yield* this.processAgentStreamChunk(chunk, signal);
                if (!chunk.parent) {
                  rootFinished = true;
                  if (isInternalThreadDoneError(chunk)) {
                    rootAgentError = { error: chunk.error, output: chunk.output };
                  } else {
                    output = chunk.output;
                  }
                }
                break;
              }

              default: {
                yield* this.processAgentStreamChunk(chunk, signal);
                break;
              }
            }
          }

          if (rootSettled() || isAborted()) {
            break;
          }
        }
      }
    } catch (error) {
      caughtError = error;
      throw error;
    } finally {
      rootSpan.finalize(mainThread, caughtError);
      rootSpan.end();
    }
  }
}
