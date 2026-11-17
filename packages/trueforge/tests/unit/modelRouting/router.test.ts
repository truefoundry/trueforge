import type { Decision, IDecisionModel } from '@truefoundry/trueforge-core/core';
import { createLogger } from 'winston';
import { createModelRouter } from '../../../src/modelRouting/router';
import type { RoutingCandidate } from '../../../src/modelRouting/types';

const logger = createLogger({ silent: true });

const candidates: RoutingCandidate[] = [
  { model: 'acct/claude-haiku-5-5', canonicalModel: 'anthropic/claude-haiku-5-5', price: 0.2 },
  { model: 'other/claude-sonnet-5-5', canonicalModel: 'anthropic/claude-sonnet-5-5', price: 4 },
  { model: 'acct/claude-sonnet-5-5', canonicalModel: 'anthropic/claude-sonnet-5-5', price: 4 },
];

function classifiesAs(category: string): IDecisionModel {
  const decision: Decision = {
    model: 'jev',
    answers: [
      {
        type: 'choice',
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
  return { create: () => Promise.resolve(decision) };
}

function route(
  decision: IDecisionModel,
  listCandidates: () => Promise<RoutingCandidate[]> = () => Promise.resolve(candidates),
) {
  const routeModel = createModelRouter({ listCandidates, decision, timeoutMs: 1_000, logger });
  return routeModel({
    threadId: 'child',
    fallbackModel: 'acct/claude-opus-5-5',
    task: { name: 'research', instructions: 'Compare pricing of three CI tools.' },
    signal: new AbortController().signal,
  });
}

describe('createModelRouter', () => {
  it("runs the category's model, on the parent model's account when it has one", async () => {
    await expect(route(classifiesAs('fixed_steps'))).resolves.toEqual({ model: 'acct/claude-sonnet-5-5' });
  });

  it("keeps the fallback model when the caller doesn't have the category's model", async () => {
    await expect(route(classifiesAs('adaptive'))).resolves.toEqual({});
  });

  it('keeps the fallback model when listing candidates outlasts the timeout', async () => {
    jest.useFakeTimers();
    try {
      const pending = route(classifiesAs('direct'), () => new Promise(() => undefined));
      await jest.advanceTimersByTimeAsync(1_000);
      await expect(pending).resolves.toEqual({});
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps the fallback model when the decision model fails', async () => {
    const failing: IDecisionModel = { create: () => Promise.reject(new Error('HTTP 403')) };
    await expect(route(failing)).resolves.toEqual({});
  });
});
