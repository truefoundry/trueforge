/**
 * Configured MCP server domain schemas: the `mcp_server.manifest` JSONB
 * document used by the DB-backed catalog/CRUD path. Catalog file schemas live
 * in mcpCatalog.ts.
 */
import { z } from '@hono/zod-openapi';
import { NameSchema } from './common';

export const McpServerAuthSettingsSchema = z
  .discriminatedUnion('type', [z.object({ type: z.literal('dcr') })])
  .openapi('McpServerAuthSettings');

/** Configured MCP server document; `name` is the natural key within a tenant. */
export const McpServerManifestObjectSchema = z
  .object({
    name: NameSchema.describe('Natural key within a tenant; join key with the catalog.'),
    url: z.string().url(),
    auth: McpServerAuthSettingsSchema.optional(),
  })
  .strict();

export const McpServerManifestSchema = McpServerManifestObjectSchema.openapi('McpServerManifest');

export type McpServerAuthSettings = z.infer<typeof McpServerAuthSettingsSchema>;
export type McpServerManifest = z.infer<typeof McpServerManifestSchema>;
