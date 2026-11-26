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
  direct: 'routine',
  fixed_steps: 'tool-driven',
  adaptive: 'adaptive',
  frontier: 'frontier',
};

/** Error message naming the categories no candidate model serves, or undefined when all are covered. */
export function describeUncoveredCandidateCategories(candidateModels: readonly ModelInfo[]): string | undefined {
  const uncovered = uncoveredRoutingCategories(candidateModels);
  if (uncovered.length === 0) {
    return undefined;
  }
  const tiers = uncovered.map(category => ROUTING_CATEGORY_LABELS[category]);
  const [onlyTier] = tiers;
  const ask =
    onlyTier !== undefined && tiers.length === 1
      ? `Add a model for the ${onlyTier} tier.`
      : `Add a model for each of these tiers: ${new Intl.ListFormat('en').format(tiers)}.`;
  return `The selected models don't cover every tier. ${ask}`;
}
