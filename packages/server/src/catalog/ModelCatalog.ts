/**
 * Shipped model catalog (model-catalog.yaml): the discovery list of provider
 * and model presets the settings UI copies into PUT /settings/model-providers bodies.
 * Never consulted on writes and never read by the runtime.
 *
 * Default: YAML inlined into `modelCatalog.gen.ts` at build time. Optional
 * override: `MODEL_CATALOG_PATH` (file on disk).
 */
import configuration from '../config';
import { ModelCatalogFileSchema, type CatalogProvider } from '../schemas/modelCatalog';
import { loadYamlAtPath, parseYamlString } from './loadYaml';
import { shippedModelCatalogYaml } from './modelCatalog.gen';

export class ModelCatalog {
  private readonly providers: readonly CatalogProvider[];

  constructor(providers: readonly CatalogProvider[]) {
    this.providers = providers;
  }

  /** Loads and validates the catalog. Throws on any error. */
  static load(): ModelCatalog {
    if (configuration.MODEL_CATALOG_PATH !== undefined) {
      const file = loadYamlAtPath(configuration.MODEL_CATALOG_PATH, ModelCatalogFileSchema);
      return new ModelCatalog(file.providers);
    }
    const file = parseYamlString(shippedModelCatalogYaml, ModelCatalogFileSchema, 'shipped model-catalog');
    return new ModelCatalog(file.providers);
  }

  list(): readonly CatalogProvider[] {
    return this.providers;
  }
}
