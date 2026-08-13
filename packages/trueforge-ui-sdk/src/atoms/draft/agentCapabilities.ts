import type { AgentRuntimeConfig } from '../../server/types.js';

export type AgentCapabilityValues = {
  generativeUi: boolean;
  dynamicSubAgents: boolean;
  askUserQuestions: boolean;
};

export const DEFAULT_AGENT_CAPABILITIES: AgentCapabilityValues = {
  generativeUi: true,
  dynamicSubAgents: true,
  askUserQuestions: true,
};

export function readAgentCapabilities(config?: AgentRuntimeConfig): AgentCapabilityValues {
  return {
    generativeUi: config?.generativeUi?.enabled ?? DEFAULT_AGENT_CAPABILITIES.generativeUi,
    dynamicSubAgents: config?.dynamicSubAgents?.enabled ?? DEFAULT_AGENT_CAPABILITIES.dynamicSubAgents,
    askUserQuestions: config?.askUserQuestions?.enabled ?? DEFAULT_AGENT_CAPABILITIES.askUserQuestions,
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
  };
}
