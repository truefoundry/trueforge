/**
 * Maps trueforge-ui model-settings calls onto Harness
 *
 * UI: flat `apiKey` / model `id`. Harness: `auth.apiKey` / `modelId`.
 * Provider `id` in the UI is the Harness resource `name`.
 */
import type { TrueForge } from '@truefoundry/trueforge-sdk';
import { TrueForgeApi } from '@truefoundry/trueforge-sdk';
import type {
  CreateModelProviderRequest,
  ModelCatalogServer,
  ModelEntry,
  ModelProviderBase,
  ModelProviderCatalogEntry,
  UpdateModelProviderRequest,
} from '../../../server/types.js';

/** Custom-form rows omit properties; catalog rows round-trip them. */
export type UiModelEntry = ModelEntry & {
  properties?: TrueForgeApi.ModelProperties;
};

export type UiModelProvider = ModelProviderBase<UiModelEntry>;
export type UiModelProviderCatalogEntry = ModelProviderCatalogEntry<UiModelEntry>;

export function toUiModelEntry(model: TrueForgeApi.ConfiguredModel): UiModelEntry {
  return {
    id: model.modelId,
    name: model.name,
    properties: model.properties,
  };
}

export function toHarnessModelEntry(model: UiModelEntry): TrueForgeApi.ConfiguredModel {
  return {
    modelId: model.id,
    name: model.name,
    properties: model.properties ?? {},
  };
}

export function toUiModelProvider(provider: TrueForgeApi.ConfiguredModelProvider): UiModelProvider {
  const { name, manifest } = provider;
  return {
    id: name,
    type: manifest.type,
    name,
    ...(manifest.baseUrl === undefined ? {} : { baseUrl: manifest.baseUrl }),
    models: manifest.models.map(toUiModelEntry),
  };
}

export function toUiCatalogModelProviderEntry(
  provider: TrueForgeApi.CatalogModelProvider,
): UiModelProviderCatalogEntry {
  if (provider.type === 'custom') {
    return {
      type: provider.type,
      name: provider.type,
      supportedReasoningEfforts: provider.supportedReasoningEfforts,
      models: [],
    };
  }
  return {
    type: provider.type,
    name: provider.type,
    ...(provider.logo === undefined ? {} : { logo: provider.logo }),
    models: provider.models.map(toUiModelEntry),
  };
}

const PROVIDER_TYPES: readonly string[] = [...Object.values(TrueForgeApi.CatalogWellKnownModelProviderType), 'custom'];

function isProviderType(type: string): type is Exclude<TrueForgeApi.ModelProviderManifest['type'], 'truefoundry'> {
  return PROVIDER_TYPES.includes(type);
}

export function toHarnessModelProvider(req: {
  type: string;
  name: string;
  apiKey: string;
  baseUrl?: string;
  models: UiModelEntry[];
}): TrueForgeApi.ModelProviderManifest {
  const models = req.models.map(toHarnessModelEntry);
  if (!isProviderType(req.type)) {
    throw new Error(`Unsupported model provider type: ${req.type}`);
  }
  const baseUrl = req.baseUrl?.trim() === '' ? undefined : req.baseUrl;
  // Only `custom` is named by its caller; the API names the rest after their type.
  if (req.type === 'custom') {
    if (baseUrl === undefined) {
      throw new Error(`Model providers of type "${req.type}" require a base URL`);
    }
    // Blank form field is ""; custom must omit auth on the wire (empty string is rejected).
    return {
      type: req.type,
      name: req.name,
      models,
      baseUrl,
      ...(req.apiKey === '' ? {} : { auth: { apiKey: req.apiKey } }),
    };
  }
  const auth = { apiKey: req.apiKey };
  if (baseUrl !== undefined) {
    return { type: req.type, auth, models, baseUrl };
  }
  return { type: req.type, auth, models };
}

/** Settings model-catalog port for `createTrueFoundryServer`. Delete is omitted (no BE route). */
export function createModelProviderCatalog(
  client: TrueForge,
): ModelCatalogServer<
  UiModelEntry,
  UiModelProvider,
  UiModelProviderCatalogEntry,
  CreateModelProviderRequest<UiModelEntry>,
  UpdateModelProviderRequest<UiModelEntry>
> {
  async function resolveApiKey(req: { id?: string; type?: string; apiKey: string }): Promise<string> {
    const trimmed = req.apiKey.trim();
    if (trimmed !== '') {
      return trimmed;
    }
    if (req.id === undefined) {
      // Create with a blank key: allow only for custom; "" is mapped to omitted auth below.
      if (req.type === 'custom') {
        return '';
      }
      throw new Error('API key is required');
    }
    // Update with empty means keep the stored key.
    const listed = await client.settings.modelProviders.list();
    const existing = listed.data.find(provider => provider.name === req.id);
    if (existing === undefined) {
      throw new Error(`Model provider "${req.id}" not found`);
    }
    return existing.manifest.auth?.apiKey ?? '';
  }

  return {
    getModelProviderCatalog: async () => {
      const body = await client.catalogs.modelProviders.list();
      return body.data.map(toUiCatalogModelProviderEntry);
    },
    listModelProviders: async () => {
      const body = await client.settings.modelProviders.list();
      return body.data.map(toUiModelProvider);
    },
    createModelProvider: async req => {
      const apiKey = await resolveApiKey({ type: req.type, apiKey: req.apiKey });
      const body = await client.settings.modelProviders.create({
        manifest: toHarnessModelProvider({
          type: req.type,
          name: req.name,
          apiKey,
          ...(req.baseUrl === undefined ? {} : { baseUrl: req.baseUrl }),
          models: req.models,
        }),
      });
      return toUiModelProvider(body.data);
    },
    updateModelProvider: async req => {
      // UI sends apiKey: "" when only models change; reuse the stored key.
      const apiKey = await resolveApiKey({ id: req.id, type: req.type, apiKey: req.apiKey });
      const body = await client.settings.modelProviders.createOrUpdate({
        manifest: toHarnessModelProvider({
          type: req.type,
          name: req.id,
          apiKey,
          ...(req.baseUrl === undefined ? {} : { baseUrl: req.baseUrl }),
          models: req.models,
        }),
      });
      return toUiModelProvider(body.data);
    },
  };
}
