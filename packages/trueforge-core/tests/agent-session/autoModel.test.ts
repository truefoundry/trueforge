import { MAIN_THREAD_ID } from '../../src/agent-session/models/TurnRecord';
import { EventType } from '../../src/agent-session/schemas/events';
import { Sessions } from '../../src/agent-session/Sessions';
import { InMemorySessionStore } from '../../src/agent-session/store/InMemorySessionStore';
import type { DecisionModelCreateParams } from '../../src/core/decision/IDecisionModel';
import { AgentHarnessError } from '../../src/core/errors';
import type { LLMCreateParamsStreaming } from '../../src/core/llm/ILLM';
import { DEFAULT_ROUTING_QUESTION } from '../../src/core/modelRouting/question';
import type { ModelRouterDeps, RoutableModel } from '../../src/core/modelRouting/router';
import { createEmptyAgentThreadMetrics } from '../../src/core/runtime/metrics';
import { createSubAgentStream, textReplyStream } from '../orchestration/helpers/helpers';
import {
  makeAgentSpec,
  makeCreateTurnInput,
  makePausedTurnState,
  makeTestResolver,
  makeTurnUpdateEvent,
  mintTestTurnId,
  TEST_ACTIVE_EXECUTOR_ID,
} from './testHelpers';

const HAIKU = 'b/claude-haiku-5-5';
const SPEC_MODEL = 'test-provider/test-model';
const DEFAULTS = { max_tokens: 128 };

const routable: RoutableModel[] = [
  { name: 'a/claude-sonnet-5-5', canonicalModel: 'anthropic/claude-sonnet-5-5', cost: 4 },
  { name: 'a/claude-haiku-5-5', canonicalModel: 'anthropic/claude-haiku-5-5', cost: 0.5 },
  { name: HAIKU, canonicalModel: 'anthropic/claude-haiku-5-5', cost: 0.2 },
  { name: 'a/gpt-6-luna', canonicalModel: 'openai/gpt-6-luna', cost: undefined },
];

function decisionFor(category: string | undefined) {
  return {
    model: 'jev',
    answers:
      category === undefined
        ? []
        : [
            {
              type: 'choice' as const,
              name: 'category',
              choice: category,
              confidence: 0.9,
              probabilities: [{ value: category, probability: 0.95 }],
            },
          ],
    usage: {
      input_tokens: 0,
      input_tokens_details: { cache_write_tokens: 0, cached_tokens: 0 },
      output_tokens: 0,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 0,
    },
  };
}

/** `direct` for a conversation and `fixed_steps` for a task, unless `category` overrides both. */
function routing(category?: (input: DecisionModelCreateParams['input']) => string | undefined): {
  deps: ModelRouterDeps;
  calls: DecisionModelCreateParams[];
} {
  const calls: DecisionModelCreateParams[] = [];
  const deps: ModelRouterDeps = {
    classifier: () =>
      Promise.resolve({
        client: {
          create: body => {
            calls.push(body);
            const chosen =
              category !== undefined ? category(body.input) : typeof body.input === 'string' ? 'fixed_steps' : 'direct';
            return Promise.resolve(decisionFor(chosen));
          },
        },
        properties: { contextLength: 16_000 },
      }),
    question: DEFAULT_ROUTING_QUESTION,
    listModels: () => Promise.resolve(routable),
  };
  return { deps, calls };
}

async function createSession(model: { name: string; params?: { temperature?: number } }, subAgents = false) {
  const store = new InMemorySessionStore();
  const sessions = new Sessions({ sessionStore: store });
  const session = await sessions.create({
    tenant_id: 'tenant-1',
    session_id: 's1',
    created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
    agent: {
      type: 'inline',
      spec: makeAgentSpec({
        model,
        ...(subAgents ? { config: { dynamic_sub_agents: { enabled: true } } } : {}),
      }),
    },
    external_id: null,
  });
  return { store, session };
}

async function pause(store: InMemorySessionStore, turnId: string): Promise<void> {
  const turn = await store.getTurn({ session_id: 's1', turn_id: turnId });
  const runningSince = turn?.snapshot.running_since;
  if (runningSince == null) {
    throw new Error('expected a running turn to pause');
  }
  const state = makePausedTurnState();
  await store.updateTurnNonTerminalState({
    active_executor_id: TEST_ACTIVE_EXECUTOR_ID,
    session_id: 's1',
    turn_id: turnId,
    state,
    turn_update_event: makeTurnUpdateEvent(state),
    turn_metrics: {
      status: 'paused',
      observed_at: new Date(Date.parse(runningSince) + 1).toISOString(),
      metrics: createEmptyAgentThreadMetrics(),
    },
  });
}

