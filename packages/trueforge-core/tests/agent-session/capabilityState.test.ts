/**
 * plan-migration proof: tfy.plan-shaped capability fixture over InMemorySessionStore.
 * Does not migrate private Plan / overwriteAgentPlan — gateway adoption is out of scope.
 */
import type { Logger } from 'winston';
import { MAIN_THREAD_ID } from '../../src/agent-session/models/TurnRecord';
import { EventType } from '../../src/agent-session/schemas/events';
import { Sessions } from '../../src/agent-session/Sessions';
import { InMemorySessionStore } from '../../src/agent-session/store/InMemorySessionStore';
import type { AgentCapability, JsonValue } from '../../src/core/capabilities/AgentCapability';
import type { AgentContextProcessorOutput } from '../../src/core/capabilities/AgentContextProcessor';
import { AgentThread } from '../../src/core/runtime/AgentThread';
import { InternalEventType } from '../../src/core/runtime/AgentThread.types';
import { NOOP_AGENT_TRACING } from '../../src/core/tracing/NoopAgentTracing';
import {
  emptyLlmStream,
  makeAgentSpec,
  makeMockILLM,
  makeSilentLogger,
  makeTestResolver,
  mintTestTurnId,
} from './testHelpers';

function makePlanShapedCapability(options: {
  enabled: boolean;
  emitState?: JsonValue;
  onLoad?: (state: JsonValue) => void;
}): AgentCapability {
  const emitState = options.emitState;
  const processor = {
    // eslint-disable-next-line @typescript-eslint/require-await -- async generator fixture, not awaiting I/O
    async *processPreLLM(): AsyncGenerator<AgentContextProcessorOutput> {
      if (!options.enabled || !emitState) return;
      yield {
        type: InternalEventType.CAPABILITY_STATE,
        key: 'tfy.plan',
        state: emitState,
      };
    },
  };
  return {
    ...(options.enabled
      ? {
          preLLMProcessors: [processor],
          state: {
            key: 'tfy.plan',
            load(state: JsonValue) {
              options.onLoad?.(state);
            },
          },
        }
      : {}),
  };
}

