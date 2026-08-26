import { ulid } from 'ulid';
import type { ITurnResourceResolver } from '../../src/agent-session/ITurnResourceResolver';
import { MAIN_THREAD_ID, type TurnRecord } from '../../src/agent-session/models/TurnRecord';
import { AgentSpecSchema, type AgentSpec } from '../../src/agent-session/schemas/agentSpec';
import { EventType } from '../../src/agent-session/schemas/events';
import { CancellationReason, type TerminalTurnState } from '../../src/agent-session/schemas/turn';
import type { CreateTurnInput, NewThreadInit, TurnContextAppend } from '../../src/agent-session/store/ISessionStore';
import { TurnResourceResolver } from '../../src/agent-session/TurnResourceResolver';
import type { AgentCapability } from '../../src/core/capabilities/AgentCapability';
import { newEventId } from '../../src/core/events/schema';
import type {
  CompletionUsage,
  ExtendedChatCompletionChunk,
  RawAssistantMessageWithUsage,
} from '../../src/core/llm/LLMTypes';
import { getEmptyUsage } from '../../src/core/llm/LLMTypes';
import { getEmptyCurrentContextUsage } from '../../src/core/runtime/contextUsage';
import type { Sandbox } from '../../src/core/sandbox/Sandbox';
import { makeMockILLM, makeSilentLogger } from '../core/harnessMocks';

export { makeMockILLM, makeSilentLogger };

/** Turn ids are opaque, caller-minted strings; tests only need uniqueness. */
export function mintTestTurnId(): string {
  return ulid().toLowerCase();
}

/** Minimal AgentSpec for session/turn tests — interactive builtins off; FQN model required. */
export function makeAgentSpec(
  overrides: {
    instructions?: string;
    model?: { name: string };
    config?: {
      iteration_limit?: number;
      sandbox?: { enabled: boolean; file_downloads?: boolean };
      ask_user_questions?: { enabled?: boolean };
      dynamic_sub_agents?: { enabled?: boolean };
      generative_ui?: { enabled?: boolean };
      context_management?: {
        compaction?: {
          enabled?: boolean;
          trigger?: { type: 'input_tokens'; value: number };
        };
        large_tool_response?: { enabled?: boolean };
      };
    };
  } = {},
): AgentSpec {
  return AgentSpecSchema.parse({
    model: overrides.model ?? { name: 'test-provider/test-model' },
    instructions: overrides.instructions ?? 'You are a test agent.',
    config: {
      iteration_limit: 5,
      ask_user_questions: { enabled: false },
      dynamic_sub_agents: { enabled: false },
      generative_ui: { enabled: false },
      ...overrides.config,
      context_management: {
        compaction: { enabled: false },
        large_tool_response: { enabled: false },
        ...overrides.config?.context_management,
      },
    },
  });
}

// eslint-disable-next-line @typescript-eslint/require-await -- async generator fixture, not awaiting I/O
export async function* emptyLlmStream(
  usage: CompletionUsage = getEmptyUsage(),
): AsyncGenerator<ExtendedChatCompletionChunk, RawAssistantMessageWithUsage, unknown> {
  yield {
    id: 'chunk-1',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test-model',
    choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
  };
  return {
    output: { role: 'assistant', content: 'ok' },
    usage,
    finish_reason: 'stop',
  };
}

export function makeTestResolver<TTurnCustom extends object = Record<string, never>>(options?: {
  extraCapabilities?: AgentCapability[];
  sandbox?: Sandbox;
  close?: () => Promise<void>;
  usage?: CompletionUsage;
  /** Named-agent lookup for sessions bound by agent_id. */
  agent?: ((agentId: string) => Promise<AgentSpec>) | undefined;
}): ITurnResourceResolver<TTurnCustom> {
  const llm = makeMockILLM({
    create: jest.fn().mockImplementation(() => emptyLlmStream(options?.usage)),
  });
  const base = new TurnResourceResolver<TTurnCustom>({
    llm: () => Promise.resolve({ modelClient: llm, defaultModelParams: {} }),
    mcp: name => {
      return Promise.reject(new Error(`unexpected mcp lookup: ${name}`));
    },
    mcpRequestTimeoutMs: 60_000,
    mcpConnectTimeoutMs: 5_000,
    logger: makeSilentLogger(),
    ...(options?.agent !== undefined ? { agent: options.agent } : {}),
    ...(options?.sandbox
      ? {
          sandboxProvider: () => {
            if (!options.sandbox) {
              return Promise.reject(new Error('sandbox missing'));
            }
            return Promise.resolve(options.sandbox);
          },
        }
      : {}),
  });

  if (!options?.extraCapabilities && !options?.close && !options?.sandbox) {
    return base;
  }

  const wrapped: ITurnResourceResolver<TTurnCustom> = {
    get logger() {
      return base.logger;
    },
    createTracing: () => base.createTracing(),
    resolveAgentSpec: input => base.resolveAgentSpec(input),
    resolveSandbox: input => base.resolveSandbox(input),
    resolveAgentDefinition: async input => {
      const resolved = await base.resolveAgentDefinition(input);
      return {
        ...resolved,
        extraCapabilities: [...(resolved.extraCapabilities ?? []), ...(options.extraCapabilities ?? [])],
      };
    },
    close: async () => {
      if (options.close) {
        await options.close();
      }
      await base.close();
    },
  };
  return wrapped;
}

