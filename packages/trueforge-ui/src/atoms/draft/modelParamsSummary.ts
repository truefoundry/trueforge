import type { ModelParams } from '../../server/types.js';

export type ModelParamSummaryEntry = {
  label: string;
  value: string;
};

export function modelParamSummary(params?: ModelParams): ModelParamSummaryEntry[] {
  if (!params) return [];
  const entries: ModelParamSummaryEntry[] = [];
  if (params.maxTokens !== undefined) entries.push({ label: 'max tokens', value: String(params.maxTokens) });
  if (params.reasoningEffort !== undefined) entries.push({ label: 'reasoning effort', value: params.reasoningEffort });
  return entries;
}
