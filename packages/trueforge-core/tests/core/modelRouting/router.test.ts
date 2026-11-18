import { createLogger } from 'winston';
import type { Decision, IDecisionModel } from '../../../src/core/decision/IDecisionModel';
import { classificationRequest, readClassification } from '../../../src/core/modelRouting/classification';
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

function decisionFor(category?: string): Decision {
  return {
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
}

function classifiesAs(category?: string): IDecisionModel {
  return { create: () => Promise.resolve(decisionFor(category)) };
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
  const routeInput = { threadId: 'child', input: 'Name: research\n\nTask:\nCompare pricing of three CI tools.' };

  function route(classifier: IDecisionModel, listModels = () => Promise.resolve(models)) {
    return createModelRouter({
      classifier,
      question: DEFAULT_ROUTING_QUESTION,
      listModels,
      timeoutMs: 1_000,
      logger,
    })({ ...routeInput, signal: new AbortController().signal });
  }

  it("routes to the classified cluster's cheapest pair", async () => {
    await expect(route(classifiesAs('fixed_steps'))).resolves.toEqual({ model: 'b/claude-haiku-5-5', effort: 'high' });
  });

  it('picks nothing for an unknown category', async () => {
    await expect(route(classifiesAs('unknown'))).resolves.toBeUndefined();
  });

  it('picks nothing when the decision has no category', async () => {
    await expect(route(classifiesAs())).resolves.toBeUndefined();
  });

  it("picks nothing when the user has none of the cluster's models", async () => {
    await expect(route(classifiesAs('adaptive'), () => Promise.resolve(haikuOnly))).resolves.toBeUndefined();
  });

  it('picks nothing when the classifier fails', async () => {
    await expect(route({ create: () => Promise.reject(new Error('HTTP 403')) })).resolves.toBeUndefined();
  });

  it('picks nothing when the step outlasts the timeout', async () => {
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
    const routeModel = createModelRouter({
      classifier: classifiesAs('direct'),
      question: DEFAULT_ROUTING_QUESTION,
      listModels,
      timeoutMs: 1_000,
      logger,
    });
    const signal = new AbortController().signal;
    await routeModel({ ...routeInput, signal });
    await routeModel({ ...routeInput, signal });
    expect(listModels).toHaveBeenCalledTimes(1);
  });
});

describe('classification', () => {
  it('asks the category and benchmark questions', () => {
    const request = classificationRequest('task', DEFAULT_ROUTING_QUESTION);
    expect(request.questions.map(question => question.name)).toEqual(['category', 'benchmark']);
  });

  it('keeps the start and the end of a long task', () => {
    const task = `START${'x'.repeat(20_000)}END`;
    const { input } = classificationRequest(task, DEFAULT_ROUTING_QUESTION);
    expect(typeof input === 'string' && input.length <= 8_000).toBe(true);
    expect(input).toEqual(expect.stringMatching(/^START[\s\S]*END$/));
  });

  it('reads the category, or nothing when the decision has none', () => {
    expect(readClassification(decisionFor('fixed_steps'))?.category).toBe('fixed_steps');
    expect(readClassification(decisionFor())).toBeUndefined();
  });
});
