import type { AgentBuilderCapabilitiesResponse, Model } from '../../server/types.js';

/** Key of the Auto row in model lists and selections. It is not a model name: the spec says `type: 'auto'`. */
export const AUTO_MODEL = 'auto';

export const AUTO_MODEL_LABEL = 'Auto';

export const AUTO_MODEL_UNAVAILABLE_HINT = 'Auto mode is not available for now';

export const AUTO_MODEL_TOOLTIP_TITLE = 'Auto';

export const AUTO_MODEL_TOOLTIP_LINES = [
  'Selects the most capable model for each task.',
  'Auto is an intelligent model router that balances intelligence and cost.',
] as const;

/** The key a model has in model lists: its name, or `AUTO_MODEL` for Auto. */
export function modelSelectionKey(model: Model): string {
  return model.type === 'auto' ? AUTO_MODEL : model.name;
}

/** Auto stays selected while capabilities load, and is dropped once they say it can't be picked. */
export function keepsAutoModel(capabilities: AgentBuilderCapabilitiesResponse['data'] | null): boolean {
  return capabilities == null || capabilities.auto.status === 'enabled';
}
