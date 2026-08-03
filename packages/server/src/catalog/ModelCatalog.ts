/**
 * Shipped model catalog (model-catalog.yaml): the discovery list of provider
 * and model presets the settings UI copies into PUT /model-providers bodies.
 * Never consulted on writes and never read by the runtime.
 *
 * Default: YAML next to this module in source (`src/catalog/`) or under
 * `dist/catalog/` after build. Optional override: `MODEL_CATALOG_PATH`.
 */
import fs from 'node:fs';
import path from 'node:path';
import configuration from '../config';
import { ModelCatalogFileSchema, type CatalogProvider } from '../schemas/modelCatalog';
import { loadYamlAtPath } from './loadYaml';

const SHIPPED_CATALOG_FILE = 'model-catalog.yaml';

/**
 * Resolves the built-in catalog path for source (tsx) and bundled (dist/main.js)
 * layouts — same approach as migration folders beside the main bundle.
 */
function shippedCatalogPath(): string {
  const besideModule = path.join(import.meta.dirname, SHIPPED_CATALOG_FILE);
  if (fs.existsSync(besideModule)) {
    return besideModule;
  }
  return path.join(import.meta.dirname, 'catalog', SHIPPED_CATALOG_FILE);
}

export class ModelCatalog {
  private readonly providers: readonly CatalogProvider[];

  constructor(providers: readonly CatalogProvider[]) {
    this.providers = providers;
  }

  /** Loads and validates the catalog. Throws on any error. */
  static load(): ModelCatalog {
    const filePath = configuration.MODEL_CATALOG_PATH ?? shippedCatalogPath();
    const file = loadYamlAtPath(filePath, ModelCatalogFileSchema);
    return new ModelCatalog(file.providers);
  }

  list(): readonly CatalogProvider[] {
    return this.providers;
  }
}
