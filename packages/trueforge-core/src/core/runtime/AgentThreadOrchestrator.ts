import type { Logger } from 'winston';
import { AgentHarnessError, InvalidAgentSendInputError } from '../errors';
import {
  EventType,
  newEventId,
  type ActionRequiredEvent,
  type ModelMessageEvent,
  type ToolResponseEvent,
  type UserToolApprovalMessage,
  type UserToolResponseMessage,
} from '../events/schema';
import type { AgentExecutionTrace, AgentTracing } from '../tracing/AgentTracing';
import { onSignalAbort } from '../util/abort';
import { mergeAsyncGenerators } from '../util/promiseUtils';
import { AgentThread } from './AgentThread';
import type { AgentThreadRuntimeSendBatch } from './AgentThread.types';
import {
  InternalEventType,
  type AgentThreadAppendContext,
  type AgentThreadEvent,
  type AgentThreadExecutionEvent,
  type AgentThreadExecutionResult,
  type AgentThreadSendBatch,
  type InternalMCPAuthRequiredEvent,
  type InternalMCPServerAuthInfo,
} from './AgentThread.types';
import {
  assistantMessageContentToStringForSubAgent,
  getThreadId,
  isApprovalDecisionMessage,
  isClientSideToolResponseMessage,
  isInternalThreadDoneError,
} from './contextUtils';
import type { CreateDynamicSubAgentThread } from './CreateDynamicSubAgentThread';
import { addAgentThreadMetrics, createEmptyAgentThreadMetrics, type AgentThreadMetrics } from './metrics';

const MAX_PARALLEL_SUB_AGENTS = 5;

function agentThreadEventToTerminalFields(event: AgentThreadExecutionEvent): {
  output?: ModelMessageEvent | undefined;
  requiredAction?: ActionRequiredEvent | undefined;
} {
  switch (event.type) {
    case InternalEventType.AGENT_DONE: {
      if ('parent' in event && event.parent) {
        return {};
      }
      if (event.status === 'error') {
        return {};
      }
      return { output: event.output };
    }
    case EventType.TOOL_APPROVAL_REQUIRED:
    case EventType.TOOL_RESPONSE_REQUIRED:
      return { requiredAction: event };
    default:
      return {};
  }
}

type UserToolApprovalOrResponseBatch = (UserToolApprovalMessage | UserToolResponseMessage)[];

function isUserToolApprovalOrResponseBatch(
  messages: AgentThreadSendBatch,
): messages is UserToolApprovalOrResponseBatch {
  const first = messages[0];
  return first !== undefined && (isApprovalDecisionMessage(first) || isClientSideToolResponseMessage(first));
}

function getMainThreadId(agentThreads: Map<string, AgentThread>): string {
  for (const thread of agentThreads.values()) {
    if (!thread.parent) {
      return thread.threadId;
    }
  }
  throw new Error('Unreachable: no root thread found');
}

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

