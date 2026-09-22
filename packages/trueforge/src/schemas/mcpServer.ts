/**
 * Configured MCP server domain + wire schemas: the `mcp_server.manifest` JSONB
 * document, admin/chat list projections, and auth_status. Catalog file schemas
 * live in mcpCatalog.ts.
 *
 * McpServerManifest is a `type`-discriminated oneOf of
 * RemoteMcpServerManifest | TrueFoundryMcpServerManifest.
 *
 * Auth: `header` stores shared request headers on the row.
 * Turn execution resolves DCR tokens via resolveMcpAuth.
 */
import { z } from '@hono/zod-openapi';
import type { OAuthToken } from '../mcp/auth/types';
import { NameSchema } from './common';

const MCP_SERVER_TYPES = ['remote', 'truefoundry'] as const;

/**
 * Transport/kind of MCP server.
 * `remote` — user-configured URL (standalone / local registry).
 * `truefoundry` — TrueFoundry-managed: gateway proxy URL.
 */
export const McpServerTypeSchema = z.enum(MCP_SERVER_TYPES).openapi('MCPServerType');

const McpServerHeaderAuthSchema = z
  .object({
    type: z.literal('header').describe('Authenticate with static HTTP headers.'),
    headers: z
      .record(z.string().min(1), z.string().min(1))
      .refine(headers => Object.keys(headers).length > 0, {
        message: 'must include at least one header',
      })
      .describe(
        'Request headers for this MCP server. Responses are redacted; on PUT, a real value sets/rotates and a redacted value keeps the stored secret for that header name.',
      ),
  })
  .strict()
  .openapi('MCPServerHeaderAuth');

/** OAuth Dynamic Client Registration — stub until authorize/token exchange is wired. */
const McpServerDcrAuthSchema = z
  .object({
    type: z.literal('dcr').describe('Authenticate via OAuth Dynamic Client Registration.'),
  })
  .strict()
  .openapi('MCPServerDcrAuth');

export const McpServerManifestAuthSchema = z
  .discriminatedUnion('type', [McpServerHeaderAuthSchema, McpServerDcrAuthSchema])
  .describe('Optional auth settings. Omit when the server needs no credentials.')
  .openapi('MCPServerManifestAuth');

export const McpServerDescriptionSchema = z
  .string()
  .trim()
  .min(1)
  .describe('Concise summary of what this MCP server provides.');

/** User-configured remote MCP endpoint. */
const RemoteMcpServerManifestSchema = z
  .object({
    type: z.literal(McpServerTypeSchema.enum.remote),
    name: NameSchema,
    url: z.url().describe('MCP endpoint URL.'),
    description: McpServerDescriptionSchema,
    auth: McpServerManifestAuthSchema.optional(),
  })
  .strict()
  .openapi('RemoteMCPServerManifest');

/** TrueFoundry-managed MCP server; `url` is the resolved AI Gateway proxy URL. */
const TrueFoundryMcpServerManifestSchema = z
  .object({
    type: z.literal(McpServerTypeSchema.enum.truefoundry),
    name: NameSchema,
    url: z.url().describe('Resolved AI Gateway proxy URL for this TrueFoundry-managed MCP server.'),
    description: McpServerDescriptionSchema,
    auth: McpServerManifestAuthSchema.optional(),
  })
  .strict()
  .openapi('TrueFoundryMCPServerManifest');

export const McpServerManifestSchema = z
  .discriminatedUnion('type', [RemoteMcpServerManifestSchema, TrueFoundryMcpServerManifestSchema])
  .openapi('MCPServerManifest');

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
  .describe('Current auth state.')
  .openapi('MCPAuthStatus');

/** Admin/settings wire view: identity column plus nested manifest and auth_status. */
export const ConfiguredMcpServerSchema = z
  .object({
    name: NameSchema,
    manifest: McpServerManifestSchema,
    auth_status: McpAuthStatusSchema,
  })
  .strict()
  .openapi('ConfiguredMCPServer');

export const CreateMcpServerRequestSchema = z
  .object({
    manifest: McpServerManifestSchema,
  })
  .strict()
  .openapi('CreateMCPServerRequest');

export const UpdateMcpServerRequestSchema = z
  .object({
    manifest: McpServerManifestSchema,
  })
  .strict()
  .openapi('UpdateMCPServerRequest');

export const GetMcpServerResponseSchema = z.object({ data: ConfiguredMcpServerSchema }).openapi('GetMCPServerResponse');
export const ListMcpServersResponseSchema = z
  .object({
    data: z.array(ConfiguredMcpServerSchema),
  })
  .openapi('ListMCPServersResponse');

/** Public auth mechanism for chat/composer (no secrets). */
export const McpServerAuthPublicSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('dcr') }).strict(),
    z.object({ type: z.literal('header') }).strict(),
  ])
  .describe('Auth mechanism when configured (no secrets). Omit when the server needs no credentials.')
  .openapi('MCPServerAuthPublic');

/** Chat/composer read view — public fields plus per-user auth_status. */
export const AvailableMcpServerSchema = z
  .object({
    name: NameSchema,
    url: z.url().describe('URL of the remote MCP server.'),
    auth: McpServerAuthPublicSchema.optional(),
    auth_status: McpAuthStatusSchema,
  })
  .strict()
  .openapi('AvailableMCPServer');

export const ListAvailableMcpServersResponseSchema = z
  .object({
    data: z.array(AvailableMcpServerSchema),
  })
  .openapi('ListAvailableMCPServersResponse');

export const GetAvailableMcpServerResponseSchema = z
  .object({ data: AvailableMcpServerSchema })
  .openapi('GetAvailableMCPServerResponse');

export type McpServerType = z.infer<typeof McpServerTypeSchema>;
export type McpServerManifestAuth = z.infer<typeof McpServerManifestAuthSchema>;
export type RemoteMcpServerManifest = z.infer<typeof RemoteMcpServerManifestSchema>;
export type TrueFoundryMcpServerManifest = z.infer<typeof TrueFoundryMcpServerManifestSchema>;
export type McpServerManifest = z.infer<typeof McpServerManifestSchema>;
export type McpAuthStatus = z.infer<typeof McpAuthStatusSchema>;
export type McpServerAuthPublic = z.infer<typeof McpServerAuthPublicSchema>;
export type ConfiguredMcpServer = z.infer<typeof ConfiguredMcpServerSchema>;
export type CreateMcpServerRequest = z.infer<typeof CreateMcpServerRequestSchema>;
export type UpdateMcpServerRequest = z.infer<typeof UpdateMcpServerRequestSchema>;
export type AvailableMcpServer = z.infer<typeof AvailableMcpServerSchema>;

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
  // TrueFoundry list responses treat this as authenticated until live per-item status is requested.
  if (manifest.type === 'truefoundry') {
    return { status: 'authenticated' };
  }
  if (manifest.auth?.type === 'dcr') {
    return token ? { status: 'authenticated' } : { status: 'auth_required' };
  }
  if (manifest.auth?.type === 'header') {
    return { status: 'authenticated' };
  }
  return { status: 'not_required' };
}
