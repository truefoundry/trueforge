import type { Logger } from 'winston';
import type { DecisionModelCreateParams, IDecisionModel } from '../decision/IDecisionModel';
import { type ReasoningEffort, SUPPORTED_REASONING_EFFORTS } from '../llm/VercelAILLM';
import { describeUnknownError } from '../util/errorLogFields';
import { classificationRequest, readClassification } from './classification';
import { ROUTING_CLUSTERS } from './clusters';
import type { RoutingCategory, RoutingQuestion } from './question';

/** One of the models the user has access to. */
export interface RoutableModel {
  /** `provider/model`, as the harness resolves it. */
  model: string;
  /** Provider-neutral model id (e.g. `anthropic/claude-haiku-5-5`); matched against the clusters. */
  canonicalModel: string | undefined;
  /** Blended USD per million tokens: 0.75 × input + 0.25 × output. */
  price: number | undefined;
}

export interface RoutedModel {
  model: string;
  /** Reasoning effort the thread should run at. */
  effort: ReasoningEffort;
}

interface Selection {
  routed: RoutedModel;
  canonicalModel: string;
  price: number | undefined;
  /** How many model, effort and account combinations in the cluster the user has. */
  available: number;
}

/**
 * The cheapest pair in the cluster that the user has, across all their accounts. Unpriced models go last; ties go to
 * the lower effort, then to the cluster's order.
 */
export function selectModel(input: {
  category: RoutingCategory;
  models: readonly RoutableModel[];
}): Selection | undefined {
  const cluster = ROUTING_CLUSTERS[input.category];
  const candidates = SUPPORTED_REASONING_EFFORTS.flatMap((effort, effortRank) =>
    (cluster[effort] ?? []).flatMap(canonicalModel =>
      input.models
        .filter(model => model.canonicalModel === canonicalModel)
        .map(model => ({ model, canonicalModel, effort, effortRank })),
    ),
  );
  const [cheapest] = candidates.sort(
    (a, b) => (a.model.price ?? Number.MAX_VALUE) - (b.model.price ?? Number.MAX_VALUE) || a.effortRank - b.effortRank,
  );
  if (cheapest === undefined) {
    return undefined;
  }
  return {
    routed: { model: cheapest.model.model, effort: cheapest.effort },
    canonicalModel: cheapest.canonicalModel,
    price: cheapest.model.price,
    available: candidates.length,
  };
}

export interface ModelRouterDeps {
  /** Decides the task's category, e.g. Jev. */
  classifier: IDecisionModel;
  question: RoutingQuestion;
  /** The models the user has access to; called at most once per router. */
  listModels: () => Promise<RoutableModel[]>;
  /** Bounds the whole step, including listing models and classifying. */
  timeoutMs: number;
}

export interface RouteInput {
  threadId: string;
  /** What to classify: text, or an ordered list of messages. */
  input: DecisionModelCreateParams['input'];
}

interface Outcome {
  reason: 'picked' | 'decision_error' | 'decision_timeout' | 'model_unavailable';
  routed: RoutedModel | undefined;
  fields: Record<string, unknown>;
}

/**
 * Routes threads to a model: classify the task, then pick the cheapest pair in that cluster. Never throws; resolves to
 * undefined when it can't pick one, and the caller keeps its own model.
 */
export function createModelRouter(
  deps: ModelRouterDeps,
  logger: Logger,
): (route: RouteInput) => Promise<RoutedModel | undefined> {
  let models: Promise<RoutableModel[]> | undefined;

  return async route => {
    const startedMs = Date.now();
    const request = classificationRequest(route.input, deps.question);

    const decide = async (timeout: AbortSignal): Promise<Outcome> => {
      models ??= deps.listModels().catch((error: unknown) => {
        models = undefined;
        throw error;
      });
      const [userModels, decision] = await Promise.all([
        models,
        deps.classifier.create(request.body, {
          metadata: { 'tfg.thread_id': route.threadId },
        }),
      ]);
      timeout.throwIfAborted();
      const classification = readClassification(decision);
      if (classification === undefined) {
        return { reason: 'decision_error', routed: undefined, fields: { answers: decision.answers } };
      }
      const classified = { category: classification.category, ...classification.details };
      if (!Object.hasOwn(ROUTING_CLUSTERS, classification.category)) {
        return { reason: 'decision_error', routed: undefined, fields: classified };
      }
      const selection = selectModel({ category: classification.category as RoutingCategory, models: userModels });
      if (selection === undefined) {
        return { reason: 'model_unavailable', routed: undefined, fields: classified };
      }
      return {
        reason: 'picked',
        routed: selection.routed,
        fields: {
          ...classified,
          canonical_model: selection.canonicalModel,
          available_in_cluster: selection.available,
          model: selection.routed.model,
          effort: selection.routed.effort,
          price: selection.price,
        },
      };
    };

    const timeout = AbortSignal.timeout(deps.timeoutMs);
    const timedOut = new Promise<never>((_, reject) => {
      timeout.addEventListener(
        'abort',
        () => {
          reject(new Error(`Routing timed out after ${String(deps.timeoutMs)} ms`, { cause: timeout.reason }));
        },
        { once: true },
      );
    });
    const work = decide(timeout);
    // Whichever promise loses the race settles later and is ignored.
    work.catch(() => undefined);
    timedOut.catch(() => undefined);
    let outcome: Outcome;
    try {
      outcome = await Promise.race([work, timedOut]);
    } catch (error) {
      outcome = {
        reason: timeout.aborted ? 'decision_timeout' : 'decision_error',
        routed: undefined,
        fields: { err: describeUnknownError(error) },
      };
    }
    logger.info('model routing', {
      thread_id: route.threadId,
      latency_ms: Date.now() - startedMs,
      input_truncated: request.truncated,
      reason: outcome.reason,
      ...outcome.fields,
    });
    return outcome.routed;
  };
}
