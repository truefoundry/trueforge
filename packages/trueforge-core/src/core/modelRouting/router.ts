import type { Logger } from 'winston';
import { describeUnknownError } from '../util/errorLogFields';
import { CLUSTER_EFFORTS, ROUTING_CLUSTERS, type ClusterEffort } from './clusters';
import type { IRoutingClassifier, RoutingState } from './IRoutingClassifier';
import type { RoutingCategory } from './question';

/** One of the models the user has access to. */
export interface RoutableModel {
  /** `provider/model`, as the harness resolves it. */
  model: string;
  /** Provider-neutral model id (e.g. `anthropic/claude-haiku-5-5`); matched against the clusters. */
  canonicalModel?: string | undefined;
  /** Blended USD per million tokens: 0.75 × input + 0.25 × output. */
  price?: number | undefined;
}

export interface RoutedModel {
  model: string;
  /** Reasoning effort the thread should run at. */
  effort: ClusterEffort;
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
  const candidates = CLUSTER_EFFORTS.flatMap((effort, effortRank) =>
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

export interface ModelRouterInput {
  classifier: IRoutingClassifier;
  /** The models the user has access to; called at most once per router. */
  listModels: () => Promise<RoutableModel[]>;
  /** Bounds the whole step, including listing models and classifying. */
  timeoutMs: number;
  logger: Logger;
}

export interface RouteInput {
  state: RoutingState;
  /** Model the thread runs on when routing doesn't pick one (`provider/model`). */
  fallbackModel: string;
  signal: AbortSignal;
}

/** Routes threads to a model: classify the task, then pick the cheapest pair in that cluster. Never throws. */
export function createModelRouter(input: ModelRouterInput): (route: RouteInput) => Promise<RoutedModel | undefined> {
  let models: Promise<RoutableModel[]> | undefined;

  return async route => {
    const startedMs = Date.now();
    const log = (fields: Record<string, unknown>) => {
      input.logger.info('model routing', {
        thread_id: route.state.threadId,
        fallback_model: route.fallbackModel,
        latency_ms: Date.now() - startedMs,
        ...fields,
      });
    };
    const logFallback = (reason: string, extra: Record<string, unknown> = {}) => {
      log({ reason, chosen_model: route.fallbackModel, ...extra });
    };

    const decide = async (timeout: AbortSignal): Promise<RoutedModel | undefined> => {
      models ??= input.listModels().catch((error: unknown) => {
        models = undefined;
        throw error;
      });
      const [userModels, classification] = await Promise.all([
        models,
        input.classifier.classify(route.state, AbortSignal.any([route.signal, timeout])),
      ]);
      timeout.throwIfAborted();
      const classified = { category: classification.category, ...classification.details };
      if (!Object.hasOwn(ROUTING_CLUSTERS, classification.category)) {
        logFallback('decision_error', classified);
        return undefined;
      }
      const selection = selectModel({
        category: classification.category as RoutingCategory,
        models: userModels,
      });
      if (selection === undefined) {
        logFallback('model_unavailable', classified);
        return undefined;
      }
      log({
        reason: 'picked',
        ...classified,
        canonical_model: selection.canonicalModel,
        effort: selection.routed.effort,
        available_in_cluster: selection.available,
        chosen_model: selection.routed.model,
        picked_price: selection.price,
        fallback_price: userModels.find(model => model.model === route.fallbackModel)?.price,
      });
      return selection.routed;
    };

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
      logFallback(timeout.aborted ? 'decision_timeout' : 'decision_error', { err: describeUnknownError(error) });
      return undefined;
    }
  };
}
