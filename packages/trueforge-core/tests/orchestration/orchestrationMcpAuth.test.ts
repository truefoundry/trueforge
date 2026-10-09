import { EventType, newEventId } from '../../src/core/events/schema';
import type { IToolSet } from '../../src/core/mcp/IMCPServer';
import { AgentThread } from '../../src/core/runtime/AgentThread';
import { InternalEventType, type AgentThreadConstructorInput } from '../../src/core/runtime/AgentThread.types';
import { AgentThreadOrchestrator } from '../../src/core/runtime/AgentThreadOrchestrator';
import { NOOP_AGENT_TRACING } from '../../src/core/tracing/NoopAgentTracing';
import { withTimeout } from '../../src/core/util/promiseUtils';
import { makeSilentLogger } from '../core/harnessMocks';
import { textReplyStream } from './helpers/helpers';

function makeAuthBlockedThread(threadId: string): AgentThread {
  const authToolSet: IToolSet = {
    id: `oauth-${threadId}`,
    name: `oauth-${threadId}`,
    preload: true,
    hasPreloadedTools: true,
    listTools: jest
      .fn()
      .mockResolvedValueOnce({
        authRequired: {
          servers: [{ id: `oauth-${threadId}`, name: `oauth-${threadId}`, auth_url: 'https://auth.example' }],
        },
      })
      .mockResolvedValue({ result: { tools: [] }, wasInitialized: undefined }),
    callTool: jest.fn(),
    toolCallInfo: jest.fn(),
    setApprovalPolicy: jest.fn(),
    getApprovalPolicies: jest.fn(() => ({})),
    hasApplicableApprovalPolicy: jest.fn(() => false),
  };
  const input: AgentThreadConstructorInput = {
    definition: {
      modelClient: {
        create: jest.fn(() => textReplyStream(`${threadId} done`)),
        createNonStream: jest.fn(),
      },
      instruction: undefined,
      messages: [{ role: 'user', content: 'continue' }],
      modelParams: undefined,
      responseFormat: undefined,
      iterationLimit: undefined,
      toolSets: undefined,
    },
    threadId,
    title: threadId,
    parent: undefined,
    agentInfo: undefined,
    context: undefined,
    currentContextUsage: undefined,
    preComputedCompletion: undefined,
    sandbox: undefined,
    capabilities: [{ systemToolSets: [authToolSet] }],
    capabilityState: undefined,
    tracing: NOOP_AGENT_TRACING,
    logger: makeSilentLogger(),
  };
  return new AgentThread(input);
}

describe('orchestration: MCP auth continuation', () => {
  it('clears every blocked thread and emits one continue per submitted event', async () => {
    const first = makeAuthBlockedThread('first');
    const second = makeAuthBlockedThread('second');
    const orchestrator = new AgentThreadOrchestrator({
      agentThreads: new Map([
        [first.threadId, first],
        [second.threadId, second],
      ]),
      createDynamicSubAgentThread: () => Promise.reject(new Error('unexpected sub-agent')),
      tracing: NOOP_AGENT_TRACING,
      logger: makeSilentLogger(),
    });
    const iterator = orchestrator.execute({ signal: new AbortController().signal });

    const initialEvents = [];
    let paused = await withTimeout(iterator.next(), 1_000, 'initial MCP-auth event');
    while (
      !paused.done &&
      !(paused.value.type === InternalEventType.TURN_STATE && paused.value.transition.status === 'paused')
    ) {
      initialEvents.push(paused.value);
      paused = await withTimeout(iterator.next(), 1_000, 'initial MCP-auth pause');
    }
    expect(initialEvents.filter(event => event.type === InternalEventType.MCP_AUTH_REQUIRED)).toHaveLength(2);
    expect(paused.done).toBe(false);

    const waiting = iterator.next();
    const submitted = [
      { type: EventType.USER_MCP_AUTH_CONTINUE, id: newEventId(), created_at: new Date().toISOString() },
      { type: EventType.USER_MCP_AUTH_CONTINUE, id: newEventId(), created_at: new Date().toISOString() },
    ] as const;
    for await (const _accepted of orchestrator.send([...submitted])) {
      void _accepted;
    }
    orchestrator.wake();

    const emitted = [];
    let step = await withTimeout(waiting, 1_000, 'first MCP auth continue');
    while (!step.done && step.value.type === InternalEventType.MCP_AUTH_CONTINUE) {
      emitted.push(step.value);
      step = await withTimeout(iterator.next(), 1_000, 'next MCP auth continue');
    }

    expect(emitted).toHaveLength(submitted.length);
    expect(emitted.map(event => event.event.id)).toEqual(submitted.map(event => event.id));
    // First continue clears every auth-waiting thread; the second finds none left.
    expect(emitted[0]?.thread_ids).toEqual(['first', 'second']);
    expect(emitted[1]?.thread_ids).toEqual([]);
    expect(first.toSnapshot().pending_mcp_auth).toBe(false);
    expect(second.toSnapshot().pending_mcp_auth).toBe(false);
    expect(step).toMatchObject({
      done: false,
      value: { type: InternalEventType.TURN_STATE, transition: { status: 'running' } },
    });

    while (!step.done) {
      step = await withTimeout(iterator.next(), 1_000, 'MCP-auth resumed completion');
    }
    expect(first.definition.modelClient.create).toHaveBeenCalledTimes(1);
    expect(second.definition.modelClient.create).toHaveBeenCalledTimes(1);
  });
});
