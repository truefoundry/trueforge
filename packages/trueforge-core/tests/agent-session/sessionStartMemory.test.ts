import type { ChatCompletionMessageParam } from 'openai/resources/chat';
import { MAIN_THREAD_ID } from '../../src/agent-session/models/TurnRecord';
import { EventType } from '../../src/agent-session/schemas/events';
import { Sessions } from '../../src/agent-session/Sessions';
import { InMemorySessionStore } from '../../src/agent-session/store/InMemorySessionStore';
import { TurnResourceResolver } from '../../src/agent-session/TurnResourceResolver';
import { memory } from '../../src/core/capabilities/builtins/Memory';
import type { LLMCreateParamsStreaming } from '../../src/core/llm/ILLM';
import { isInternalSystemMessage } from '../../src/core/runtime/contextUtils';
import {
  emptyLlmStream,
  makeAgentSpec,
  makeMockILLM,
  makeSilentLogger,
  mintTestTurnId,
  TEST_ACTIVE_EXECUTOR_ID,
} from './testHelpers';

const SUMMARY = 'user-1 is vegetarian.';
const unusedMemory = { search: () => Promise.resolve([]), add: () => Promise.resolve() };

function resolverWith(sessionStartMemory: string | undefined, requests: ChatCompletionMessageParam[][]) {
  const llm = makeMockILLM({
    create: jest.fn().mockImplementation((body: LLMCreateParamsStreaming) => {
      requests.push(body.messages);
      return emptyLlmStream();
    }),
  });
  return new TurnResourceResolver({
    llm: () => Promise.resolve({ modelClient: llm, defaultModelParams: {}, providerType: undefined }),
    mcp: () => Promise.reject(new Error('unused')),
    mcpRequestTimeoutMs: 1_000,
    mcpConnectTimeoutMs: 1_000,
    logger: makeSilentLogger(),
    rootCapabilities: () => [memory({ scopedMemory: unusedMemory, sessionStartMemory })],
  });
}

describe('session-start memory', () => {
  it('loads before the first user message, replays at the same position, and stays out of events', async () => {
    const store = new InMemorySessionStore();
    const session = await new Sessions({ sessionStore: store }).create({
      tenant_id: 'tenant-1',
      session_id: 's1',
      created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
      agent: { type: 'inline', spec: makeAgentSpec() },
      external_id: null,
    });
    const requests: ChatCompletionMessageParam[][] = [];
    const runTurn = async (content: string, sessionStartMemory: string | undefined) => {
      const turn = await session.createTurn({
        turn_id: mintTestTurnId(),
        active_executor_id: TEST_ACTIVE_EXECUTOR_ID,
        input: [{ type: EventType.USER_MESSAGE, content }],
        previous_turn_id: 'auto',
        signal: new AbortController().signal,
        resolver: resolverWith(sessionStartMemory, requests),
      });
      for await (const event of turn.stream()) {
        void event;
      }
      return turn;
    };

    const first = await runTurn('hi', SUMMARY);
    const later = await runTurn('again', undefined);

    const [firstRequest = [], laterRequest = []] = requests;
    expect(firstRequest.map(m => m.role)).toEqual(['system', 'user', 'user']);
    const [systemPrompt, memoryMessage, userMessage] = firstRequest;
    expect(JSON.stringify(systemPrompt)).not.toContain(SUMMARY);
    expect(memoryMessage?.content).toEqual(expect.stringContaining('<tfy-internal>User memory'));
    expect(memoryMessage?.content).toEqual(expect.stringContaining(SUMMARY));
    expect(userMessage).toMatchObject({ role: 'user', content: 'hi' });

    expect(laterRequest.slice(0, 3)).toEqual(firstRequest);
    expect(laterRequest.filter(m => JSON.stringify(m).includes(SUMMARY))).toHaveLength(1);
    const stored = await store.getTurn({ session_id: 's1', turn_id: later.id });
    expect(stored?.snapshot.threads[MAIN_THREAD_ID]?.context.filter(isInternalSystemMessage)).toHaveLength(1);

    for (const turn of [first, later]) {
      const { data } = await turn.listEvents({ limit: 50 });
      expect(JSON.stringify(data)).not.toContain(SUMMARY);
    }
  });
});
