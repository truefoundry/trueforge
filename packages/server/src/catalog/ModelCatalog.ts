/**
 * Shipped model catalog (model-catalog.yaml): the discovery list of provider
 * and model presets the settings UI copies into PUT /model-providers bodies.
 * Never consulted on writes and never read by the runtime.
 */
import { CONFIG_FILES } from '../config';
import { loadYamlFile } from '../store/loadYaml';
import { ModelCatalogFileSchema, type CatalogProvider } from './schemas';

export class ModelCatalog {
  private readonly providers: CatalogProvider[];

  constructor(providers: CatalogProvider[]) {
    this.providers = providers;
  }

  /** Loads and validates model-catalog.yaml from `REGISTRY_DIR`. Throws on any error. */
  static load(): ModelCatalog {
    const file = loadYamlFile(CONFIG_FILES.modelCatalog, ModelCatalogFileSchema);
    return new ModelCatalog(file.providers);
  }

  list(): CatalogProvider[] {
    return this.providers;
  }
}