export function makeTurnDoneEvent(state: TerminalTurnState) {
  return {
    type: EventType.TURN_DONE,
    id: newEventId(),
    created_at: new Date().toISOString(),
    state,
    thread_id: null,
  };
}

const defaultRootThread: NewThreadInit = {
  thread_id: MAIN_THREAD_ID,
  parent: null,
  agent_info: null,
};

/** Delta-shaped createTurn input for store contract tests. */
export function makeCreateTurnInput(input: {
  sessionId: string;
  turnId: string;
  previousTurnId?: string | null;
  firstTurnId?: string;
  new_threads?: NewThreadInit[];
  new_context_appends?: TurnContextAppend[];
  capability_states?: CreateTurnInput['capability_states'];
  update_session_title_if_not_exist?: string;
}): CreateTurnInput {
  const turn = makeRunningTurnRecord({
    sessionId: input.sessionId,
    turnId: input.turnId,
    ...(input.previousTurnId !== undefined ? { previousTurnId: input.previousTurnId } : {}),
    ...(input.firstTurnId !== undefined ? { firstTurnId: input.firstTurnId } : {}),
  });
  const { snapshot, ...turnInit } = turn;
  void snapshot;
  const isFirstInChain = input.previousTurnId === undefined || input.previousTurnId === null;
  return {
    turn: turnInit,
    new_threads: isFirstInChain ? (input.new_threads ?? [defaultRootThread]) : (input.new_threads ?? []),
    new_context_appends: input.new_context_appends ?? [],
    capability_states: input.capability_states ?? [{ thread_id: MAIN_THREAD_ID, capability_state: null }],
    update_session_title_if_not_exist: input.update_session_title_if_not_exist ?? null,
  };
}

export function makeDoneTurnState(): TerminalTurnState {
  return {
    status: 'done',
    output: null,
    required_actions: [],
    completed_at: new Date().toISOString(),
  };
}

export function makeCancelledTurnState(
  reason: CancellationReason = CancellationReason.ClientCancelled,
): TerminalTurnState {
  return {
    status: 'cancelled',
    reason,
    completed_at: new Date().toISOString(),
  };
}

export function makeRunningTurnRecord(input: {
  sessionId: string;
  turnId: string;
  previousTurnId?: string | null;
  firstTurnId?: string;
}): TurnRecord {
  const now = new Date();
  return {
    turn_id: input.turnId,
    session_id: input.sessionId,
    first_turn_id: input.firstTurnId ?? input.turnId,
    ancestor_ids: input.previousTurnId ? [input.previousTurnId] : [],
    previous_turn_id: input.previousTurnId ?? null,
    state: { status: 'running' },
    input: [],
    custom: null,
    snapshot: {
      threads: {
        [MAIN_THREAD_ID]: {
          thread_id: MAIN_THREAD_ID,
          context: [],
          current_context_usage: getEmptyCurrentContextUsage(),
          parent: null,
          agent_info: null,
          completion: null,
          capability_state: null,
        },
      },
      mcp_servers: null,
      sandbox_info: null,
    },
    created_at: now,
    updated_at: now,
  };
}

export function makeTurnCreatedEvent(turnId: string) {
  return {
    type: 'turn.created' as const,
    id: newEventId(),
    turn_id: turnId,
    previous_turn_id: null,
    state: { status: 'running' as const },
    created_at: new Date().toISOString(),
    thread_id: null,
  };
}

export function makeModelMessageEvent() {
  return {
    type: EventType.MODEL_MESSAGE,
    id: newEventId(),
    created_at: new Date().toISOString(),
    thread_id: MAIN_THREAD_ID,
    content: 'hi',
  };
}