function userText(
  message: Exclude<DecisionModelCreateParams['input'], string>[number] | undefined,
): string | undefined {
  if (message !== undefined && 'role' in message && message.role === 'user' && typeof message.content === 'string') {
    return message.content;
  }
  return undefined;
}

/** Root replies with create_sub_agent, the child replies with text, then the root finishes. */
function subAgentReplies(bodies: LLMCreateParamsStreaming[]) {
  let calls = 0;
  // jest.fn() so the unannotated tool-call stream is not checked against the client type.
  const create = jest.fn();
  create.mockImplementation((body: LLMCreateParamsStreaming) => {
    bodies.push(body);
    calls += 1;
    if (calls === 1) return createSubAgentStream();
    if (calls === 2) return textReplyStream('from the child');
    return textReplyStream('done');
  });
  return create;
}

function turnInput(turnId: string, content: string) {
  return {
    turn_id: turnId,
    active_executor_id: TEST_ACTIVE_EXECUTOR_ID,
    input: [{ type: EventType.USER_MESSAGE, content }],
    previous_turn_id: 'none' as const,
    abortController: new AbortController(),
  };
}

describe('auto model selection', () => {
  const autoSpec = { name: 'auto', params: { temperature: 0.2 } };

  it('runs a new auto turn on the routed model defaults at the routed effort', async () => {
    const { store, session } = await createSession(autoSpec);
    const route = routing();
    const names: string[] = [];
    const bodies: LLMCreateParamsStreaming[] = [];
    const turn = await session.createTurn({
      ...turnInput(mintTestTurnId(), 'hello'),
      resolver: makeTestResolver({
        modelRouting: route.deps,
        defaultModelParams: DEFAULTS,
        onModel: name => names.push(name),
        llmCreate: body => {
          bodies.push(body);
          return textReplyStream('ok');
        },
      }),
    });

    for await (const event of turn.stream()) void event;

    const stored = await store.getTurn({ session_id: 's1', turn_id: turn.id });
    expect(names).toEqual([HAIKU]);
    expect(stored?.snapshot.threads[MAIN_THREAD_ID]?.model).toBe(HAIKU);
    expect(bodies[0]).toMatchObject({ max_tokens: 128, reasoning_effort: 'low' });
    expect(bodies[0]).not.toHaveProperty('temperature');
    expect(route.calls).toHaveLength(1);
    expect(Array.isArray(route.calls[0]?.input) && route.calls[0].input.at(-1)).toEqual({
      role: 'user',
      content: 'hello',
    });
  });

  it('classifies the next turn with the previous conversation', async () => {
    const { session } = await createSession(autoSpec);
    const route = routing();
    const resolver = () => makeTestResolver({ modelRouting: route.deps, llmCreate: () => textReplyStream('ok') });
    const first = await session.createTurn({
      ...turnInput(mintTestTurnId(), 'first question'),
      resolver: resolver(),
    });
    for await (const event of first.stream()) void event;

    await session.createTurn({
      ...turnInput(mintTestTurnId(), 'second question'),
      previous_turn_id: 'auto',
      resolver: resolver(),
    });

    const second = route.calls[1]?.input;
    if (!Array.isArray(second)) {
      throw new Error('expected the second classification to be a conversation');
    }
    expect(second.some(message => userText(message) === 'first question')).toBe(true);
    expect(userText(second.at(-1))).toBe('second question');
  });

  // Updated in the fallback PR: a failed choice routes again instead of rejecting the turn.
  it('rejects a new auto turn when routing chooses nothing, and closes the resolver', async () => {
    const { session } = await createSession(autoSpec);
    const close = jest.fn(() => Promise.resolve());
    const route = routing(() => undefined);
    await expect(
      session.createTurn({
        ...turnInput(mintTestTurnId(), 'hello'),
        resolver: makeTestResolver({ modelRouting: route.deps, close }),
      }),
    ).rejects.toMatchObject({
      code: 'auto_model_unavailable',
      message: 'Auto model selection could not choose a model',
    } satisfies Partial<AgentHarnessError>);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('rejects a new auto turn when routing is off', async () => {
    const { session } = await createSession(autoSpec);
    await expect(
      session.createTurn({
        ...turnInput(mintTestTurnId(), 'hello'),
        resolver: makeTestResolver(),
      }),
    ).rejects.toMatchObject({
      code: 'auto_model_unavailable',
      message: 'Auto mode is turned off for this tenant',
    } satisfies Partial<AgentHarnessError>);
  });

  it('resumes a rebuilt auto turn on the saved model without classifying again', async () => {
    const { store, session } = await createSession(autoSpec);
    const turnId = mintTestTurnId();
    await session.createTurn({
      ...turnInput(turnId, 'hello'),
      resolver: makeTestResolver({ modelRouting: routing().deps }),
    });
    await pause(store, turnId);

    const route = routing();
    const names: string[] = [];
    const bodies: LLMCreateParamsStreaming[] = [];
    const rebuilt = await session.rebuildTurn({
      turn_id: turnId,
      active_executor_id: TEST_ACTIVE_EXECUTOR_ID,
      abortController: new AbortController(),
      resolver: makeTestResolver({
        modelRouting: route.deps,
        defaultModelParams: DEFAULTS,
        onModel: name => names.push(name),
        llmCreate: body => {
          bodies.push(body);
          return textReplyStream('ok');
        },
      }),
    });
    for await (const event of rebuilt.stream()) void event;

    expect(route.calls).toHaveLength(0);
    expect(names).toEqual([HAIKU]);
    expect(bodies[0]).toMatchObject({ max_tokens: 128 });
    expect(bodies[0]).not.toHaveProperty('reasoning_effort');
    expect(bodies[0]).not.toHaveProperty('temperature');
  });

  // Updated in the fallback PR: a rebuild with no saved model routes again instead of rejecting the turn.
  it('rejects a rebuilt auto turn that has no saved model', async () => {
    const { store, session } = await createSession(autoSpec);
    const turnId = mintTestTurnId();
    await store.createTurn(makeCreateTurnInput({ sessionId: 's1', turnId }));
    await pause(store, turnId);

    await expect(
      session.rebuildTurn({
        turn_id: turnId,
        active_executor_id: TEST_ACTIVE_EXECUTOR_ID,
        abortController: new AbortController(),
        resolver: makeTestResolver({ modelRouting: routing().deps }),
      }),
    ).rejects.toMatchObject({
      code: 'auto_model_unavailable',
      message: 'This paused turn has no saved model to resume on',
    } satisfies Partial<AgentHarnessError>);
  });

  it('runs a routed subagent on its own model and effort, dropping the spec params', async () => {
    const { session } = await createSession(autoSpec, true);
    const bodies: LLMCreateParamsStreaming[] = [];
    const turn = await session.createTurn({
      ...turnInput(mintTestTurnId(), 'hello'),
      resolver: makeTestResolver({
        modelRouting: routing().deps,
        defaultModelParams: DEFAULTS,
        llmCreate: subAgentReplies(bodies),
      }),
    });
    for await (const event of turn.stream()) void event;

    // The child thread is removed from the snapshot when it finishes, so the call is the record of what it ran on.
    expect(bodies[0]).toMatchObject({ reasoning_effort: 'low' });
    expect(bodies[1]).toMatchObject({ max_tokens: 128, reasoning_effort: 'high' });
    expect(bodies[1]).not.toHaveProperty('temperature');
  });

  it('runs an unplaced subagent of an auto root on the root model and effort', async () => {
    const { session } = await createSession(autoSpec, true);
    const bodies: LLMCreateParamsStreaming[] = [];
    const turn = await session.createTurn({
      ...turnInput(mintTestTurnId(), 'hello'),
      resolver: makeTestResolver({
        modelRouting: routing(input => (typeof input === 'string' ? undefined : 'direct')).deps,
        defaultModelParams: DEFAULTS,
        llmCreate: subAgentReplies(bodies),
      }),
    });
    for await (const event of turn.stream()) void event;

    expect(bodies[1]).toMatchObject({ max_tokens: 128, reasoning_effort: 'low' });
    expect(bodies[1]).not.toHaveProperty('temperature');
  });

  it('keeps an unplaced subagent of a named model on the spec params', async () => {
    const { session } = await createSession({ name: SPEC_MODEL, params: { temperature: 0.2 } }, true);
    const bodies: LLMCreateParamsStreaming[] = [];
    const turn = await session.createTurn({
      ...turnInput(mintTestTurnId(), 'hello'),
      resolver: makeTestResolver({
        modelRouting: routing(() => undefined).deps,
        defaultModelParams: DEFAULTS,
        llmCreate: subAgentReplies(bodies),
      }),
    });
    for await (const event of turn.stream()) void event;

    expect(bodies[1]).toMatchObject({ max_tokens: 128, temperature: 0.2 });
    expect(bodies[1]).not.toHaveProperty('reasoning_effort');
  });
});
