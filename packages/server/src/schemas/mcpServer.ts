/**
 * Configured MCP server domain + wire schemas: the `mcp_server.manifest` JSONB
 * document, admin/chat list projections, and auth_status. Catalog file schemas
 * live in mcpCatalog.ts.
 *
 * Auth: `header` stores shared request headers on the row (settings listTools);
 * turn execution resolves DCR tokens via resolveMcpAuth.
 */
import { z } from '@hono/zod-openapi';
import type { OAuthToken } from '../mcp/auth/types';
import { NameSchema } from './common';

/** Transport/kind of MCP server. Extend when non-remote kinds ship. */
export const McpServerTypeSchema = z.enum(['remote']).openapi('McpServerType');

const McpServerHeaderAuthSchema = z
  .object({
    type: z.literal('header').describe('Authenticate with static HTTP headers.'),
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
    type: z.literal('dcr').describe('Authenticate via OAuth Dynamic Client Registration.'),
  })
  .strict()
  .openapi('McpServerDcrAuth');

export const McpServerAuthSettingsSchema = z
  .discriminatedUnion('type', [McpServerHeaderAuthSchema, McpServerDcrAuthSchema])
  .openapi('ConfiguredMcpServerAuth');

/** Configured MCP server document persisted as `mcp_server.manifest`. */
export const McpServerManifestObjectSchema = z
  .object({
    type: McpServerTypeSchema.describe('MCP server kind (`remote` today).'),
    name: NameSchema,
    url: z.url().describe('URL of the remote MCP server.'),
    auth: McpServerAuthSettingsSchema.optional().describe(
      'Optional auth settings. Omit when the server needs no credentials.',
    ),
  })
  .strict();

export const McpServerManifestSchema = McpServerManifestObjectSchema.openapi('McpServerManifest');

export const McpAuthStatusSchema = z
  .object({
    status: z
      .enum(['authenticated', 'auth_required', 'not_required'])
      .describe('Current auth state for this MCP server.'),
    authorization_url: z
      .url()
      .optional()
      .describe('When auth is required, this contains the URL to redirect the user to for authorization.'),
  })
  .strict()
  .openapi('McpAuthStatus');

/** Admin/settings wire view: manifest fields plus nested auth_status. */
export const ConfiguredMcpServerSchema = McpServerManifestObjectSchema.extend({
  auth_status: McpAuthStatusSchema,
}).openapi('ConfiguredMcpServer');

export const PutMcpServerRequestSchema = McpServerManifestSchema;
export const PutMcpServerResponseSchema = z.object({ data: ConfiguredMcpServerSchema }).openapi('PutMcpServerResponse');
export const GetMcpServerResponseSchema = z.object({ data: ConfiguredMcpServerSchema }).openapi('GetMcpServerResponse');
export const ListMcpServersResponseSchema = z
  .object({ data: z.array(ConfiguredMcpServerSchema) })
  .openapi('ListMcpServersResponse');

/** Public auth mechanism for chat/composer (no secrets). */
export const McpServerAuthPublicSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('dcr') }).strict(),
    z.object({ type: z.literal('header') }).strict(),
  ])
  .openapi('McpServerAuthPublic');

/** Chat/composer read view — public fields plus per-user auth_status. */
export const McpServerReadEntrySchema = z
  .object({
    name: NameSchema,
    url: z.url().describe('URL of the remote MCP server.'),
    auth: McpServerAuthPublicSchema.optional().describe(
      'Auth mechanism when configured (no secrets). Omit when the server needs no credentials.',
    ),
    auth_status: McpAuthStatusSchema.describe('Auth state for the calling user.'),
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
export type McpServerAuthPublic = z.infer<typeof McpServerAuthPublicSchema>;
export type ConfiguredMcpServer = z.infer<typeof ConfiguredMcpServerSchema>;
export type McpServerReadEntry = z.infer<typeof McpServerReadEntrySchema>;

/**
 * Headers for live MCP calls against a configured server.
 * Only `auth.type === 'header'` contributes. Turn execution uses DCR via
 * resolveMcpAuth instead of this helper.
 */
export function resolveConfiguredMcpRequestHeaders(manifest: McpServerManifest): Record<string, string> {
  if (manifest.auth?.type === 'header') {
    return { ...manifest.auth.headers };
  }
  return {};
}

export function resolveMcpAuthStatus({
  manifest,
  token,
}: {
  manifest: McpServerManifest;
  token?: OAuthToken;
}): McpAuthStatus {
  if (manifest.auth?.type === 'dcr') {
    return token ? { status: 'authenticated' } : { status: 'auth_required' };
  }
  if (manifest.auth?.type === 'header') {
    return { status: 'authenticated' };
  }
  return { status: 'not_required' };
}
