import configuration from '../config';
import { MemoryCatalogFileSchema, type CatalogMemoryProvider } from '../schemas/memoryCatalog';
import { loadYamlAtPath, parseYamlString } from './loadYaml';
import { shippedMemoryCatalogYaml } from './memoryCatalog.gen';

export class MemoryCatalog {
  private readonly providers: readonly CatalogMemoryProvider[];

  constructor(providers: readonly CatalogMemoryProvider[]) {
    this.providers = providers;
  }

  static load(): MemoryCatalog {
    if (configuration.MEMORY_CATALOG_PATH) {
      const file = loadYamlAtPath(configuration.MEMORY_CATALOG_PATH, MemoryCatalogFileSchema);
      return new MemoryCatalog(file.providers);
    }
    const file = parseYamlString(shippedMemoryCatalogYaml, MemoryCatalogFileSchema, 'shipped memory-catalog');
    return new MemoryCatalog(file.providers);
  }

  list(): readonly CatalogMemoryProvider[] {
    return this.providers;
  }
}
