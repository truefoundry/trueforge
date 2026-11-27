import type { AgentThreadExecutionContext } from '../../../../src/core/capabilities/AgentContextProcessor';
import {
  contextCompaction,
  DEFAULT_CONTEXT_COMPACTION_THRESHOLD_TOKENS,
  resolveCompactionThresholdTokens,
} from '../../../../src/core/capabilities/builtins/ContextCompaction';
import { EventType } from '../../../../src/core/events/schema';
import { getEmptyUsage } from '../../../../src/core/llm/LLMTypes';
import type { AgentModel } from '../../../../src/core/runtime/AgentModel';
import type { ModelChoice } from '../../../../src/core/runtime/AgentThread.types';
import { makeMockILLM, TEST_MODEL_NAME } from '../../harnessMocks';

function modelWithContextLength(contextLength: number): AgentModel {
  const client = makeMockILLM({
    createNonStream: jest.fn().mockResolvedValue({
      output: { role: 'assistant', content: 'summary' },
      usage: getEmptyUsage(),
    }),
  });
  return { client, name: TEST_MODEL_NAME, properties: { contextLength } };
}

async function compactionEventTypes(
  model: AgentModel,
  contextTokens: number,
  choice: ModelChoice = 'configured',
): Promise<string[]> {
  const processor = contextCompaction({}).preLLMProcessors?.[0];
  if (processor === undefined) {
    throw new Error('expected a compaction processor');
  }
  const execution: AgentThreadExecutionContext = {
    threadId: 'main',
    currentContextUsage: { prompt_tokens: contextTokens, completion_tokens: 0 },
    context: [{ role: 'user', content: 'hello' }],
    model,
    choice,
  };
  const types: string[] = [];
  for await (const output of processor.processPreLLM(execution)) {
    types.push(output.type);
  }
  return types;
}

describe('contextCompaction', () => {
  it('compacts against the context length of the model the thread runs on now', async () => {
    const small = modelWithContextLength(10_000);
    const large = modelWithContextLength(1_000_000);

    expect(await compactionEventTypes(large, 50_000)).toEqual([]);
    expect(large.client.createNonStream).not.toHaveBeenCalled();

    expect(await compactionEventTypes(small, 50_000)).toEqual([
      EventType.THREAD_CONTEXT_COMPACTION_STARTED,
      EventType.THREAD_CONTEXT_COMPACTION_FINISHED,
      EventType.AGENT_CONTEXT_OVERWRITE,
    ]);
    expect(small.client.createNonStream).toHaveBeenCalledTimes(1);
    expect(small.client.createNonStream).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: {
          'tfg.thread_id': 'main',
          'tfg.compaction': 'true',
        },
      }),
    );
  });

  it.each(['routed', 'carried'] as const)('tags the compaction call auto when the model was %s', async choice => {
    const model = modelWithContextLength(10_000);

    await compactionEventTypes(model, 50_000, choice);

    expect(model.client.createNonStream).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: {
          'tfg.thread_id': 'main',
          'tfg.compaction': 'true',
          'tfg.model_selection': 'auto',
        },
      }),
    );
  });
});

describe('resolveCompactionThresholdTokens', () => {
  it('prefers an explicit input-token trigger', () => {
    expect(
      resolveCompactionThresholdTokens({
        compactionThresholdTokens: 80_000,
        modelContextLength: 200_000,
        modelParams: { max_tokens: 150_000 },
      }),
    ).toBe(80_000);
  });

  it('defaults to 80% of the model context length', () => {
    expect(
      resolveCompactionThresholdTokens({
        compactionThresholdTokens: undefined,
        modelContextLength: 128_001,
        modelParams: undefined,
      }),
    ).toBe(102_400);
  });

  it.each([
    { modelParams: { max_tokens: 32_768 }, name: 'max_tokens' },
    { modelParams: { max_completion_tokens: 32_768 }, name: 'max_completion_tokens' },
  ])('reserves the configured $name output budget', ({ modelParams }) => {
    expect(
      resolveCompactionThresholdTokens({
        compactionThresholdTokens: undefined,
        modelContextLength: 128_000,
        modelParams,
      }),
    ).toBe(95_232);
  });

  it('prefers max_completion_tokens over max_tokens', () => {
    expect(
      resolveCompactionThresholdTokens({
        compactionThresholdTokens: undefined,
        modelContextLength: 128_000,
        modelParams: { max_completion_tokens: 32_768, max_tokens: 64_000 },
      }),
    ).toBe(95_232);
  });

  it('keeps the 80% threshold when it already leaves enough output budget', () => {
    expect(
      resolveCompactionThresholdTokens({
        compactionThresholdTokens: undefined,
        modelContextLength: 128_000,
        modelParams: { max_tokens: 16_000 },
      }),
    ).toBe(102_400);
  });

  it.each([
    { modelParams: { max_tokens: 128_000 }, name: 'max_tokens equal to the context length' },
    { modelParams: { max_completion_tokens: 200_000 }, name: 'max_completion_tokens above the context length' },
    { modelParams: { max_tokens: 127_999.5 }, name: 'max_tokens leaving less than one whole input token' },
  ])('falls back to the 80% threshold when $name leaves no input budget', ({ modelParams }) => {
    expect(
      resolveCompactionThresholdTokens({
        compactionThresholdTokens: undefined,
        modelContextLength: 128_000,
        modelParams,
      }),
    ).toBe(102_400);
  });

  it('falls back to 50K when the model context length is unknown', () => {
    expect(
      resolveCompactionThresholdTokens({
        compactionThresholdTokens: undefined,
        modelContextLength: undefined,
        modelParams: { max_tokens: 32_768 },
      }),
    ).toBe(DEFAULT_CONTEXT_COMPACTION_THRESHOLD_TOKENS);
  });
});
