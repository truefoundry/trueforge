/**
 * Shipped mcp-catalog.yaml schemas (discovery presets). Separate from
 * configured MCP server manifests in mcpServer.ts.
 */
import { z } from '@hono/zod-openapi';
import { uniqueNames } from './common';
import { McpServerManifestObjectSchema, type McpServerManifest } from './mcpServer';

/** Catalog entry — same fields as the configured manifest. */
export const CatalogMcpServerSchema = McpServerManifestObjectSchema.openapi('CatalogMcpServer');

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
  .openapi('GetMcpServerCatalogResponse');

export type CatalogMcpServer = McpServerManifest;
export type McpCatalogFile = z.infer<typeof McpCatalogFileSchema>;
