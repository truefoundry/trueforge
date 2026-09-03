/**
 * Shipped mcp-catalog.yaml schemas (discovery presets). Separate from
 * configured MCP server manifests in mcpServer.ts.
 */
import { z } from '@hono/zod-openapi';
import { NameSchema, uniqueNames } from './common';
import { McpServerDescriptionSchema, McpServerManifestAuthSchema, McpServerTypeSchema } from './mcpServer';

/**
 * Catalog presets are user-savable `remote` entries only.
 * `truefoundry` is TrueFoundry-managed.
 */
export const CatalogMcpServerTypeSchema = McpServerTypeSchema.exclude(['truefoundry']).openapi('CatalogMCPServerType');

/** Catalog entry — discovery preset the settings UI copies into a PUT body. */
export const CatalogMcpServerSchema = z
  .object({
    type: CatalogMcpServerTypeSchema,
    name: NameSchema,
    logo: z.url().optional().describe('URL of the MCP server logo asset.'),
    url: z.url().describe('URL of the remote MCP server.'),
    description: McpServerDescriptionSchema,
    auth: McpServerManifestAuthSchema.optional(),
  })
  .strict()
  .openapi('CatalogMCPServer');

export const McpCatalogFileSchema = z
  .object({
    mcp_servers: z.array(CatalogMcpServerSchema),
  })
  .strict()
  .superRefine((file, ctx) => {
    uniqueNames(file.mcp_servers, ctx);
  });

export const GetMcpServerCatalogResponseSchema = z
  .object({
    data: z.array(CatalogMcpServerSchema),
  })
  .openapi('GetMCPServerCatalogResponse');

export type CatalogMcpServer = z.infer<typeof CatalogMcpServerSchema>;
export type McpCatalogFile = z.infer<typeof McpCatalogFileSchema>;
