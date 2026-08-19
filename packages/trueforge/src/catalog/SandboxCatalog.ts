/**
 * Shipped sandbox catalog (sandbox-catalog.yaml): the discovery list of provider
 * presets offered by GET /catalogs/sandbox-providers for the UI to copy into
 * PUT /settings/sandbox-providers bodies. Never consulted on writes and never
 * read by the runtime.
 *
 * Default: YAML inlined into `sandboxCatalog.gen.ts` at build time. Optional
 * override: `SANDBOX_CATALOG_PATH` (file on disk).
 */
import configuration from '../config';
import { SandboxCatalogFileSchema, type CatalogSandboxProvider } from '../schemas/sandboxCatalog';
import { loadYamlAtPath, parseYamlString } from './loadYaml';
import { shippedSandboxCatalogYaml } from './sandboxCatalog.gen';

export class SandboxCatalog {
  private readonly providers: readonly CatalogSandboxProvider[];

  constructor(providers: readonly CatalogSandboxProvider[]) {
    this.providers = providers;
  }

  /** Loads and validates the catalog. Throws on any error. */
  static load(): SandboxCatalog {
    if (configuration.SANDBOX_CATALOG_PATH !== undefined) {
      const file = loadYamlAtPath(configuration.SANDBOX_CATALOG_PATH, SandboxCatalogFileSchema);
      return new SandboxCatalog(file.providers);
    }
    const file = parseYamlString(shippedSandboxCatalogYaml, SandboxCatalogFileSchema, 'shipped sandbox-catalog');
    return new SandboxCatalog(file.providers);
  }

  list(): readonly CatalogSandboxProvider[] {
    return this.providers;
  }
}
