import type { AgentBuilderCapabilitiesResponse } from '../../server/types.js';

/** Spec model name that routes the root thread's model on every turn; same value as trueforge-core's `AUTO_MODEL`. */
export const AUTO_MODEL = 'auto';

export const AUTO_MODEL_LABEL = 'Auto';

export const AUTO_MODEL_UNAVAILABLE_HINT = 'Auto mode is not available for now';

/** Auto stays selected while capabilities load, and is dropped once they say it can't be picked. */
export function keepsAutoModel(capabilities: AgentBuilderCapabilitiesResponse['data'] | null): boolean {
  return capabilities == null || capabilities.auto?.enabled === true;
}