describe('capability_state (tfy.plan fixture)', () => {
  const tenant = 'tenant-1';

  it('multi-turn: emit → persist → hydrate via AgentThread ctor (resolver never loads)', async () => {
    const store = new InMemorySessionStore();
    const sessions = new Sessions({ sessionStore: store });
    const session = await sessions.create({
      tenant_id: tenant,
      session_id: 's1',
      created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
      agent: { type: 'inline', spec: makeAgentSpec() },
      external_id: null,
    });

    const planV1: JsonValue = {
      todo: [{ title: 'step', description: 'do it', status: 'wip' }],
    };
    let loads: JsonValue[] = [];

    const turn1 = await session.createTurn({
      turn_id: mintTestTurnId(),
      input: [{ type: EventType.USER_MESSAGE, content: 'start' }],
      previous_turn_id: 'none',
      signal: new AbortController().signal,
      resolver: makeTestResolver({
        extraCapabilities: [
          makePlanShapedCapability({
            enabled: true,
            emitState: planV1,
            onLoad: s => loads.push(s),
          }),
        ],
      }),
    });
    for await (const event of turn1.stream()) {
      void event;
      // drain
    }
    const stored1 = await store.getTurn({
      session_id: 's1',
      turn_id: turn1.id,
    });
    expect(stored1?.snapshot.threads[MAIN_THREAD_ID]?.capability_state?.['tfy.plan']).toEqual(planV1);
    // First turn: no prior state to load
    expect(loads).toHaveLength(0);

    loads = [];
    const turn2 = await session.createTurn({
      turn_id: mintTestTurnId(),
      input: [{ type: EventType.USER_MESSAGE, content: 'continue' }],
      previous_turn_id: 'auto',
      signal: new AbortController().signal,
      resolver: makeTestResolver({
        extraCapabilities: [
          makePlanShapedCapability({
            enabled: true,
            // No emit — prove hydration alone
            onLoad: s => loads.push(s),
          }),
        ],
      }),
    });
    // Hydration happens in run() when threads are built (before stream).
    expect(loads).toEqual([planV1]);
    for await (const event of turn2.stream()) {
      void event;
      // drain
    }
    const stored2 = await store.getTurn({
      session_id: 's1',
      turn_id: turn2.id,
    });
    // Unchanged state carries via toSnapshot with zero CAPABILITY_STATE writes this turn.
    expect(stored2?.snapshot.threads[MAIN_THREAD_ID]?.capability_state?.['tfy.plan']).toEqual(planV1);
  });

  it('capability disabled → unclaimed key dropped + warn; prior turn untouched', async () => {
    const store = new InMemorySessionStore();
    const sessions = new Sessions({ sessionStore: store });
    const session = await sessions.create({
      tenant_id: tenant,
      session_id: 's1',
      created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
      agent: { type: 'inline', spec: makeAgentSpec() },
      external_id: null,
    });
    const planV1: JsonValue = {
      todo: [{ title: 'step', description: 'do it', status: 'done' }],
    };

    const turn1 = await session.createTurn({
      turn_id: mintTestTurnId(),
      input: [{ type: EventType.USER_MESSAGE, content: 'start' }],
      previous_turn_id: 'none',
      signal: new AbortController().signal,
      resolver: makeTestResolver({
        extraCapabilities: [makePlanShapedCapability({ enabled: true, emitState: planV1 })],
      }),
    });
    for await (const event of turn1.stream()) {
      void event;
      // drain
    }

    const logger = makeSilentLogger();
    const warnSpy = jest.spyOn(logger, 'warn');
    const resolver = makeTestResolver({
      extraCapabilities: [makePlanShapedCapability({ enabled: false })],
    });
    // Override logger so AgentThread child warn is observable — wrap resolver to use our logger.
    const wrapped = {
      ...resolver,
      get logger(): Logger {
        return logger;
      },
      createTracing: () => resolver.createTracing(),
      resolveAgentSpec: (input: Parameters<typeof resolver.resolveAgentSpec>[0]) => resolver.resolveAgentSpec(input),
      resolveSandbox: (input: Parameters<typeof resolver.resolveSandbox>[0]) => resolver.resolveSandbox(input),
      resolveAgentDefinition: (input: Parameters<typeof resolver.resolveAgentDefinition>[0]) =>
        resolver.resolveAgentDefinition(input),
      close: () => resolver.close(),
    };

    const turn3 = await session.createTurn({
      turn_id: mintTestTurnId(),
      input: [{ type: EventType.USER_MESSAGE, content: 'no plan' }],
      previous_turn_id: 'auto',
      signal: new AbortController().signal,
      resolver: wrapped,
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Dropping unclaimed capability_state key 'tfy.plan'"));

    for await (const event of turn3.stream()) {
      void event;
      // drain
    }
    const prior = await store.getTurn({
      session_id: 's1',
      turn_id: turn1.id,
    });
    expect(prior?.snapshot.threads[MAIN_THREAD_ID]?.capability_state?.['tfy.plan']).toEqual(planV1);

    const latest = await store.getTurn({
      session_id: 's1',
      turn_id: turn3.id,
    });
    expect(latest?.snapshot.threads[MAIN_THREAD_ID]?.capability_state?.['tfy.plan']).toBeUndefined();
  });

  it('CAPABILITY_STATE with undefined state surfaces capability_state_error at persist boundary', async () => {
    const undefinedStateCapability: AgentCapability = {
      state: {
        key: 'tfy.plan',
        load: () => {
          /* no-op */
        },
      },
      preLLMProcessors: [
        {
          // eslint-disable-next-line @typescript-eslint/require-await -- async generator fixture, not awaiting I/O
          async *processPreLLM(): AsyncGenerator<AgentContextProcessorOutput> {
            yield {
              type: InternalEventType.CAPABILITY_STATE,
              key: 'tfy.plan',
              // @ts-expect-error intentional runtime undefined past the JsonValue contract
              state: undefined,
            };
          },
        },
      ],
    };
    const store = new InMemorySessionStore();
    const sessions = new Sessions({ sessionStore: store });
    const session = await sessions.create({
      tenant_id: tenant,
      session_id: 's1',
      created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
      agent: { type: 'inline', spec: makeAgentSpec() },
      external_id: null,
    });
    const turn = await session.createTurn({
      turn_id: mintTestTurnId(),
      input: [{ type: EventType.USER_MESSAGE, content: 'x' }],
      previous_turn_id: 'none',
      signal: new AbortController().signal,
      resolver: makeTestResolver({ extraCapabilities: [undefinedStateCapability] }),
    });
    let errorMessage: string | undefined;
    for await (const event of turn.stream()) {
      if (event.type === EventType.TURN_DONE && event.state.status === 'error') {
        errorMessage = event.state.message;
      }
    }
    expect(errorMessage).toContain('CAPABILITY_STATE');
    expect(errorMessage).toContain('undefined');
    expect(errorMessage).toContain('null');
  });

  it('emit with undeclared key surfaces capability_state_error (emit-key guard)', async () => {
    const badCapability: AgentCapability = {
      state: {
        key: 'tfy.plan',
        load: () => {
          /* no-op */
        },
      },
      preLLMProcessors: [
        {
          // eslint-disable-next-line @typescript-eslint/require-await -- async generator fixture, not awaiting I/O
          async *processPreLLM(): AsyncGenerator<AgentContextProcessorOutput> {
            yield {
              type: InternalEventType.CAPABILITY_STATE,
              key: 'tfy.other',
              state: {},
            };
          },
        },
      ],
    };
    const thread = new AgentThread({
      definition: {
        modelClient: makeMockILLM({ create: jest.fn().mockImplementation(() => emptyLlmStream()) }),
      },
      threadId: MAIN_THREAD_ID,
      title: 'main',
      capabilities: [badCapability],
      tracing: NOOP_AGENT_TRACING,
      logger: makeSilentLogger(),
    });
    for await (const event of thread.send([{ type: EventType.USER_MESSAGE, content: 'x' }])) {
      void event;
      // drain send
    }
    let errorMessage: string | undefined;
    for await (const event of thread.execute({ signal: new AbortController().signal })) {
      if (event.type === InternalEventType.AGENT_DONE && event.status === 'error') {
        errorMessage = event.error;
      }
    }
    expect(errorMessage).toContain('CAPABILITY_STATE');
    expect(errorMessage).toContain('tfy.other');
  });
});
