import { ModelProviderError } from '../../../src/core/errors';
import type { ILLM } from '../../../src/core/llm/ILLM';
import { AgentThread } from '../../../src/core/runtime/AgentThread';
import { NOOP_AGENT_TRACING } from '../../../src/core/tracing/NoopAgentTracing';
import '../harnessMocks';
import { makeSilentLogger, TEST_MODEL_NAME } from '../harnessMocks';

class RateLimited extends Error {
  readonly statusCode = 429;
}

function failingClient(error: unknown): ILLM {
  return {
    create: () => {
      throw error;
    },
    createNonStream: jest.fn(),
  };
}

async function run(error: unknown): Promise<jest.SpyInstance> {
  const logger = makeSilentLogger();
  const errorLog = jest.spyOn(logger, 'error');
  const thread = new AgentThread({
    threadId: 'main',
    title: 'Main',
    tracing: NOOP_AGENT_TRACING,
    logger,
    definition: {
      modelClient: failingClient(error),
      modelName: TEST_MODEL_NAME,
      instruction: 'test',
      toolSets: [],
    },
    context: [{ role: 'user', content: 'hi' }],
  });
  for await (const event of thread.execute({ signal: new AbortController().signal })) {
    void event;
  }
  return errorLog;
}

describe('AgentThread execution failure', () => {
  it('reports a failure that is not a model-provider response', async () => {
    const failure = new Error('disk full');
    const errorLog = await run(failure);
    expect(errorLog).toHaveBeenCalledWith(
      'Agent thread execution failed',
      expect.objectContaining({
        reportable_error: expect.objectContaining({ error: failure }),
      }),
    );
  });

  it('does not report a model-provider failure or an HTTP client error', async () => {
    const provider = new ModelProviderError('Request failed (401): bad credentials');
    const providerLog = await run(provider);
    expect(providerLog).toHaveBeenCalledWith(
      'Agent thread execution failed',
      expect.not.objectContaining({ reportable_error: expect.anything() }),
    );

    const limited = new RateLimited('slow down');
    const limitedLog = await run(limited);
    expect(limitedLog).toHaveBeenCalledWith(
      'Agent thread execution failed',
      expect.not.objectContaining({ reportable_error: expect.anything() }),
    );
  });
});
