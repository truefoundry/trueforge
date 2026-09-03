import type { AgentRuntimeConfig } from '../../server/types.js';

export type RuntimeConfigSummaryEntry = {
  label: string;
  value: string;
};

function enabledLabel(value: boolean | undefined, defaultValue: boolean): string {
  return (value ?? defaultValue) ? 'on' : 'off';
}

export function runtimeConfigSummary(config?: AgentRuntimeConfig): RuntimeConfigSummaryEntry[] {
  return [
    { label: 'iteration limit', value: String(config?.iterationLimit ?? 100) },
    { label: 'sandbox', value: enabledLabel(config?.sandbox?.enabled, false) },
    { label: 'compaction', value: enabledLabel(config?.contextManagement?.compaction?.enabled, true) },
    {
      label: 'large tool response',
      value: enabledLabel(config?.contextManagement?.largeToolResponse?.enabled, true),
    },
    { label: 'dynamic sub-agents', value: enabledLabel(config?.dynamicSubAgents?.enabled, true) },
    { label: 'generative UI', value: enabledLabel(config?.generativeUi?.enabled, true) },
    { label: 'ask user questions', value: enabledLabel(config?.askUserQuestions?.enabled, true) },
  ];
}
