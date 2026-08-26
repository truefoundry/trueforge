import { createHash } from 'node:crypto';

import { OpenRouter } from '@openrouter/sdk';
import type { Model as OpenRouterModel } from '@openrouter/sdk/models';
import { SUPPORTED_REASONING_EFFORTS } from '@truefoundry/trueforge-core/core';

import { OPENROUTER_APP_TITLE, OPENROUTER_APP_URL } from '../openRouter';
import type { ConfiguredModel, ModelProperties, ReasoningEffort } from '../schemas/modelProvider';

type OpenRouterCatalogModel = Pick<OpenRouterModel, 'contextLength' | 'id' | 'reasoning' | 'topProvider'>;

const openRouter = new OpenRouter({
  appTitle: OPENROUTER_APP_TITLE,
  httpReferer: OPENROUTER_APP_URL,
  retryConfig: { strategy: 'none' },
  timeoutMs: 5_000,
});

function isReasoningEffort(value: string | null): value is ReasoningEffort {
  return value !== null && SUPPORTED_REASONING_EFFORTS.some(effort => effort === value);
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8);
}

function resourceNameForModelId(modelId: string): string {
  let normalized = modelId
    .toLowerCase()
    .replace(/^~+/, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/[^a-z0-9]+$/, '');
  if (normalized.length < 2) {
    normalized = `model-${shortHash(modelId)}`;
  }
  if (normalized.length <= 64) {
    return normalized;
  }
  const prefix = normalized.slice(0, 55).replace(/[^a-z0-9]+$/, '');
  return `${prefix}-${shortHash(modelId)}`;
}

function modelProperties(model: OpenRouterCatalogModel): ModelProperties {
  const efforts = [...new Set((model.reasoning?.supportedEfforts ?? []).filter(isReasoningEffort))];
  const maxOutputTokens = model.topProvider.maxCompletionTokens;
  return {
    ...(model.contextLength === null || model.contextLength <= 0 ? {} : { context_length: model.contextLength }),
    ...(maxOutputTokens === null || maxOutputTokens === undefined || maxOutputTokens <= 0
      ? {}
      : { max_output_tokens: maxOutputTokens }),
    ...(efforts.length === 0 ? {} : { reasoning_efforts: efforts }),
  };
}

export function mapOpenRouterModels(models: readonly OpenRouterCatalogModel[]): ConfiguredModel[] {
  const names = new Map<string, string>();
  return models.map(model => {
    const baseName = resourceNameForModelId(model.id);
    const priorModelId = names.get(baseName);
    const name =
      priorModelId === undefined || priorModelId === model.id
        ? baseName
        : `${baseName.slice(0, 55).replace(/[^a-z0-9]+$/, '')}-${shortHash(model.id)}`;
    names.set(name, model.id);
    return {
      model_id: model.id,
      name,
      properties: modelProperties(model),
    };
  });
}

export async function listOpenRouterModels(): Promise<ConfiguredModel[]> {
  const models: OpenRouterModel[] = [];
  const pages = await openRouter.models.list({ limit: 1_000 });
  for await (const page of pages) {
    models.push(...page.result.data);
  }
  return mapOpenRouterModels(models);
}
