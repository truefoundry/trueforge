import type { AgentBuilderCapabilitiesResponse, AutoModel, Model, ModelSelection } from '../../server/types.js';

/** Key of the Auto row in model lists and selections. It is not a model name: the spec says `type: 'auto'`. */
export const AUTO_MODEL = 'auto';

export const AUTO_MODEL_LABEL = 'Auto';

export const AUTO_MODEL_UNAVAILABLE_HINT = 'Auto mode is not available for now';

export const AUTO_MODEL_TOOLTIP_TITLE = 'Auto';

export const AUTO_MODEL_TOOLTIP_LINES = [
  'Selects the most capable model for each task.',
  'Auto is an intelligent model router that balances intelligence and cost.',
] as const;

/** Selects Auto; the empty list leaves the choice to the tenant's Auto models. */
export const AUTO_MODEL_PATCH: AutoModel = { type: 'auto', candidateModels: [] };

/** Mirror the server's limits on an Auto spec's `candidateModels` when it names any. */
export const MIN_AUTO_CANDIDATE_MODELS = 4;
export const MAX_AUTO_CANDIDATE_MODELS = 10;

/** True when the workspace reports that Auto can route to the model. */
export function supportsAutoRouting(model: ModelSelection): boolean {
  return model.properties.autoRouting?.supported === true;
}

/** The models an Auto spec routes among: its own list, or the workspace's Auto models when it names none. */
export function autoCandidateNames({
  model,
  models,
}: {
  model: AutoModel;
  models: readonly ModelSelection[];
}): string[] {
  if (model.candidateModels.length > 0) return model.candidateModels;
  return models.flatMap(item => {
    const routing = item.properties.autoRouting;
    return routing?.supported === true && routing.enabled ? [item.name] : [];
  });
}

/**
 * Saved candidates the workspace no longer offers to Auto, e.g. after an admin removed a provider or a model
 * stopped supporting Auto routing. An empty workspace list means the catalog has not loaded (or failed), so
 * nothing is reported as removed.
 */
export function removedAutoCandidates({
  candidateModels,
  models,
}: {
  candidateModels: readonly string[];
  models: readonly ModelSelection[];
}): string[] {
  if (models.length === 0) return [];
  // A host that does not report Auto support leaves `autoRouting` unset; those models still count as offered.
  const listed = new Set(
    models.filter(item => item.properties.autoRouting?.supported !== false).map(item => item.name),
  );
  return candidateModels.filter(name => !listed.has(name));
}

/**
 * Drops removed candidates. When fewer than the minimum remain, the spec falls back to the workspace's
 * own Auto models (an empty list), since a shorter explicit list would be rejected on save.
 */
export function syncedAutoModel({ model, models }: { model: AutoModel; models: readonly ModelSelection[] }): AutoModel {
  const removed = new Set(removedAutoCandidates({ candidateModels: model.candidateModels, models }));
  const kept = model.candidateModels.filter(name => !removed.has(name));
  return { type: 'auto', candidateModels: kept.length >= MIN_AUTO_CANDIDATE_MODELS ? kept : [] };
}

/** The key a model has in model lists: its name, or `AUTO_MODEL` for Auto. */
export function modelSelectionKey(model: Model): string {
  return model.type === 'auto' ? AUTO_MODEL : model.name;
}

/** Auto stays selected while capabilities load, and is dropped once they say it can't be picked. */
export function keepsAutoModel(capabilities: AgentBuilderCapabilitiesResponse['data'] | null): boolean {
  return capabilities == null || capabilities.auto.status === 'enabled';
}
