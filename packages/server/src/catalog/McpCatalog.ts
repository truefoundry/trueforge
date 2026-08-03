/**
 * Shipped MCP catalog (mcp-catalog.yaml): the discovery list of server
 * presets the settings UI copies into PUT /mcp-servers bodies.
 * Never consulted on writes and never read by the runtime.
 *
 * Default: YAML next to this module in source (`src/catalog/`) or under
 * `dist/catalog/` after build. Optional override: `MCP_CATALOG_PATH`.
 */
import fs from 'node:fs';
import path from 'node:path';
import configuration from '../config';
import { McpCatalogFileSchema, type CatalogMcpServer } from '../schemas/mcpCatalog';
import { loadYamlAtPath } from './loadYaml';

const SHIPPED_CATALOG_FILE = 'mcp-catalog.yaml';

/**
 * Resolves the built-in catalog path for source (tsx) and bundled (dist/main.js)
 * layouts — same approach as ModelCatalog and migration folders beside the bundle.
 */
function shippedCatalogPath(): string {
  const besideModule = path.join(import.meta.dirname, SHIPPED_CATALOG_FILE);
  if (fs.existsSync(besideModule)) {
    return besideModule;
  }
  return path.join(import.meta.dirname, 'catalog', SHIPPED_CATALOG_FILE);
}

export class McpCatalog {
  private readonly mcpServers: readonly CatalogMcpServer[];

  constructor(mcpServers: readonly CatalogMcpServer[]) {
    this.mcpServers = mcpServers;
  }

  /** Loads and validates the catalog. Throws on any error. */
  static load(): McpCatalog {
    const filePath = configuration.MCP_CATALOG_PATH ?? shippedCatalogPath();
    const file = loadYamlAtPath(filePath, McpCatalogFileSchema);
    return new McpCatalog(file.mcp_servers);
  }

  list(): readonly CatalogMcpServer[] {
    return this.mcpServers;
  }
}
