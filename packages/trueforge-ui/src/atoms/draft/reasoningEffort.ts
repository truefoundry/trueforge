import type { Model, ModelParams, ModelSelection } from '../../server/types.js';

type ReasoningEfforts = ModelSelection['properties']['reasoningEfforts'];

/** Playground max-token catalog, except min is 100 (not 50) so the 25000 default sits on the step grid. */
const FALLBACK_MAX_TOKENS = 25000;
const FALLBACK_MAX_TOKENS_MIN = 100;
const FALLBACK_MAX_TOKENS_MAX = 128_000;
const FALLBACK_MAX_TOKENS_STEP = 100;
const FALLBACK_REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high'] as const;

export const UNSUPPORTED_MODEL_PARAM_WARNING = 'May not be supported by this Model';

export function maxTokenControl(maxOutputTokens: number | undefined): {
  min: number;
  max: number;
  step: number;
  seed: number;
} {
  if (maxOutputTokens === undefined) {
    return {
      min: FALLBACK_MAX_TOKENS_MIN,
      max: FALLBACK_MAX_TOKENS_MAX,
      step: FALLBACK_MAX_TOKENS_STEP,
      seed: FALLBACK_MAX_TOKENS,
    };
  }
  return { min: 1, max: maxOutputTokens, step: 1, seed: maxOutputTokens };
}

export function reasoningEffortOptions(catalog: ReasoningEfforts, current: string | undefined): string[] {
  if (hasReasoningEfforts(catalog)) return catalog;
  if (current !== undefined && !FALLBACK_REASONING_EFFORTS.some(effort => effort === current)) {
    return [current, ...FALLBACK_REASONING_EFFORTS];
  }
  return [...FALLBACK_REASONING_EFFORTS];
}

export function reasoningEffortSeed(catalog: ReasoningEfforts): string {
  const fallback = resolveReasoningEffort([...FALLBACK_REASONING_EFFORTS], undefined) ?? 'minimal';
  return resolveReasoningEffort(catalog, undefined) ?? fallback;
}

export function hasReasoningEfforts(efforts: ReasoningEfforts): efforts is string[] {
  return Array.isArray(efforts) && efforts.length > 0;
}

const DEFAULT_REASONING_EFFORT_PREFERENCE = ['medium', 'high', 'low'] as const;

/** Keep current if still listed; otherwise default by preference: "medium", then "high", then "low". */
export function resolveReasoningEffort(efforts: ReasoningEfforts, current: string | undefined): string | undefined {
  if (!hasReasoningEfforts(efforts)) return undefined;
  if (current && efforts.includes(current)) return current;
  for (const preferred of DEFAULT_REASONING_EFFORT_PREFERENCE) {
    if (efforts.includes(preferred)) return preferred;
  }
  // Catalog lists are ordered ascending, so the first non-"none" entry is the lowest real effort.
  return efforts.find(effort => effort !== 'none') ?? efforts[0];
}

/**
 * Draft model patch: preserve other params, set or clear `reasoningEffort`.
 *
 * When clearing, set `reasoningEffort: undefined` (do not omit the key).
 * `mergeAgentSpec` in `@truefoundry/trueforge-assistant-ui-runtime` shallow-merges
 * `model.params`, so omitting the key leaves a sticky prior effort and the
 * server then 422s on models that do not advertise `reasoning_efforts`.
 */
export function modelPatchWithReasoningEffort(
  name: string,
  existingParams: ModelParams | undefined,
  efforts: ReasoningEfforts,
): Model {
  const nextEffort = resolveReasoningEffort(efforts, existingParams?.reasoningEffort);
  if (nextEffort === undefined) {
    if (!existingParams) return { name };
    const { reasoningEffort: _cleared, ...rest } = existingParams;
    return { name, params: { ...rest, reasoningEffort: undefined } };
  }
  return {
    name,
    params: { ...existingParams, reasoningEffort: nextEffort },
  };
}
