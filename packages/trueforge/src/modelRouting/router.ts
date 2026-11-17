import type { RouteModelInput, RouteModelResult } from '@truefoundry/trueforge-core/agent-session';
import { type Decision, describeUnknownError, type IDecisionModel } from '@truefoundry/trueforge-core/core';
import type { Logger } from 'winston';
import type { RoutingCandidate } from './types';

const TASK_CHARS = 8_000;

const INSTRUCTIONS = 'Which category best describes what this task needs to be completed?';

/** What the decision model chooses between. Described by the task's structure, with no example tasks to match on. */
const CATEGORIES = {
  direct:
    'The answer follows directly from the task text and general knowledge, and the work is routine: no tool is needed and nothing has to be worked out carefully.',
  fixed_steps:
    'Needs tools, but the task spells out every action: one call or several independent ones, carried out as stated. Tool results are only passed along or reported, never used to decide what to do next.',
  adaptive:
    "What to do next depends on what earlier tool calls return: investigate, branch, retry or reconcile results, or plan an approach the task doesn't spell out. Also any task, with or without tools, whose result depends on careful expert reasoning, such as finding subtle faults or weighing trade-offs.",
} as const;

type Category = keyof typeof CATEGORIES;

/** One canonical model per category for now; clusters of models replace this. */
const CATEGORY_MODEL: Record<Category, string> = {
  direct: 'anthropic/claude-haiku-5-5',
  fixed_steps: 'anthropic/claude-sonnet-5-5',
  adaptive: 'openai/gpt-6-1-sol',
};

type ChoiceAnswer = Extract<Decision['answers'][number], { type: 'choice' }>;

type FallbackReason = 'decision_error' | 'decision_timeout' | 'model_unavailable';

function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && Object.hasOwn(CATEGORIES, value);
}

function clip(text: string): string {
  if (text.length <= TASK_CHARS) {
    return text;
  }
  const half = TASK_CHARS / 2;
  return `${text.slice(0, half)}\n…\n${text.slice(-half)}`;
}

function accountOf(model: string): string {
  return model.split('/', 1)[0] ?? model;
}

/** The caller's model for `canonicalModel`, preferring the fallback model's account. */
function modelFor(input: {
  canonicalModel: string;
  models: readonly RoutingCandidate[];
  fallbackModel: string;
}): RoutingCandidate | undefined {
  const fallbackAccount = accountOf(input.fallbackModel);
  return input.models
    .filter(model => model.canonicalModel === input.canonicalModel)
    .sort((a, b) => {
      const preferred = Number(accountOf(b.model) === fallbackAccount) - Number(accountOf(a.model) === fallbackAccount);
      return preferred !== 0 ? preferred : a.model.localeCompare(b.model);
    })[0];
}

function priceDirection(input: { picked?: number | undefined; fallback?: number | undefined }) {
  if (input.picked === undefined || input.fallback === undefined) {
    return undefined;
  }
  return input.picked > input.fallback ? 'up' : input.picked < input.fallback ? 'down' : 'same';
}

/**
 * `routeModel` for one turn: the decision model classifies the subagent's task, and the category picks the model.
 * Candidates are listed once and shared by the turn's subagents. Never throws.
 */
export function createModelRouter(input: {
  /** The caller's models; called once per turn. */
  listCandidates: () => Promise<RoutingCandidate[]>;
  decision: IDecisionModel;
  timeoutMs: number;
  logger: Logger;
}): (route: RouteModelInput) => Promise<RouteModelResult> {
  let models: Promise<RoutingCandidate[]> | undefined;

  return async route => {
    const startedMs = Date.now();
    const log = (fields: Record<string, unknown>) => {
      input.logger.info('model routing', {
        thread_id: route.threadId,
        fallback_model: route.fallbackModel,
        latency_ms: Date.now() - startedMs,
        ...fields,
      });
    };
    const fallback = (reason: FallbackReason, extra: Record<string, unknown> = {}): RouteModelResult => {
      log({ reason, chosen_model: route.fallbackModel, ...extra });
      return {};
    };

    const decide = async (timeout: AbortSignal): Promise<RouteModelResult> => {
      models ??= input.listCandidates().catch((error: unknown) => {
        models = undefined;
        throw error;
      });
      const task = clip(route.task.instructions);
      const [all, decision] = await Promise.all([
        models,
        input.decision.create(
          {
            input: route.task.name === undefined ? task : `Subagent: ${route.task.name}\n\nTask:\n${task}`,
            questions: [
              {
                type: 'choice',
                name: 'category',
                instructions: INSTRUCTIONS,
                choices: Object.entries(CATEGORIES).map(([value, description]) => ({ value, description })),
              },
            ],
          },
          { metadata: { 'tfg.thread_id': route.threadId }, signal: AbortSignal.any([route.signal, timeout]) },
        ),
      ]);
      timeout.throwIfAborted();
      const answer = decision.answers.find(
        (candidate): candidate is ChoiceAnswer => candidate.type === 'choice' && candidate.name === 'category',
      );
      if (answer === undefined || !isCategory(answer.choice)) {
        return fallback('decision_error', { answer });
      }
      const classified = {
        category: answer.choice,
        confidence: answer.confidence,
        // A list, not an object: the JSON log format sorts object keys, which would lose the ranking.
        probabilities: [...answer.probabilities].sort((a, b) => b.probability - a.probability),
        canonical_model: CATEGORY_MODEL[answer.choice],
      };
      const picked = modelFor({
        canonicalModel: CATEGORY_MODEL[answer.choice],
        models: all,
        fallbackModel: route.fallbackModel,
      });
      if (picked === undefined) {
        return fallback('model_unavailable', classified);
      }
      const fallbackPrice = all.find(model => model.model === route.fallbackModel)?.price;
      log({
        reason: 'picked',
        ...classified,
        chosen_model: picked.model,
        picked_price: picked.price,
        fallback_price: fallbackPrice,
        price_direction: priceDirection({ picked: picked.price, fallback: fallbackPrice }),
        picked_image_input: picked.imageInput,
      });
      return { model: picked.model };
    };

    // The budget covers the whole step, including candidate listing and gateway lookups, not just the decision call.
    const timeout = AbortSignal.timeout(input.timeoutMs);
    const timedOut = new Promise<never>((_, reject) => {
      timeout.addEventListener(
        'abort',
        () => {
          reject(new Error(`Routing timed out after ${String(input.timeoutMs)} ms`, { cause: timeout.reason }));
        },
        { once: true },
      );
    });
    const work = decide(timeout);
    // Whichever promise loses the race settles later; its outcome is already reported.
    work.catch(() => undefined);
    timedOut.catch(() => undefined);
    try {
      return await Promise.race([work, timedOut]);
    } catch (error) {
      return fallback(timeout.aborted ? 'decision_timeout' : 'decision_error', { err: describeUnknownError(error) });
    }
  };
}
