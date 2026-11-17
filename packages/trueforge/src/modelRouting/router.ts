import type { RouteModelInput, RouteModelResult } from '@truefoundry/trueforge-core/agent-session';
import { describeUnknownError, type IDecisionModel } from '@truefoundry/trueforge-core/core';
import type { Logger } from 'winston';
import type { RoutingCategory, RoutingQuestion } from './question';
import type { RoutingCandidate } from './types';

/** Keeps the decision request under the gateway's body limit. */
const TASK_CHARS = 8_000;

/** One canonical model per category for now; clusters of models replace this. */
const CATEGORY_MODEL: Record<RoutingCategory, string> = {
  direct: 'openai/gpt-6-luna',
  fixed_steps: 'anthropic/claude-sonnet-5-5',
  adaptive: 'openai/gpt-6-1-sol',
};

/**
 * `routeModel` for one turn: the decision model classifies the subagent's task, and the category picks the model.
 * Candidates are listed once and shared by the turn's subagents. Never throws.
 */
export function createModelRouter(input: {
  question: RoutingQuestion;
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
    const fallback = (reason: string, extra: Record<string, unknown> = {}): RouteModelResult => {
      log({ reason, chosen_model: route.fallbackModel, ...extra });
      return {};
    };

    const decide = async (timeout: AbortSignal): Promise<RouteModelResult> => {
      models ??= input.listCandidates().catch((error: unknown) => {
        models = undefined;
        throw error;
      });
      const task = route.task.instructions.slice(0, TASK_CHARS);
      const [all, decision] = await Promise.all([
        models,
        input.decision.create(
          {
            input: route.task.name === undefined ? task : `Subagent: ${route.task.name}\n\nTask:\n${task}`,
            questions: [
              {
                type: 'choice',
                name: 'category',
                instructions: input.question.instructions,
                choices: Object.entries(input.question.categories).map(([value, description]) => ({
                  value,
                  description,
                })),
              },
            ],
          },
          { metadata: { 'tfg.thread_id': route.threadId }, signal: AbortSignal.any([route.signal, timeout]) },
        ),
      ]);
      timeout.throwIfAborted();
      const answer = decision.answers.find(candidate => candidate.name === 'category');
      if (
        answer?.type !== 'choice' ||
        typeof answer.choice !== 'string' ||
        !Object.hasOwn(CATEGORY_MODEL, answer.choice)
      ) {
        return fallback('decision_error', { answer });
      }
      const canonicalModel = CATEGORY_MODEL[answer.choice as RoutingCategory];
      const classified = {
        category: answer.choice,
        confidence: answer.confidence,
        // A list, not an object: the JSON log format sorts object keys, which would lose the ranking.
        probabilities: [...answer.probabilities].sort((a, b) => b.probability - a.probability),
        canonical_model: canonicalModel,
      };
      // Prefer the parent model's account, so the subagent stays on the same provider when it can.
      const matches = all.filter(model => model.canonicalModel === canonicalModel);
      const parentAccount = `${route.fallbackModel.split('/', 1)[0] ?? ''}/`;
      const picked = matches.find(model => model.model.startsWith(parentAccount)) ?? matches[0];
      if (picked === undefined) {
        return fallback('model_unavailable', classified);
      }
      log({
        reason: 'picked',
        ...classified,
        chosen_model: picked.model,
        picked_price: picked.price,
        fallback_price: all.find(model => model.model === route.fallbackModel)?.price,
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
