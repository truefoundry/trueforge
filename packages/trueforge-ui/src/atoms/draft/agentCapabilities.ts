import type { AgentRuntimeConfig } from '../../server/types.js';

export type AgentCapabilityValues = {
  generativeUi: boolean;
  dynamicSubAgents: boolean;
  askUserQuestions: boolean;
  webSearch: boolean;
};

/** Shown when the host locks web search without saying why. */
export const WEB_SEARCH_UNAVAILABLE_HINT = 'Web search is not configured';

/** Shown while a spec keeps web search the host no longer allows, so the last turn-off is final. */
export const WEB_SEARCH_ONE_WAY_OFF_HINT =
  'Web search is off for this tenant. Turning it off here is final until an admin turns it back on.';

export const DEFAULT_AGENT_CAPABILITIES: AgentCapabilityValues = {
  generativeUi: true,
  dynamicSubAgents: true,
  askUserQuestions: true,
  webSearch: true,
};

export function readAgentCapabilities(config?: AgentRuntimeConfig): AgentCapabilityValues {
  return {
    generativeUi: config?.generativeUi?.enabled ?? DEFAULT_AGENT_CAPABILITIES.generativeUi,
    dynamicSubAgents: config?.dynamicSubAgents?.enabled ?? DEFAULT_AGENT_CAPABILITIES.dynamicSubAgents,
    askUserQuestions: config?.askUserQuestions?.enabled ?? DEFAULT_AGENT_CAPABILITIES.askUserQuestions,
    webSearch: config?.webSearch?.enabled ?? DEFAULT_AGENT_CAPABILITIES.webSearch,
  };
}

export function withAgentCapabilities({
  config,
  values,
}: {
  config?: AgentRuntimeConfig;
  values: AgentCapabilityValues;
}): AgentRuntimeConfig {
  return {
    ...config,
    generativeUi: { ...config?.generativeUi, enabled: values.generativeUi },
    dynamicSubAgents: { ...config?.dynamicSubAgents, enabled: values.dynamicSubAgents },
    askUserQuestions: { ...config?.askUserQuestions, enabled: values.askUserQuestions },
    webSearch: { ...config?.webSearch, enabled: values.webSearch },
  };
}
