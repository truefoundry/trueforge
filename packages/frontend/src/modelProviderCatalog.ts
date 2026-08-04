/**
 * Maps agent-ui-sdk model-settings calls onto Harness
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
} from '@truefoundry/agent-ui-sdk';
import { TrueHarness as Harness, TrueHarnessClient } from 'trueharness';

/** Custom-form rows omit properties; catalog rows round-trip them. */
export type UiModelEntry = ModelEntry & {
  properties?: Harness.ModelProperties;
};

export type UiModelProvider = ModelProviderBase<UiModelEntry>;
export type UiModelProviderCatalogEntry = ModelProviderCatalogEntry<UiModelEntry>;

const DEFAULT_MODEL_PROPERTIES: Harness.ModelProperties = {
  contextLength: 128_000,
  maxOutputTokens: 16_384,
};

const client = new TrueHarnessClient({ environment: '/' });

export function toUiModelEntry(model: Harness.ModelEntry): UiModelEntry {
  return {
    id: model.modelId,
    name: model.name,
    properties: model.properties,
  };
}

export function toHarnessModelEntry(model: UiModelEntry): Harness.ModelEntry {
  return {
    modelId: model.id,
    name: model.name,
    properties: model.properties ?? DEFAULT_MODEL_PROPERTIES,
  };
}

export function toUiModelProvider(provider: Harness.ModelProvider): UiModelProvider {
  return {
    id: provider.name,
    type: provider.type,
    name: provider.name,
    ...(provider.baseUrl === undefined ? {} : { baseUrl: provider.baseUrl }),
    models: provider.models.map(toUiModelEntry),
  };
}

export function toUiCatalogEntry(provider: Harness.CatalogProvider): UiModelProviderCatalogEntry {
  return {
    type: provider.type,
    name: provider.name,
    models: provider.models.map(toUiModelEntry),
  };
}

const WELL_KNOWN_TYPES: readonly string[] = Object.values(Harness.WellKnownModelProviderType);
const CALLER_SUPPLIED_TYPES: readonly string[] = Object.values(Harness.CallerSuppliedModelProviderType);

function isWellKnownType(type: string): type is Harness.WellKnownModelProviderType {
  return WELL_KNOWN_TYPES.includes(type);
}

function isCallerSuppliedType(type: string): type is Harness.CallerSuppliedModelProviderType {
  return CALLER_SUPPLIED_TYPES.includes(type);
}

export function toHarnessModelProvider(req: {
  type: string;
  name: string;
  apiKey: string;
  baseUrl?: string;
  models: UiModelEntry[];
}): Harness.ModelProvider {
  const models = req.models.map(toHarnessModelEntry);
  const auth = { apiKey: req.apiKey };
  if (isWellKnownType(req.type)) {
    return {
      type: req.type,
      name: req.name,
      auth,
      models,
      ...(req.baseUrl === undefined ? {} : { baseUrl: req.baseUrl }),
    };
  }
  if (isCallerSuppliedType(req.type)) {
    if (req.baseUrl === undefined || req.baseUrl.trim() === '') {
      throw new Error(`Model providers of type "${req.type}" require a base URL`);
    }
    return {
      type: req.type,
      name: req.name,
      auth,
      models,
      baseUrl: req.baseUrl,
    };
  }
  throw new Error(`Unsupported model provider type: ${req.type}`);
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
  const existing = listed.data.find(provider => provider.name === req.id);
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
