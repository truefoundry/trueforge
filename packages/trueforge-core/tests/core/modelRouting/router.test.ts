import { createLogger } from 'winston';
import type { Decision, IDecisionModel } from '../../../src/core/decision/IDecisionModel';
import { classificationRequest, readClassification } from '../../../src/core/modelRouting/classification';
import { routingConversation } from '../../../src/core/modelRouting/conversation';
import {
  CONVERSATION_ROUTING_INSTRUCTIONS,
  DEFAULT_ROUTING_QUESTION,
  ROOT_ROUTING_CATEGORIES,
  SUBAGENT_ROUTING_CATEGORIES,
  TASK_ROUTING_INSTRUCTIONS,
} from '../../../src/core/modelRouting/question';
import { createModelRouter, selectModel, type RoutableModel } from '../../../src/core/modelRouting/router';
import type { ContextMessage } from '../../../src/core/runtime/AgentThread.types';
import { internalSystemMessage } from '../../../src/core/runtime/contextUtils';
import { buildUploadedFilesAnnouncement } from '../../../src/core/runtime/UserInputMessage';

const logger = createLogger({ silent: true });

const models: RoutableModel[] = [
  { name: 'a/claude-sonnet-5-5', canonicalModel: 'anthropic/claude-sonnet-5-5', cost: 4 },
  { name: 'a/claude-haiku-5-5', canonicalModel: 'anthropic/claude-haiku-5-5', cost: 0.5 },
  { name: 'b/claude-haiku-5-5', canonicalModel: 'anthropic/claude-haiku-5-5', cost: 0.2 },
  { name: 'a/gpt-6-luna', canonicalModel: 'openai/gpt-6-luna', cost: undefined },
  { name: 'a/claude-fable-5-2', canonicalModel: 'anthropic/claude-fable-5-2', cost: 1 },
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

  it('gives a cost tie to the lower effort', () => {
    expect(selectModel({ category: 'direct', models })?.routed).toEqual({
      model: 'b/claude-haiku-5-5',
      effort: 'low',
    });
  });

  it('puts models without a cost last', () => {
    const withoutCostFirst = [models[3], models[0]].filter(model => model !== undefined);
    expect(selectModel({ category: 'fixed_steps', models: withoutCostFirst })?.routed.model).toBe(
      'a/claude-sonnet-5-5',
    );
  });

  it('returns nothing when the user has none of the cluster models', () => {
    expect(selectModel({ category: 'adaptive', models: haikuOnly })).toBeUndefined();
  });

  it('picks the cheapest pair in the frontier cluster', () => {
    expect(selectModel({ category: 'frontier', models })?.routed).toEqual({
      model: 'a/claude-fable-5-2',
      effort: 'medium',
    });
  });

  it('offers a model at max effort to frontier as well as adaptive when it is in both clusters', () => {
    const sonnet = models.filter(model => model.canonicalModel === 'anthropic/claude-sonnet-5-5');
    expect(selectModel({ category: 'frontier', models: sonnet })?.routed).toEqual({
      model: 'a/claude-sonnet-5-5',
      effort: 'max',
    });
    expect(selectModel({ category: 'adaptive', models: sonnet })?.routed).toEqual({
      model: 'a/claude-sonnet-5-5',
      effort: 'high',
    });
  });

  it('returns nothing for frontier when the user has no frontier model', () => {
    expect(selectModel({ category: 'frontier', models: haikuOnly })).toBeUndefined();
  });
});

