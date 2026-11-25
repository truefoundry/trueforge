import { uncoveredRoutingCategories, type RoutingCategory } from '@truefoundry/trueforge-core/core';
import type { IModelProviderStore, ModelInfo } from '../db/modelProviderStore';
import type { AutoModelRoutingConfiguration } from '../schemas/configuration';

/**
 * The models Auto may pick from for this caller: the models they have access to, narrowed to the admin's candidate list
 * (empty allows none). The model router and the `auto` capability both start from this, so they never disagree.
 * `accessibleModels` is returned too, to tell a candidate list that is too narrow from a caller with too few models.
 */
export async function listAutoCandidateModels({
  tenant_id,
  modelProviderStore,
  autoModelRouting,
}: {
  tenant_id: string;
  modelProviderStore: IModelProviderStore;
  autoModelRouting: AutoModelRoutingConfiguration;
}) {
  const accessibleModels = await modelProviderStore.listModels({ tenant_id });
  const candidates = new Set(autoModelRouting.candidate_models);
  return {
    accessibleModels,
    candidateModels: accessibleModels.filter(model => candidates.has(model.name)),
  };
}

/** What each routing category handles, in words an admin can act on. */
const ROUTING_CATEGORY_LABELS: Record<RoutingCategory, string> = {
  direct: 'routine tasks',
  fixed_steps: 'tool tasks with fixed steps',
  adaptive: 'tasks that depend on earlier results',
  frontier: 'hard, open-ended tasks',
};

/**
 * Why these candidate models can't serve every kind of task Auto handles, or undefined when they can. Auto routes each
 * task by its category, so a candidate list that leaves a category without a model can never be fully used.
 */
export function describeUncoveredCandidateCategories(candidateModels: readonly ModelInfo[]): string | undefined {
  const uncovered = uncoveredRoutingCategories(candidateModels);
  if (uncovered.length === 0) {
    return undefined;
  }
  return `The selected models don't cover every kind of task Auto handles. Add a model for: ${uncovered
    .map(category => ROUTING_CATEGORY_LABELS[category])
    .join(', ')}.`;
}
