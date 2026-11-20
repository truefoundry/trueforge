import type { AgentBuilderCapabilitiesResponse, Model, ModelParams } from '../../server/types.js';

/** Spec model name that routes the root thread's model on every turn; same value as trueforge-core's `AUTO_MODEL`. */
export const AUTO_MODEL = 'auto';

/**
 * The draft patch that selects Auto. Auto runs on each routed model's own defaults and the server rejects params on
 * it, so every param is unset. Each key is listed because `mergeAgentSpec` merges `params` key by key.
 */
export const AUTO_MODEL_PATCH: Model = {
  name: AUTO_MODEL,
  params: {
    maxTokens: undefined,
    reasoningEffort: undefined,
    temperature: undefined,
    topP: undefined,
    topK: undefined,
    parallelToolCalls: undefined,
  } satisfies { [K in keyof Required<ModelParams>]: undefined },
};

export const AUTO_MODEL_LABEL = 'Auto';

export const AUTO_MODEL_UNAVAILABLE_HINT = 'Auto mode is not available for now';

/** Auto stays selected while capabilities load, and is dropped once they say it can't be picked. */
export function keepsAutoModel(capabilities: AgentBuilderCapabilitiesResponse['data'] | null): boolean {
  return capabilities == null || capabilities.auto?.enabled === true;
}
