/**
 * DB-backed configured MCP servers: one row per server per tenant,
 * identity as columns plus a Zod-validated `McpServerManifest` jsonb document.
 * Implementations: PostgresMcpServerStore and SqliteMcpServerStore.
 *
 * Also owns the DCR registration columns (`oauth_server` / `oauth_client`) via
 * `IOAuthClientStore` — those are not a separate persistence root.
 */
import type { IOAuthClientStore } from '@truefoundry/utils-core/core';
import type { ResourceName } from '../schemas/common';
import type { McpServerManifest } from '../schemas/mcpServer';

export interface McpServerRecord {
  id: string;
  tenant_id: string;
  name: ResourceName;
  manifest: McpServerManifest;
  /** ISO-8601 UTC instant. */
  created_at: string;
  /** ISO-8601 UTC instant. */
  updated_at: string;
}

export interface GetMcpServerInput {
  tenant_id: string;
  name: string;
}

export interface UpsertMcpServerInput {
  tenant_id: string;
  name: ResourceName;
  manifest: McpServerManifest;
}

export interface IMcpServerStore extends IOAuthClientStore {
  listServers(tenantId: string): Promise<McpServerRecord[]>;
  getServer(input: GetMcpServerInput): Promise<McpServerRecord | undefined>;
  /**
   * Creates the server or replaces `manifest` (+ `updated_at`) only.
   * Never overwrites `id`, `oauth_server`, or `oauth_client`.
   */
  upsertServer(input: UpsertMcpServerInput): Promise<McpServerRecord>;
}
