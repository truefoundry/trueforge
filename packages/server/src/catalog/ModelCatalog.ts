/**
 * Shipped model catalog (model-catalog.yaml): the discovery list of provider
 * and model presets the settings UI copies into PUT /model-providers bodies.
 * Never consulted on writes and never read by the runtime.
 */
import configuration from '../config';
import { ModelCatalogFileSchema, type CatalogProvider } from '../schemas/modelCatalog';
import { loadYamlAtPath } from './loadYaml';

export class ModelCatalog {
  private readonly providers: CatalogProvider[];

  constructor(providers: CatalogProvider[]) {
    this.providers = providers;
  }

  /** Loads and validates the catalog at `MODEL_CATALOG_PATH`. Throws on any error. */
  static load(): ModelCatalog {
    const file = loadYamlAtPath(configuration.MODEL_CATALOG_PATH, ModelCatalogFileSchema);
    return new ModelCatalog(file.providers);
  }

  list(): CatalogProvider[] {
    return this.providers;
  }
}
