/**
 * Maps trueforge-ui model-settings calls onto Harness
 * `/api/v1/settings/model-providers` (name-keyed upsert, no delete).
 *
 * UI: flat `apiKey` / model `id`. Harness: `auth.apiKey` / `modelId`.
 * Provider `id` in the UI is the Harness resource `name`.
 */
import type {
  CreateModelProviderRequest,
  ModelCatalogServer,
  ModelEntry,
  ModelProviderBase,
  ModelProviderCatalogEntry,
  UpdateModelProviderRequest,
} from '@truefoundry/trueforge-ui';
import { TrueForgeApi } from 'trueforge-sdk';
import { harnessClient as client } from './harnessClient';
/** Custom-form rows omit properties; catalog rows round-trip them. */
export type UiModelEntry = ModelEntry & {
  properties?: TrueForgeApi.ModelProperties;
};

export type UiModelProvider = ModelProviderBase<UiModelEntry>;
export type UiModelProviderCatalogEntry = ModelProviderCatalogEntry<UiModelEntry>;

const DEFAULT_MODEL_PROPERTIES: TrueForgeApi.ModelProperties = {
  contextLength: 128_000,
  maxOutputTokens: 16_384,
};

export function toUiModelEntry(model: TrueForgeApi.ModelEntry): UiModelEntry {
  return {
    id: model.modelId,
    name: model.name,
    properties: model.properties,
  };
}

export function toHarnessModelEntry(model: UiModelEntry): TrueForgeApi.ModelEntry {
  return {
    modelId: model.id,
    name: model.name,
    properties: model.properties ?? DEFAULT_MODEL_PROPERTIES,
  };
}

export function toUiModelProvider(provider: TrueForgeApi.ModelProvider): UiModelProvider {
  // Every type but `custom` is named after itself, so the wire leaves `name` optional.
  const name = provider.name ?? provider.type;
  return {
    id: name,
    type: provider.type,
    name,
    ...(provider.baseUrl === undefined ? {} : { baseUrl: provider.baseUrl }),
    models: provider.models.map(toUiModelEntry),
  };
}

export function toUiCatalogEntry(provider: TrueForgeApi.CatalogProvider): UiModelProviderCatalogEntry {
  return {
    type: provider.type,
    name: provider.name,
    ...(provider.logo === undefined ? {} : { logo: provider.logo }),
    models: provider.models.map(toUiModelEntry),
  };
}

/** The catalog lists every type but `custom`, which only exists as tenant configuration. */
const PROVIDER_TYPES: readonly string[] = [...Object.values(TrueForgeApi.CatalogProviderType), 'custom'];

function isProviderType(type: string): type is TrueForgeApi.ModelProvider['type'] {
  return PROVIDER_TYPES.includes(type);
}

export function toHarnessModelProvider(req: {
  type: string;
  name: string;
  apiKey: string;
  baseUrl?: string;
  models: UiModelEntry[];
}): TrueForgeApi.ModelProvider {
  const models = req.models.map(toHarnessModelEntry);
  const auth = { apiKey: req.apiKey };
  if (!isProviderType(req.type)) {
    throw new Error(`Unsupported model provider type: ${req.type}`);
  }
  const baseUrl = req.baseUrl?.trim() === '' ? undefined : req.baseUrl;
  // Only `custom` is named by its caller; the API names the rest after their type.
  if (req.type === 'custom') {
    if (baseUrl === undefined) {
      throw new Error(`Model providers of type "${req.type}" require a base URL`);
    }
    return { type: req.type, name: req.name, auth, models, baseUrl };
  }
  if (baseUrl !== undefined) {
    return { type: req.type, auth, models, baseUrl };
  }
  return { type: req.type, auth, models };
}

async function resolveApiKey(req: { id?: string; apiKey: string }): Promise<string> {
  const trimmed = req.apiKey.trim();
  if (trimmed !== '') {
    return trimmed;
  }
  if (req.id === undefined) {
    throw new Error('API key is required');
  }
  const listed = await client.settings.modelProviders.list();
  const existing = listed.data.find(provider => toUiModelProvider(provider).id === req.id);
  if (existing === undefined) {
    throw new Error(`Model provider "${req.id}" not found`);
  }
  return existing.auth.apiKey;
}

async function upsertFromUi(req: {
  type: string;
  name: string;
  apiKey: string;
  baseUrl?: string;
  models: UiModelEntry[];
}): Promise<UiModelProvider> {
  const body = await client.settings.modelProviders.upsert(
    toHarnessModelProvider({
      type: req.type,
      name: req.name,
      apiKey: req.apiKey,
      ...(req.baseUrl === undefined ? {} : { baseUrl: req.baseUrl }),
      models: req.models,
    }),
  );
  return toUiModelProvider(body.data);
}

/** Settings model-catalog port for `createTrueFoundryServer`. Delete is omitted (no BE route). */
export function createModelProviderCatalog(): ModelCatalogServer<
  UiModelEntry,
  UiModelProvider,
  UiModelProviderCatalogEntry,
  CreateModelProviderRequest<UiModelEntry>,
  UpdateModelProviderRequest<UiModelEntry>
> {
  return {
    getModelProviderCatalog: async () => {
      const body = await client.settings.modelProviders.catalog();
      return body.data.map(toUiCatalogEntry);
    },
    listModelProviders: async () => {
      const body = await client.settings.modelProviders.list();
      return body.data.map(toUiModelProvider);
    },
    createModelProvider: async req => {
      const apiKey = await resolveApiKey({ apiKey: req.apiKey });
      return upsertFromUi({
        type: req.type,
        name: req.name,
        apiKey,
        ...(req.baseUrl === undefined ? {} : { baseUrl: req.baseUrl }),
        models: req.models,
      });
    },
    updateModelProvider: async req => {
      // UI sends apiKey: "" when only models change; reuse the stored key.
      const apiKey = await resolveApiKey({ id: req.id, apiKey: req.apiKey });
      return upsertFromUi({
        type: req.type,
        name: req.id,
        apiKey,
        ...(req.baseUrl === undefined ? {} : { baseUrl: req.baseUrl }),
        models: req.models,
      });
    },
  };
}
