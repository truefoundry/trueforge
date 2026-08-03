/**
 * Configured MCP server domain + wire schemas: the `mcp_server.manifest` JSONB
 * document, admin/chat list projections, and auth_status. Catalog file schemas
 * live in mcpCatalog.ts.
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

export const McpAuthStatusSchema = z
  .object({
    status: z.enum(['authenticated', 'auth_required']),
    authorization_url: z
      .string()
      .url()
      .optional()
      .describe('Present only when status is auth_required and a live authorize flow produced a URL.'),
  })
  .strict()
  .openapi('McpAuthStatus');

/** Admin/settings wire view: manifest fields plus nested auth_status. */
export const ConfiguredMcpServerSchema = McpServerManifestObjectSchema.extend({
  auth_status: McpAuthStatusSchema,
}).openapi('ConfiguredMcpServer');

export const PutMcpServerRequestSchema = McpServerManifestSchema;
export const PutMcpServerResponseSchema = z.object({ data: ConfiguredMcpServerSchema }).openapi('PutMcpServerResponse');
export const ListConfiguredMcpServersResponseSchema = z
  .object({ data: z.array(ConfiguredMcpServerSchema) })
  .openapi('ListConfiguredMcpServersResponse');

/** Chat/composer read view — no auth or auth_status. */
export const McpServerReadEntrySchema = z
  .object({
    name: NameSchema,
    url: z.string().url(),
  })
  .strict()
  .openapi('McpServerReadEntry');

export const ListAvailableMcpServersResponseSchema = z
  .object({ data: z.array(McpServerReadEntrySchema) })
  .openapi('ListAvailableMcpServersResponse');

export type McpServerAuthSettings = z.infer<typeof McpServerAuthSettingsSchema>;
export type McpServerManifest = z.infer<typeof McpServerManifestSchema>;
export type McpAuthStatus = z.infer<typeof McpAuthStatusSchema>;
export type ConfiguredMcpServer = z.infer<typeof ConfiguredMcpServerSchema>;
export type McpServerReadEntry = z.infer<typeof McpServerReadEntrySchema>;

/** Stub auth_status until the token store backs a real check. */
export function toStubAuthStatus(manifest: McpServerManifest): McpAuthStatus {
  return manifest.auth ? { status: 'auth_required' } : { status: 'authenticated' };
}
