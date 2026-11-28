import {
  ROOT_ROUTING_CATEGORIES,
  selectModel,
  type RoutableModel,
  type RoutingCategory,
} from '@truefoundry/trueforge-core/core';
import type { IModelProviderStore, ModelInfo } from '../db/modelProviderStore';
import type { AutoModelRoutingConfiguration } from '../schemas/configuration';
import type { AutoRouting } from '../schemas/modelProvider';

/** The models Auto may route to: those the caller can access, narrowed to the candidate list. */
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

/** The categories the router could pick this model for; empty when it can never be chosen. */
function routableCategories(model: RoutableModel) {
  return ROOT_ROUTING_CATEGORIES.filter(category => selectModel({ category, models: [model] }) !== undefined);
}

/** Checks whether the model supports Auto routing and, if so, which categories it serves. */
export function describeAutoRouting({
  model,
  enabledModelNames,
}: {
  model: ModelInfo;
  /** Names in the tenant's global list of Auto candidate models. */
  enabledModelNames: ReadonlySet<string>;
}): AutoRouting {
  const categories = routableCategories(model);
  if (categories.length > 0) {
    return { supported: true, enabled: enabledModelNames.has(model.name), categories };
  }
  return {
    supported: false,
    unsupported_reason:
      model.canonical_model === null
        ? 'The model has no canonical model mapping.'
        : 'The model is not in any Auto routing cluster.',
  };
}

/** The routing categories none of these models can serve; empty when every category has a model. */
export function uncoveredRoutingCategories(models: readonly RoutableModel[]): RoutingCategory[] {
  return ROOT_ROUTING_CATEGORIES.filter(category => selectModel({ category, models }) === undefined);
}

/** True when every routing category has a model the user can be routed to. */
export function canRouteEveryCategory(models: readonly RoutableModel[]): boolean {
  return uncoveredRoutingCategories(models).length === 0;
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Error message naming the categories no candidate model serves, or undefined when all are covered. */
export function describeUncoveredCandidateCategories(candidateModels: readonly ModelInfo[]): string | undefined {
  const tiers = uncoveredRoutingCategories(candidateModels).map(capitalize);
  if (tiers.length === 0) {
    return undefined;
  }
  const [onlyTier] = tiers;
  const ask =
    onlyTier !== undefined && tiers.length === 1
      ? `Add a model for the ${onlyTier} tier.`
      : `Add a model for each of these tiers: ${new Intl.ListFormat('en').format(tiers)}.`;
  return `The selected models don't cover every tier. ${ask}`;
}

/** `inaccessible` is reported by each caller in its own words; `rejected` carries the message to return. */
export type AutoCandidateRejection = { type: 'inaccessible' } | { type: 'rejected'; message: string };

/**
 * Why these model names cannot be Auto candidates, or undefined when they can all be routed to and together serve
 * every category. Which name failed is left out so the result cannot probe which models the caller lacks.
 */
export async function validateAutoCandidateModels({
  names,
  tenant_id,
  modelProviderStore,
}: {
  names: readonly string[];
  tenant_id: string;
  modelProviderStore: IModelProviderStore;
}): Promise<AutoCandidateRejection | undefined> {
  const accessibleModels = await modelProviderStore.listModels({ tenant_id });
  const accessible = new Set(accessibleModels.map(model => model.name));
  if (names.some(name => !accessible.has(name))) {
    return { type: 'inaccessible' };
  }
  const chosen = accessibleModels.filter(model => names.includes(model.name));
  // A model the router could never pick for any category would sit in the list unused.
  const unroutable = chosen.some(model => routableCategories(model).length === 0);
  if (unroutable) {
    return { type: 'rejected', message: 'candidate_models must only contain models that support Auto routing' };
  }
  const uncovered = describeUncoveredCandidateCategories(chosen);
  return uncovered === undefined ? undefined : { type: 'rejected', message: uncovered };
}
