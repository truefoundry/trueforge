import { uncoveredRoutingCategories, type RoutingCategory } from '@truefoundry/trueforge-core/core';
import type { IModelProviderStore, ModelInfo } from '../db/modelProviderStore';
import type { AutoModelRoutingConfiguration } from '../schemas/configuration';

/** The models Auto may route to: those the caller can access, narrowed to the admin's candidate list. */
export async function listAutoCandidateModels({
  tenant_id,
  modelProviderStore,
  autoModelRouting,
}: {
  tenant_id: string;
  modelProviderStore: IModelProviderStore;
  autoModelRouting: AutoModelRoutingConfiguration;
}): Promise<ModelInfo[]> {
  const candidates = new Set(autoModelRouting.candidate_models);
  const accessibleModels = await modelProviderStore.listModels({ tenant_id });
  return accessibleModels.filter(model => candidates.has(model.name));
}

/** Each routing category in admin-facing words, as defined in `DEFAULT_ROUTING_QUESTION`. */
const ROUTING_CATEGORY_LABELS: Record<RoutingCategory, string> = {
  direct: 'simple tasks that need no tools',
  fixed_steps: 'tool tasks with predefined steps',
  adaptive: 'tasks that need reasoning or adapt to tool results',
  frontier: 'hard, open-ended tasks',
};

/** Error message naming the categories no candidate model serves, or undefined when all are covered. */
export function describeUncoveredCandidateCategories(candidateModels: readonly ModelInfo[]): string | undefined {
  const uncovered = uncoveredRoutingCategories(candidateModels);
  if (uncovered.length === 0) {
    return undefined;
  }
  return `The selected models don't cover every kind of task Auto handles. Add a model for: ${uncovered
    .map(category => ROUTING_CATEGORY_LABELS[category])
    .join(', ')}.`;
}
