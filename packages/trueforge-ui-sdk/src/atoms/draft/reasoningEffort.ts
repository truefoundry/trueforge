import type { Model, ModelParams, ModelSelection } from '../../server/types.js';

export function hasReasoningEfforts(efforts: ModelSelection['reasoningEfforts']): efforts is string[] {
  return Array.isArray(efforts) && efforts.length > 0;
}

/** Keep current if still listed; otherwise first effort; none if model has no efforts. */
export function resolveReasoningEffort(
  efforts: ModelSelection['reasoningEfforts'],
  current: string | undefined,
): string | undefined {
  if (!hasReasoningEfforts(efforts)) return undefined;
  if (current && efforts.includes(current)) return current;
  return efforts[0];
}

/** Draft model patch: preserve other params, set or clear `reasoningEffort`. */
export function modelPatchWithReasoningEffort(
  name: string,
  existingParams: ModelParams | undefined,
  efforts: ModelSelection['reasoningEfforts'],
): Model {
  const nextEffort = resolveReasoningEffort(efforts, existingParams?.reasoningEffort);
  if (nextEffort === undefined) {
    if (!existingParams) return { name };
    const { reasoningEffort: _cleared, ...rest } = existingParams;
    return Object.keys(rest).length > 0 ? { name, params: rest } : { name };
  }
  return {
    name,
    params: { ...existingParams, reasoningEffort: nextEffort },
  };
}