describe('createModelRouter', () => {
  const routeInput = {
    threadId: 'child',
    input: 'Name: research\n\nTask:\nCompare pricing of three CI tools.',
    instructions: TASK_ROUTING_INSTRUCTIONS,
    categories: SUBAGENT_ROUTING_CATEGORIES,
  };

  function route(classifier: IDecisionModel, listModels = () => Promise.resolve(models)) {
    return createModelRouter(
      {
        classifier: () => Promise.resolve({ client: classifier, properties: { contextLength: 16_000 } }),
        question: DEFAULT_ROUTING_QUESTION,
        listModels,
      },
      logger,
    )(routeInput);
  }

  it("routes to the classified cluster's cheapest pair", async () => {
    const create = jest.fn(() => Promise.resolve(decisionFor('fixed_steps')));
    await expect(route({ create })).resolves.toEqual({ model: 'b/claude-haiku-5-5', effort: 'high' });
    expect(create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: { 'tfg.thread_id': 'child', 'tfg.model_selection': 'fixed' },
      }),
    );
  });

  it('routes to the frontier cluster when the caller offers it', async () => {
    const rootRoute = createModelRouter(
      {
        classifier: () => Promise.resolve({ client: classifiesAs('frontier'), properties: { contextLength: 16_000 } }),
        question: DEFAULT_ROUTING_QUESTION,
        listModels: () => Promise.resolve(models),
      },
      logger,
    );
    await expect(rootRoute({ ...routeInput, categories: ROOT_ROUTING_CATEGORIES })).resolves.toEqual({
      model: 'a/claude-fable-5-2',
      effort: 'medium',
    });
  });

  it('picks nothing when the classifier answers a category the caller did not offer', async () => {
    await expect(route(classifiesAs('frontier'))).resolves.toBeUndefined();
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

  it('picks nothing when listing models fails while the classifier is still starting', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => {
      unhandled.push(error);
    };
    process.on('unhandledRejection', onUnhandled);
    let releaseClassifier: () => void = () => undefined;
    const classifierStarted = new Promise<void>(resolve => {
      releaseClassifier = resolve;
    });
    try {
      const pending = createModelRouter(
        {
          classifier: () =>
            classifierStarted.then(() => ({
              client: classifiesAs('direct'),
              properties: { contextLength: 16_000 },
            })),
          question: DEFAULT_ROUTING_QUESTION,
          listModels: () => Promise.reject(new Error('catalog down')),
        },
        logger,
      )(routeInput);
      releaseClassifier();
      await expect(pending).resolves.toBeUndefined();
      await new Promise<void>(resolve => {
        setImmediate(resolve);
      });
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('lists the models once per router', async () => {
    const listModels = jest.fn(() => Promise.resolve(models));
    const routeModel = createModelRouter(
      {
        classifier: () => Promise.resolve({ client: classifiesAs('direct'), properties: { contextLength: 16_000 } }),
        question: DEFAULT_ROUTING_QUESTION,
        listModels,
      },
      logger,
    );
    await routeModel(routeInput);
    await routeModel(routeInput);
    expect(listModels).toHaveBeenCalledTimes(1);
  });
});

describe('classification', () => {
  it('keeps the start and the end of a task that exceeds the context window', () => {
    const task = `START${'x'.repeat(20_000)}END`;
    const { body, isTruncated } = classificationRequest({
      input: task,
      question: DEFAULT_ROUTING_QUESTION,
      instructions: TASK_ROUTING_INSTRUCTIONS,
      categories: SUBAGENT_ROUTING_CATEGORIES,
      contextLength: 4_000,
    });
    expect(isTruncated).toBe(true);
    expect(typeof body.input === 'string' && body.input.length <= 16_000).toBe(true);
    expect(body.input).toEqual(expect.stringMatching(/^START[\s\S]*END$/));
  });

  it('leaves a task inside the context window unchanged', () => {
    const task = `START${'x'.repeat(20_000)}END`;
    const { body, isTruncated } = classificationRequest({
      input: task,
      question: DEFAULT_ROUTING_QUESTION,
      instructions: TASK_ROUTING_INSTRUCTIONS,
      categories: SUBAGENT_ROUTING_CATEGORIES,
      contextLength: 64_000,
    });
    expect(isTruncated).toBe(false);
    expect(body.input).toBe(task);
  });

  it('keeps the newest messages of a conversation that fit, and asks about the latest one', () => {
    const conversation = Array.from({ length: 50 }, (_, index) => ({
      role: 'user' as const,
      content: `message ${String(index)} ${'x'.repeat(1_000)}`,
    }));
    const { body, isTruncated } = classificationRequest({
      input: conversation,
      question: DEFAULT_ROUTING_QUESTION,
      instructions: CONVERSATION_ROUTING_INSTRUCTIONS,
      categories: SUBAGENT_ROUTING_CATEGORIES,
      contextLength: 4_000,
    });
    expect(isTruncated).toBe(true);
    expect(Array.isArray(body.input) && body.input.length < conversation.length).toBe(true);
    expect(Array.isArray(body.input) && body.input.at(-1)).toEqual(conversation.at(-1));
    expect(body.questions[0]).toEqual(expect.objectContaining({ instructions: CONVERSATION_ROUTING_INSTRUCTIONS }));
  });

  it('offers only the categories the caller allows, in the question order', () => {
    const offered = (categories: typeof ROOT_ROUTING_CATEGORIES) => {
      const question = classificationRequest({
        input: 'task',
        question: DEFAULT_ROUTING_QUESTION,
        instructions: TASK_ROUTING_INSTRUCTIONS,
        categories,
        contextLength: 16_000,
      }).body.questions[0];
      return question !== undefined && 'choices' in question ? question.choices.map(choice => choice.value) : [];
    };
    expect(offered(ROOT_ROUTING_CATEGORIES)).toEqual(['direct', 'fixed_steps', 'adaptive', 'frontier']);
    expect(offered(SUBAGENT_ROUTING_CATEGORIES)).toEqual(['direct', 'fixed_steps', 'adaptive']);
  });

  it('reads the category, or nothing when the decision has none', () => {
    expect(readClassification(decisionFor('fixed_steps'))?.category).toBe('fixed_steps');
    expect(readClassification(decisionFor())).toBeUndefined();
  });
});

describe('routingConversation', () => {
  it('keeps user and assistant text in order, without tool calls or results, then the latest input', () => {
    const context = [
      { role: 'user', content: 'Find the failing test' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'run', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'call-1', content: 'FAIL auth.test.ts' },
      { role: 'assistant', content: 'auth.test.ts fails on token expiry.' },
    ] as unknown as ContextMessage[];
    expect(routingConversation(context, [{ type: 'user.message', content: 'Fix it' }])).toEqual([
      { role: 'user', content: 'Find the failing test' },
      { role: 'assistant', content: 'auth.test.ts fails on token expiry.' },
      { role: 'user', content: 'Fix it' },
    ]);
  });

  it('skips internal system messages and names attachments instead of inlining them', () => {
    const context: ContextMessage[] = [
      internalSystemMessage('User memory: prefers short answers'),
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Look at this' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,YQ==' } },
          { type: 'file', file: { filename: 'spec.pdf', file_data: 'data:application/pdf;base64,YQ==' } },
          {
            type: 'text',
            text: buildUploadedFilesAnnouncement([
              { filename: 'report.csv', path: '/sandbox/report.csv', mime: 'text/csv', size: 4 },
            ]),
          },
        ],
      },
    ];
    expect(
      routingConversation(context, [
        {
          type: 'user.message',
          content: [
            { type: 'text', text: 'Fix this' },
            { type: 'file', name: 'notes.txt', data: 'data:text/plain;base64,YQ==' },
          ],
        },
      ]),
    ).toEqual([
      {
        role: 'user',
        content:
          'Look at this\n[attached image: image/png]\n[attached file: spec.pdf, application/pdf]\n[attached file: report.csv, text/csv]',
      },
      { role: 'user', content: 'Fix this\n[attached file: notes.txt, text/plain]' },
    ]);
  });
});
