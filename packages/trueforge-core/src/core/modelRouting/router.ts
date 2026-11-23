import type { Logger } from 'winston';
import type { DecisionInputMessage, DecisionModel } from '../decision/IDecisionModel';
import { type ReasoningEffort, SUPPORTED_REASONING_EFFORTS } from '../llm/VercelAILLM';
import { describeUnknownError } from '../util/errorLogFields';
import { classificationRequest, readClassification } from './classification';
import { ROUTING_CLUSTERS } from './clusters';
import type { RoutingCategory, RoutingQuestion } from './question';

/** Spec model name that asks the harness to route the root thread's model on every turn. */
export const AUTO_MODEL = 'auto';

/** One of the models the user has access to. */
export interface RoutableModel {
  /** `provider/model`, as the harness resolves it. */
  name: string;
  /** Provider-neutral model id (e.g. `anthropic/claude-haiku-5-5`); matched against the clusters. */
  canonicalModel: string | undefined;
  /** Blended USD per million tokens: 0.75 × input + 0.25 × output. */
  cost: number | undefined;
}

export interface RoutedModel {
  model: string;
  effort: ReasoningEffort;
}

interface Selection {
  routed: RoutedModel;
  canonicalModel: string;
  cost: number | undefined;
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
    (a, b) => (a.model.cost ?? Number.MAX_VALUE) - (b.model.cost ?? Number.MAX_VALUE) || a.effortRank - b.effortRank,
  );
  if (cheapest === undefined) {
    return undefined;
  }
  return {
    routed: { model: cheapest.model.name, effort: cheapest.effort },
    canonicalModel: cheapest.canonicalModel,
    cost: cheapest.model.cost,
    available: candidates.length,
  };
}

function isRoutingCategory(category: string): category is RoutingCategory {
  return Object.hasOwn(ROUTING_CLUSTERS, category);
}

export interface ModelRouterDeps {
  /** The decision model that categorises the task, e.g. Jev; called on every route. */
  classifier: () => Promise<DecisionModel>;
  question: RoutingQuestion;
  /** The models the user has access to; called at most once per router. */
  listModels: () => Promise<RoutableModel[]>;
}

export interface RouteInput {
  threadId: string;
  /** What to classify: text, or an ordered list of messages. */
  input: string | DecisionInputMessage[];
  /** The caller writes this for a task or for a conversation. */
  instructions: string;
}

interface Outcome {
  reason: 'picked' | 'decision_error' | 'model_unavailable';
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
    let isTruncated: boolean | undefined;

    const decide = async (): Promise<Outcome> => {
      models ??= deps.listModels().catch((error: unknown) => {
        models = undefined;
        throw error;
      });
      const classifier = await deps.classifier();
      const request = classificationRequest({
        input: route.input,
        question: deps.question,
        instructions: route.instructions,
        contextLength: classifier.properties.contextLength,
      });
      isTruncated = request.isTruncated;
      const [userModels, decision] = await Promise.all([
        models,
        classifier.client.create(request.body, {
          metadata: { 'tfg.thread_id': route.threadId },
        }),
      ]);
      const classification = readClassification(decision);
      if (classification === undefined) {
        return { reason: 'decision_error', routed: undefined, fields: { answers: decision.answers } };
      }
      const classified = { category: classification.category, ...classification.details };
      if (!isRoutingCategory(classification.category)) {
        return { reason: 'decision_error', routed: undefined, fields: classified };
      }
      const selection = selectModel({ category: classification.category, models: userModels });
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
          cost: selection.cost,
        },
      };
    };

    let outcome: Outcome;
    try {
      outcome = await decide();
    } catch (error) {
      outcome = { reason: 'decision_error', routed: undefined, fields: { err: describeUnknownError(error) } };
    }
    logger.info('model routing', {
      thread_id: route.threadId,
      latency_ms: Date.now() - startedMs,
      input_truncated: isTruncated,
      reason: outcome.reason,
      ...outcome.fields,
    });
    return outcome.routed;
  };
}
