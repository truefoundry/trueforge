import configuration from '../config';
import { WebSearchCatalogFileSchema, type CatalogWebSearchProvider } from '../schemas/webSearchCatalog';
import { loadYamlAtPath, parseYamlString } from './loadYaml';
import { shippedWebSearchCatalogYaml } from './webSearchCatalog.gen';

export class WebSearchCatalog {
  private readonly providers: readonly CatalogWebSearchProvider[];

  constructor(providers: readonly CatalogWebSearchProvider[]) {
    this.providers = providers;
  }

  static load(): WebSearchCatalog {
    if (configuration.WEB_SEARCH_CATALOG_PATH) {
      const file = loadYamlAtPath(configuration.WEB_SEARCH_CATALOG_PATH, WebSearchCatalogFileSchema);
      return new WebSearchCatalog(file.providers);
    }
    const file = parseYamlString(shippedWebSearchCatalogYaml, WebSearchCatalogFileSchema, 'shipped web-search-catalog');
    return new WebSearchCatalog(file.providers);
  }

  list(): readonly CatalogWebSearchProvider[] {
    return this.providers;
  }
}
