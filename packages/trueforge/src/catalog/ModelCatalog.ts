/**
 * Shipped model catalog (model-catalog.yaml): the discovery list of provider
 * and model presets offered by GET /catalogs/model-providers for the UI to copy
 * into PUT /settings/model-providers bodies. Never consulted on writes and never
 * read by the runtime.
 *
 * Default: YAML inlined into `modelCatalog.gen.ts` at build time. Optional
 * override: `MODEL_CATALOG_PATH` (file on disk).
 */
import configuration from '../config';
import { ModelCatalogFileSchema, type CatalogWellKnownModelProvider } from '../schemas/modelCatalog';
import { loadYamlAtPath, parseYamlString } from './loadYaml';
import { shippedModelCatalogYaml } from './modelCatalog.gen';
import { listOpenRouterModels } from './openRouterModelCatalog';

const SYNC_TTL_MS = 5 * 60 * 1_000;

export class ModelCatalog {
  private readonly providers: readonly CatalogWellKnownModelProvider[];
  private readonly listOpenRouterModels: () => Promise<CatalogWellKnownModelProvider['models']>;
  private openRouterModels: CatalogWellKnownModelProvider['models'] | undefined;
  private lastSyncAt = 0;

  constructor({
    providers,
    listOpenRouterModels,
  }: {
    providers: readonly CatalogWellKnownModelProvider[];
    listOpenRouterModels: () => Promise<CatalogWellKnownModelProvider['models']>;
  }) {
    this.providers = providers;
    this.listOpenRouterModels = listOpenRouterModels;
  }

  /** Loads and validates the catalog. Throws on any error. */
  static load(options?: {
    listOpenRouterModels?: () => Promise<CatalogWellKnownModelProvider['models']>;
  }): ModelCatalog {
    const listModels = options?.listOpenRouterModels ?? listOpenRouterModels;
    if (configuration.MODEL_CATALOG_PATH !== undefined) {
      const file = loadYamlAtPath(configuration.MODEL_CATALOG_PATH, ModelCatalogFileSchema);
      return new ModelCatalog({ providers: file.providers, listOpenRouterModels: listModels });
    }
    const file = parseYamlString(shippedModelCatalogYaml, ModelCatalogFileSchema, 'shipped model-catalog');
    return new ModelCatalog({ providers: file.providers, listOpenRouterModels: listModels });
  }

  /** Refreshes OpenRouter's volatile model list while retaining shipped presets on any failure. */
  async sync(): Promise<void> {
    const now = Date.now();
    if (now - this.lastSyncAt < SYNC_TTL_MS) {
      return;
    }
    this.lastSyncAt = now;
    try {
      const models = await this.listOpenRouterModels();
      if (models.length > 0) {
        this.openRouterModels = models;
      }
    } catch {
      // The shipped OpenRouter presets keep local startup and settings independent of the remote catalog.
    }
  }

  list(): readonly CatalogWellKnownModelProvider[] {
    if (this.openRouterModels === undefined) {
      return this.providers;
    }
    return this.providers.map(provider =>
      provider.type === 'openrouter' ? { ...provider, models: this.openRouterModels ?? provider.models } : provider,
    );
  }
}
