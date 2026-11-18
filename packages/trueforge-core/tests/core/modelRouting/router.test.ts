import { createLogger } from 'winston';
import type { Decision, IDecisionModel } from '../../../src/core/decision/IDecisionModel';
import { DecisionRoutingClassifier } from '../../../src/core/modelRouting/DecisionRoutingClassifier';
import type { IRoutingClassifier } from '../../../src/core/modelRouting/IRoutingClassifier';
import { DEFAULT_ROUTING_QUESTION } from '../../../src/core/modelRouting/question';
import { createModelRouter, selectModel, type RoutableModel } from '../../../src/core/modelRouting/router';

const logger = createLogger({ silent: true });

const models: RoutableModel[] = [
  { model: 'a/claude-sonnet-5-5', canonicalModel: 'anthropic/claude-sonnet-5-5', price: 4 },
  { model: 'a/claude-haiku-5-5', canonicalModel: 'anthropic/claude-haiku-5-5', price: 0.5 },
  { model: 'b/claude-haiku-5-5', canonicalModel: 'anthropic/claude-haiku-5-5', price: 0.2 },
  { model: 'a/gpt-6-luna', canonicalModel: 'openai/gpt-6-luna' },
];
const haikuOnly = models.filter(model => model.canonicalModel === 'anthropic/claude-haiku-5-5');

function classifiesAs(category: string): IRoutingClassifier {
  return { classify: () => Promise.resolve({ category, details: {} }) };
}

describe('selectModel', () => {
  it('picks the cheapest pair in the cluster, across accounts', () => {
    expect(selectModel({ category: 'fixed_steps', models })?.routed).toEqual({
      model: 'b/claude-haiku-5-5',
      effort: 'high',
    });
  });

  it('gives a price tie to the lower effort', () => {
    expect(selectModel({ category: 'direct', models })?.routed).toEqual({
      model: 'b/claude-haiku-5-5',
      effort: 'low',
    });
  });

  it('puts unpriced models last', () => {
    const unpricedFirst = [models[3], models[0]].filter(model => model !== undefined);
    expect(selectModel({ category: 'fixed_steps', models: unpricedFirst })?.routed.model).toBe('a/claude-sonnet-5-5');
  });

  it('returns nothing when the user has none of the cluster models', () => {
    expect(selectModel({ category: 'adaptive', models: haikuOnly })).toBeUndefined();
  });
});

describe('createModelRouter', () => {
  const state = { threadId: 'child', name: 'research', instructions: 'Compare pricing of three CI tools.' };

  function route(classifier: IRoutingClassifier, listModels = () => Promise.resolve(models)) {
    return createModelRouter({ classifier, listModels, timeoutMs: 1_000, logger })({
      state,
      fallbackModel: 'a/claude-opus-5-5',
      signal: new AbortController().signal,
    });
  }

  it("routes to the classified cluster's cheapest pair", async () => {
    await expect(route(classifiesAs('fixed_steps'))).resolves.toEqual({ model: 'b/claude-haiku-5-5', effort: 'high' });
  });

  it('keeps the fallback model for an unknown category', async () => {
    await expect(route(classifiesAs('unknown'))).resolves.toBeUndefined();
  });

  it("keeps the fallback model when the user has none of the cluster's models", async () => {
    await expect(route(classifiesAs('adaptive'), () => Promise.resolve(haikuOnly))).resolves.toBeUndefined();
  });

  it('keeps the fallback model when the classifier fails', async () => {
    await expect(route({ classify: () => Promise.reject(new Error('HTTP 403')) })).resolves.toBeUndefined();
  });

  it('keeps the fallback model when the step outlasts the timeout', async () => {
    jest.useFakeTimers();
    try {
      const pending = route(classifiesAs('direct'), () => new Promise(() => undefined));
      await jest.advanceTimersByTimeAsync(1_000);
      await expect(pending).resolves.toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('lists the models once per router', async () => {
    const listModels = jest.fn(() => Promise.resolve(models));
    const routeModel = createModelRouter({ classifier: classifiesAs('direct'), listModels, timeoutMs: 1_000, logger });
    const signal = new AbortController().signal;
    await routeModel({ state, fallbackModel: 'a/claude-opus-5-5', signal });
    await routeModel({ state, fallbackModel: 'a/claude-opus-5-5', signal });
    expect(listModels).toHaveBeenCalledTimes(1);
  });
});

describe('DecisionRoutingClassifier', () => {
  function decisionAnswering(category?: string): IDecisionModel {
    const decision: Decision = {
      model: 'jev',
      answers:
        category === undefined
          ? []
          : [
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
    return { create: jest.fn(() => Promise.resolve(decision)) };
  }

  it('asks the category and benchmark questions and returns the category', async () => {
    const decision = decisionAnswering('fixed_steps');
    const classifier = new DecisionRoutingClassifier({ decision, question: DEFAULT_ROUTING_QUESTION });
    const result = await classifier.classify(
      { threadId: 'child', name: 'research', instructions: 'task' },
      new AbortController().signal,
    );
    expect(result.category).toBe('fixed_steps');
    const body = jest.mocked(decision.create).mock.calls[0]?.[0];
    expect(body?.questions.map(question => question.name)).toEqual(['category', 'benchmark']);
  });

  it('fails when the decision has no category', async () => {
    const classifier = new DecisionRoutingClassifier({
      decision: decisionAnswering(),
      question: DEFAULT_ROUTING_QUESTION,
    });
    await expect(
      classifier.classify({ threadId: 'child', instructions: 'task' }, new AbortController().signal),
    ).rejects.toThrow('no category');
  });
});
