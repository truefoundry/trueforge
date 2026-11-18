import type { RouteModelInput, RouteModelResult } from '@truefoundry/trueforge-core/agent-session';
import { describeUnknownError, type IDecisionModel } from '@truefoundry/trueforge-core/core';
import type { Logger } from 'winston';
import type { ClusterEffort, RoutingClusters } from './clusters';
import { BENCHMARK_QUESTION, type RoutingCategory, type RoutingQuestion } from './question';
import type { RoutingCandidate } from './types';

/** Keeps the decision request under the gateway's body limit. */
const TASK_CHARS = 8_000;

/** Row used when the spec sets no effort. The subagent then runs at its provider's default, which may differ. */
const ASSUMED_EFFORT: ClusterEffort = 'medium';

/**
 * `routeModel` for one turn: the decision model classifies the subagent's task, and the category and the parent's
 * effort pick a cluster. Candidates are listed once and shared by the turn's subagents. Never throws.
 */
export function createModelRouter(input: {
  question: RoutingQuestion;
  clusters: RoutingClusters;
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
      const [callerModels, decision] = await Promise.all([
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
              { type: 'choice', ...BENCHMARK_QUESTION },
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
        !Object.hasOwn(input.clusters, answer.choice)
      ) {
        return fallback('decision_error', { answer });
      }
      const clusters = input.clusters[answer.choice as RoutingCategory];
      const effort = route.effort ?? ASSUMED_EFFORT;
      const cluster = Object.hasOwn(clusters, effort) ? clusters[effort as ClusterEffort] : undefined;
      const benchmark = decision.answers.find(candidate => candidate.name === BENCHMARK_QUESTION.name);
      // Lists, not objects: the JSON log format sorts object keys, which would lose the ranking.
      const classified = {
        category: answer.choice,
        confidence: answer.confidence,
        probabilities: [...answer.probabilities].sort((a, b) => b.probability - a.probability),
        effort,
        effort_assumed: route.effort === undefined,
        ...(benchmark?.type === 'choice'
          ? {
              benchmark: benchmark.choice,
              benchmark_probabilities: [...benchmark.probabilities].sort((a, b) => b.probability - a.probability),
            }
          : {}),
      };
      if (cluster === undefined) {
        return fallback('no_cluster', classified);
      }
      // Prefer the parent model's account, so the subagent stays on the same provider when it can.
      const parentAccount = `${route.fallbackModel.split('/', 1)[0] ?? ''}/`;
      for (const [index, canonicalModel] of cluster.entries()) {
        const matches = callerModels.filter(model => model.canonicalModel === canonicalModel);
        const picked = matches.find(model => model.model.startsWith(parentAccount)) ?? matches[0];
        if (picked !== undefined) {
          log({
            reason: 'picked',
            ...classified,
            canonical_model: canonicalModel,
            cluster_index: index,
            chosen_model: picked.model,
            picked_price: picked.price,
            fallback_price: callerModels.find(model => model.model === route.fallbackModel)?.price,
          });
          return { model: picked.model };
        }
      }
      return fallback('model_unavailable', classified);
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
