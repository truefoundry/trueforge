/**
 * Catalog of MCP servers from mcp.yaml. Auth headers come from the
 * MCP_HEADERS / MCP_{NAME}_HEADERS env vars and are never exposed in list
 * output.
 */
import { loadYamlFile } from '../catalog/loadYaml';
import configuration, { CONFIG_FILES, normalizeEnvName } from '../config';
import { McpFileSchema, type McpServerEntry } from './schemas';

export class McpStore {
  private readonly mcpServers: McpServerEntry[];

  constructor(mcpServers: McpServerEntry[]) {
    this.mcpServers = mcpServers;
  }

  /** Loads and validates mcp.yaml. Throws on any error. */
  static load(): McpStore {
    return new McpStore(loadYamlFile(CONFIG_FILES.mcpServers, McpFileSchema).mcp_servers);
  }

  list(): McpServerEntry[] {
    return this.mcpServers;
  }

  get(name: string): McpServerEntry | undefined {
    return this.mcpServers.find(server => server.name === name);
  }

  /** Headers for requests to the given MCP server: defaults overlaid with per-server overrides. */
  getHeaders(name: string): Record<string, string> {
    return {
      ...configuration.MCP_HEADERS,
      ...configuration.MCP_HEADERS_BY_NAME[normalizeEnvName(name)],
    };
  }
}
