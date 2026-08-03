/**
 * Configured MCP server domain + wire schemas: the `mcp_server.manifest` JSONB
 * document, admin/chat list projections, and auth_status. Catalog file schemas
 * live in mcpCatalog.ts.
 *
 * Auth mirrors gateway MCP header/DCR shapes in reduced form: `header` stores
 * shared request headers on the row; `dcr` is the OAuth/DCR stub until real
 * token exchange lands. Legacy YAML still uses MCP_HEADERS /
 * MCP_{NAME}_HEADERS env vars — not this schema.
 */
import { z } from '@hono/zod-openapi';
import { NameSchema } from './common';

/** Transport/kind of MCP server. Extend when non-remote kinds ship. */
export const McpServerTypeSchema = z.enum(['remote']).openapi('McpServerType');

const McpServerHeaderAuthSchema = z
  .object({
    type: z.literal('header'),
    headers: z
      .record(z.string().min(1), z.string().min(1))
      .refine(headers => Object.keys(headers).length > 0, {
        message: 'must include at least one header',
      })
      .describe('HTTP headers sent on each request to this MCP server.'),
  })
  .strict()
  .openapi('McpServerHeaderAuth');

/** OAuth Dynamic Client Registration — stub until authorize/token exchange is wired. */
const McpServerDcrAuthSchema = z
  .object({
    type: z.literal('dcr'),
  })
  .strict()
  .openapi('McpServerDcrAuth');

export const McpServerAuthSettingsSchema = z
  .discriminatedUnion('type', [McpServerHeaderAuthSchema, McpServerDcrAuthSchema])
  .openapi('ConfiguredMcpServerAuth');

/** Configured MCP server document persisted as `mcp_server.manifest`. */
export const McpServerManifestObjectSchema = z
  .object({
    type: McpServerTypeSchema,
    name: NameSchema,
    url: z.string().url().describe('URL of the remote MCP server.'),
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

export type McpServerType = z.infer<typeof McpServerTypeSchema>;
export type McpServerAuthSettings = z.infer<typeof McpServerAuthSettingsSchema>;
export type McpServerManifest = z.infer<typeof McpServerManifestSchema>;
export type McpAuthStatus = z.infer<typeof McpAuthStatusSchema>;
export type ConfiguredMcpServer = z.infer<typeof ConfiguredMcpServerSchema>;
export type McpServerReadEntry = z.infer<typeof McpServerReadEntrySchema>;

/**
 * Headers for live MCP calls against a configured server.
 * Only `auth.type === 'header'` contributes; DCR uses tokens later, not env
 * MCP_HEADERS (those remain on the legacy YAML path).
 */
export function resolveConfiguredMcpRequestHeaders(manifest: McpServerManifest): Record<string, string> {
  if (manifest.auth?.type === 'header') {
    return { ...manifest.auth.headers };
  }
  return {};
}

/**
 * Stub auth_status until OAuth/token store backs a real check.
 * Header credentials are already on the row → authenticated.
 * DCR still needs a user authorize flow → auth_required.
 */
export function toStubAuthStatus(manifest: McpServerManifest): McpAuthStatus {
  if (manifest.auth?.type === 'dcr') {
    return { status: 'auth_required' };
  }
  return { status: 'authenticated' };
}
