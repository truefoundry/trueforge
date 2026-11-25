import type { IModelProviderStore } from '../db/modelProviderStore';
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
