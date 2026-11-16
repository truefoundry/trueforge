import { createLogger } from 'winston';
import { createModelRouter } from '../../../src/modelRouting/router';
import type { DecisionClient } from '../../../src/modelRouting/types';

const logger = createLogger({ silent: true });

const candidates = [
  { model: 'acct/claude-haiku-5-5', slug: 'claude-haiku-5-5', defaultEffort: 'medium', price: 0.2 },
  { model: 'acct/claude-sonnet-5-5', slug: 'claude-sonnet-5-5', defaultEffort: 'high', price: 3.6 },
];

function route(decision: DecisionClient, mode: 'shadow' | 'on') {
  const routeModel = createModelRouter({
    mode,
    listCandidates: () => Promise.resolve(candidates),
    decision,
    timeoutMs: 1_000,
    maxCandidates: 60,
    logger,
  });
  return routeModel({
    scope: 'subagent',
    threadId: 'child',
    fallbackModel: 'acct/claude-opus-5-5',
    work: { name: 'research', text: 'Compare pricing of three CI tools.', tools: [] },
    signal: new AbortController().signal,
  });
}

const prefersHaiku: DecisionClient = {
  ask: ({ questions }) =>
    Promise.resolve(
      Object.fromEntries(
        Object.entries(questions).map(([key, question]) => [key, question.instructions.includes('Haiku') ? 0.6 : 0.3]),
      ),
    ),
};

describe('createModelRouter', () => {
  it('runs the highest yes-probability candidate in on mode', async () => {
    await expect(route(prefersHaiku, 'on')).resolves.toEqual({ model: 'acct/claude-haiku-5-5' });
  });

  it('keeps the fallback model in shadow mode', async () => {
    await expect(route(prefersHaiku, 'shadow')).resolves.toEqual({});
  });

  it('keeps the fallback model when the decision model fails', async () => {
    const failing: DecisionClient = { ask: () => Promise.reject(new Error('HTTP 403')) };
    await expect(route(failing, 'on')).resolves.toEqual({});
  });
});
