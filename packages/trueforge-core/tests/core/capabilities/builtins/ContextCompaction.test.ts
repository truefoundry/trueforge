import {
  ContextCompaction,
  DEFAULT_CONTEXT_COMPACTION_THRESHOLD_TOKENS,
  resolveCompactionThresholdTokens,
} from '../../../../src/core/capabilities/builtins/ContextCompaction';
import { EventType } from '../../../../src/core/events/schema';
import { makeMockILLM } from '../../harnessMocks';

describe('resolveCompactionThresholdTokens', () => {
  it('prefers an explicit input-token trigger', () => {
    expect(
      resolveCompactionThresholdTokens({
        configuredThresholdTokens: 80_000,
        modelContextLength: 200_000,
        modelParams: { max_tokens: 150_000 },
      }),
    ).toBe(80_000);
  });

  it('defaults to 80% of the model context length', () => {
    expect(
      resolveCompactionThresholdTokens({
        configuredThresholdTokens: undefined,
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
        configuredThresholdTokens: undefined,
        modelContextLength: 128_000,
        modelParams,
      }),
    ).toBe(95_232);
  });

  it('prefers max_completion_tokens over max_tokens', () => {
    expect(
      resolveCompactionThresholdTokens({
        configuredThresholdTokens: undefined,
        modelContextLength: 128_000,
        modelParams: { max_completion_tokens: 32_768, max_tokens: 64_000 },
      }),
    ).toBe(95_232);
  });

  it('keeps the 80% threshold when it already leaves enough output budget', () => {
    expect(
      resolveCompactionThresholdTokens({
        configuredThresholdTokens: undefined,
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
        configuredThresholdTokens: undefined,
        modelContextLength: 128_000,
        modelParams,
      }),
    ).toBe(102_400);
  });

  it('falls back to 50K when the model context length is unknown', () => {
    expect(
      resolveCompactionThresholdTokens({
        configuredThresholdTokens: undefined,
        modelContextLength: undefined,
        modelParams: { max_tokens: 32_768 },
      }),
    ).toBe(DEFAULT_CONTEXT_COMPACTION_THRESHOLD_TOKENS);
  });
});

describe('ContextCompaction.processPreLLM', () => {
  it('emits summarization start, end, then context overwrite when over threshold', async () => {
    const usage = { input_tokens: 100, output_tokens: 20, total_tokens: 120 };
    const modelClient = makeMockILLM({
      createNonStream: jest.fn().mockResolvedValue({
        output: { role: 'assistant', content: 'summary of the conversation' },
        usage,
        finish_reason: 'stop',
      }),
    });
    const compaction = new ContextCompaction({
      modelClient,
      compactionThresholdTokens: 1,
    });

    const events = [];
    for await (const event of compaction.processPreLLM({
      threadId: 'main',
      currentContextUsage: { prompt_tokens: 10_000, completion_tokens: 0 },
      context: [{ role: 'user', content: 'hello' }],
    })) {
      events.push(event);
    }

    expect(events.map(event => event.type)).toEqual([
      EventType.AGENT_CONTEXT_SUMMARIZATION_START,
      EventType.AGENT_CONTEXT_SUMMARIZATION_END,
      EventType.AGENT_CONTEXT_OVERWRITE,
    ]);
    const reason = {
      type: 'compaction',
      context_tokens: 10_000,
      threshold_tokens: 1,
    };
    const current_context_usage = {
      prompt_tokens: usage.input_tokens + 42,
      completion_tokens: 0,
    };
    expect(events[0]).toMatchObject({ reason });
    expect(events[1]).toMatchObject({ reason, usage, current_context_usage });
    expect(events[2]).toMatchObject({
      reason: 'compaction',
      usage,
      current_context_usage,
      context: [
        { role: 'assistant', content: 'summary of the conversation' },
        expect.objectContaining({ role: 'user' }),
      ],
    });
    expect(modelClient.createNonStream).toHaveBeenCalledTimes(1);
  });

  it('emits nothing when under the compaction threshold', async () => {
    const modelClient = makeMockILLM();
    const compaction = new ContextCompaction({
      modelClient,
      compactionThresholdTokens: 100_000,
    });

    const events = [];
    for await (const event of compaction.processPreLLM({
      threadId: 'main',
      currentContextUsage: { prompt_tokens: 100, completion_tokens: 0 },
      context: [{ role: 'user', content: 'hello' }],
    })) {
      events.push(event);
    }

    expect(events).toEqual([]);
    expect(modelClient.createNonStream).not.toHaveBeenCalled();
  });
});