function mergeAuthEvents(events: InternalMCPAuthRequiredEvent[]): InternalMCPAuthRequiredEvent {
  const serverMap = new Map<string, InternalMCPServerAuthInfo>();
  for (const event of events) {
    for (const entry of event.mcp_servers) {
      const existing = serverMap.get(entry.id);
      if (existing) {
        existing.thread_ids.push(...entry.thread_ids);
      } else {
        serverMap.set(entry.id, { ...entry, thread_ids: [...entry.thread_ids] });
      }
    }
  }
  return {
    type: InternalEventType.MCP_AUTH_REQUIRED,
    id: newEventId(),
    created_at: new Date().toISOString(),
    thread_id: null,
    mcp_servers: [...serverMap.values()],
  };
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
        if (isInternalThreadDoneError(event)) {
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

  constructor(params: AgentThreadOrchestratorInput) {
    this.agentThreads = params.agentThreads;
    this.createDynamicSubAgentThread = params.createDynamicSubAgentThread;
    this.tracing = params.tracing;
    this.logger = params.logger.child({ module: 'AgentThreadOrchestrator' });
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

  public async *send(messages: AgentThreadSendBatch): AsyncGenerator<AgentThreadAppendContext, void, unknown> {
    const byThread = new Map<string, AgentThreadRuntimeSendBatch>();
    for (const thread of this.agentThreads.values()) {
      byThread.set(thread.threadId, []);
    }

    if (isUserToolApprovalOrResponseBatch(messages)) {
      const grouped = new Map<string, UserToolApprovalOrResponseBatch[number][]>();
      for (const msg of messages) {
        const threadId = msg.thread_id;
        if (!byThread.has(threadId)) {
          throw new InvalidAgentSendInputError(`unknown thread_id: ${threadId}`);
        }
        const batch = grouped.get(threadId) ?? [];
        batch.push(msg);
        grouped.set(threadId, batch);
      }
      for (const [threadId, batch] of grouped) {
        byThread.set(threadId, batch);
      }
    } else if (messages.length > 0) {
      if (this.agentThreads.size > 1) {
        throw new InvalidAgentSendInputError(
          'Cannot process user messages while sub agents are running, please send empty input for previous conversation to complete',
        );
      }
      byThread.set(getMainThreadId(this.agentThreads), messages);
    }

    const validationErrors: string[] = [];
    for (const [threadId, batch] of byThread) {
      const thread = this.agentThreads.get(threadId);
      if (!thread) {
        throw new Error(`AgentThreadOrchestrator.send: unknown threadId ${threadId}`);
      }
      try {
        thread.validateSendInput(batch);
      } catch (e) {
        if (e instanceof AgentHarnessError && e.code === 'invalid_send_input') {
          validationErrors.push(`thread ${threadId}: ${e.message}`);
        } else {
          throw e;
        }
      }
    }
    if (validationErrors.length > 0) {
      throw new InvalidAgentSendInputError(validationErrors.join('; '));
    }

    for (const [threadId, batch] of byThread) {
      yield* this.sendToThread(threadId, batch);
    }
  }

  private async *sendToThread(
    threadId: string,
    messages: AgentThreadRuntimeSendBatch,
  ): AsyncGenerator<AgentThreadAppendContext, void, unknown> {
    const thread = this.agentThreads.get(threadId);
    if (!thread) {
      throw new Error(`AgentThreadOrchestrator.sendToThread: unknown threadId ${threadId}`);
    }
    yield* thread.send(messages);
  }

  private async *processAgentStreamChunk(
    chunk: Exclude<AgentThreadEvent, InternalMCPAuthRequiredEvent>,
    signal: AbortSignal,
  ): AsyncGenerator<AgentThreadExecutionEvent, { shouldStopExecution: boolean }, unknown> {
    if (chunk.type === InternalEventType.PASSTHROUGH) {
      yield chunk.event;
      return { shouldStopExecution: false };
    }

    if (!('thread_id' in chunk) || chunk.thread_id == null) {
      yield chunk;
      return { shouldStopExecution: false };
    }

    const currentThread = this.agentThreads.get(chunk.thread_id);
    if (!currentThread) {
      throw new Error('unreachable');
    }

    switch (chunk.type) {
      case EventType.TOOL_APPROVAL_REQUIRED:
      case EventType.TOOL_RESPONSE_REQUIRED:
        yield chunk;
        return { shouldStopExecution: true };
      case InternalEventType.AGENT_DONE: {
        if (chunk.parent) {
          if (!chunk.send_to_parent) {
            throw new Error('unreachable');
          }
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
            yield* this.sendToThread(chunk.parent.thread_id, [chunk.send_to_parent]);
          }
          yield chunk;
          // Move metrics to the finished bucket and drop the live entry with no `yield` between,
          // so getMetrics() counts this sub-agent once. After `yield chunk` per durable-state.
          addAgentThreadMetrics(this.finishedSubAgentMetrics, currentThread.getAgentThreadMetrics());
          this.agentThreads.delete(chunk.thread_id);
          return { shouldStopExecution: false };
        }
        yield chunk;
        return { shouldStopExecution: true };
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
        return { shouldStopExecution: false };
      }
      default:
        yield chunk;
        return { shouldStopExecution: false };
    }
  }

  public async *execute({
    signal,
  }: {
    signal: AbortSignal;
  }): AsyncGenerator<AgentThreadExecutionEvent, AgentThreadExecutionResult, unknown> {
    const { agentThreads } = this;

    let shouldStopExecution = false;
    let caughtError: unknown;
    let output: ModelMessageEvent | null = null;
    const requiredActions: ActionRequiredEvent[] = [];
    let rootAgentError: AgentThreadExecutionResult['root_agent_error'];
    const pendingAuthEvents: InternalMCPAuthRequiredEvent[] = [];
    const mainThread = [...agentThreads.values()].find(e => !e.parent);
    if (!mainThread) {
      throw new Error('Unreachable: no root thread found');
    }
    const rootSpan = createRootAgentSpan(mainThread, this.tracing);

    onSignalAbort(signal, () => {
      shouldStopExecution = true;
    });

    try {
      while (agentThreads.size > 0) {
        if (shouldStopExecution) {
          break;
        }

        const activeThreads = getActiveAgentThreads(agentThreads);

        for (let i = 0; i < activeThreads.length && !shouldStopExecution; i += MAX_PARALLEL_SUB_AGENTS) {
          const batch = activeThreads.slice(i, i + MAX_PARALLEL_SUB_AGENTS);
          const generators = batch.map(thread => {
            if (!thread.parent) {
              return rootSpan.wrapThreadWithContext(thread, signal);
            }
            return wrapWithSubAgentSpan(rootSpan.trace, thread, signal);
          });

          for await (const chunk of mergeAsyncGenerators(generators, this.logger)) {
            if (chunk.type === InternalEventType.MCP_AUTH_REQUIRED) {
              pendingAuthEvents.push(chunk);
              shouldStopExecution = true;
              continue;
            }
            if (chunk.type === InternalEventType.AGENT_DONE && !chunk.parent) {
              // Root-thread only — sub-agent AGENT_DONE would overwrite root trace output /
              // leave a stale error; sub-agent spans finalize in wrapWithSubAgentSpan.
              rootSpan.setOutputFromEvent(chunk);
            }

            const result = yield* this.processAgentStreamChunk(chunk, signal);
            if (result.shouldStopExecution) {
              shouldStopExecution = true;
              if (
                !rootAgentError &&
                chunk.type === InternalEventType.AGENT_DONE &&
                isInternalThreadDoneError(chunk) &&
                !chunk.parent
              ) {
                rootAgentError = { error: chunk.error, output: chunk.output };
              }
              if (chunk.type !== InternalEventType.PASSTHROUGH) {
                const { output: outputContribution, requiredAction } = agentThreadEventToTerminalFields(chunk);
                if (outputContribution) {
                  output = outputContribution;
                }
                if (requiredAction) {
                  requiredActions.push(requiredAction);
                }
              }
            }
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

    if (pendingAuthEvents.length > 0) {
      const authEvent = mergeAuthEvents(pendingAuthEvents);
      yield authEvent;
      const authRequiredAction: ActionRequiredEvent = {
        type: EventType.MCP_AUTH_REQUIRED,
        id: authEvent.id,
        created_at: authEvent.created_at,
        thread_id: authEvent.thread_id,
        mcp_servers: authEvent.mcp_servers.map(({ thread_ids, ...s }) => {
          void thread_ids;
          return s;
        }),
      };
      requiredActions.push(authRequiredAction);
    }

    return {
      output,
      required_actions: requiredActions,
      root_agent_error: rootAgentError,
    };
  }
}
