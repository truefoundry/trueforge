import type { Decision, IDecisionModel } from '@truefoundry/trueforge-core/core';
import { createLogger } from 'winston';
import type { RoutingClusters } from '../../../src/modelRouting/clusters';
import { DEFAULT_ROUTING_QUESTION } from '../../../src/modelRouting/question';
import { createModelRouter } from '../../../src/modelRouting/router';
import type { RoutingCandidate } from '../../../src/modelRouting/types';

const logger = createLogger({ silent: true });

const candidates: RoutingCandidate[] = [
  { model: 'acct/claude-haiku-5-5', canonicalModel: 'anthropic/claude-haiku-5-5', price: 0.2 },
  { model: 'other/claude-sonnet-5-5', canonicalModel: 'anthropic/claude-sonnet-5-5', price: 4 },
  { model: 'acct/claude-sonnet-5-5', canonicalModel: 'anthropic/claude-sonnet-5-5', price: 4 },
];

const clusters: RoutingClusters = {
  direct: { medium: ['anthropic/claude-haiku-5-5'] },
  fixed_steps: {
    medium: ['openai/gpt-6-luna', 'anthropic/claude-sonnet-5-5'],
    high: ['anthropic/claude-haiku-5-5'],
  },
  adaptive: { medium: ['openai/gpt-6-1-sol'] },
};

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
  options: { effort?: string; listCandidates?: () => Promise<RoutingCandidate[]> } = {},
) {
  const routeModel = createModelRouter({
    question: DEFAULT_ROUTING_QUESTION,
    clusters,
    listCandidates: options.listCandidates ?? (() => Promise.resolve(candidates)),
    decision,
    timeoutMs: 1_000,
    logger,
  });
  return routeModel({
    threadId: 'child',
    fallbackModel: 'acct/claude-opus-5-5',
    effort: options.effort,
    task: { name: 'research', instructions: 'Compare pricing of three CI tools.' },
    signal: new AbortController().signal,
  });
}

describe('createModelRouter', () => {
  it("runs the first model in the cluster the caller has, on the parent model's account", async () => {
    await expect(route(classifiesAs('fixed_steps'), { effort: 'medium' })).resolves.toEqual({
      model: 'acct/claude-sonnet-5-5',
    });
  });

  it("uses the cluster for the parent's effort", async () => {
    await expect(route(classifiesAs('fixed_steps'), { effort: 'high' })).resolves.toEqual({
      model: 'acct/claude-haiku-5-5',
    });
  });

  it('uses the medium cluster when the spec sets no effort', async () => {
    await expect(route(classifiesAs('fixed_steps'))).resolves.toEqual({ model: 'acct/claude-sonnet-5-5' });
  });

  it("keeps the fallback model when there's no cluster for the parent's effort", async () => {
    await expect(route(classifiesAs('direct'), { effort: 'low' })).resolves.toEqual({});
  });

  it("keeps the fallback model when the caller has none of the cluster's models", async () => {
    await expect(route(classifiesAs('adaptive'), { effort: 'medium' })).resolves.toEqual({});
  });

  it('keeps the fallback model when listing candidates outlasts the timeout', async () => {
    jest.useFakeTimers();
    try {
      const pending = route(classifiesAs('direct'), { listCandidates: () => new Promise(() => undefined) });
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
