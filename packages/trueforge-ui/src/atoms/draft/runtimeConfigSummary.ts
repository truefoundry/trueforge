import type { AgentRuntimeConfig } from '../../server/types.js';

export type RuntimeConfigSummaryEntry = {
  label: string;
  value: string;
};

function enabledLabel(value: boolean | undefined, defaultValue: boolean): string {
  return (value ?? defaultValue) ? 'on' : 'off';
}

/** Primary for on / numeric values; destructive for off. */
export function runtimeConfigValueClassName(value: string): string {
  return value === 'off' ? 'text-failure-bg font-medium' : 'text-primary-button-bg font-medium';
}

/** `webSearchAvailable` only sets what an unset spec falls back to, matching the editor. */
export function runtimeConfigSummary(
  config?: AgentRuntimeConfig,
  { webSearchAvailable = false }: { webSearchAvailable?: boolean } = {},
): RuntimeConfigSummaryEntry[] {
  return [
    { label: 'iteration limit', value: String(config?.iterationLimit ?? 512) },
    { label: 'sandbox', value: enabledLabel(config?.sandbox?.enabled, false) },
    { label: 'compaction', value: enabledLabel(config?.contextManagement?.compaction?.enabled, true) },
    {
      label: 'large tool response',
      value: enabledLabel(config?.contextManagement?.largeToolResponse?.enabled, true),
    },
    { label: 'dynamic sub-agents', value: enabledLabel(config?.dynamicSubAgents?.enabled, true) },
    { label: 'generative UI', value: enabledLabel(config?.generativeUi?.enabled, true) },
    { label: 'ask user questions', value: enabledLabel(config?.askUserQuestions?.enabled, true) },
    { label: 'web search', value: enabledLabel(config?.webSearch?.enabled, webSearchAvailable) },
  ];
}
