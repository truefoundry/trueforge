/**
 * ServiceFoundry MCP list rows → lean summaries (Zod, fail loudly — same pattern as mapEnabledModels).
 */
import { z } from 'zod';
import type { McpServerManifest } from '../schemas/mcpServer';

/** Placeholder in SFY `proxyUrl` replaced with the tenant gateway base URL. */
export const MCP_PROXY_BASE_URL_TEMPLATE = '{{mcpProxyBaseURL}}';

const IsoInstantSchema = z.union([z.string().min(1), z.date()]).transform((value, ctx) => {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      ctx.addIssue({ code: 'custom', message: 'Invalid Date' });
      return z.NEVER;
    }
    return value.toISOString();
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    ctx.addIssue({ code: 'custom', message: 'Invalid ISO timestamp' });
    return z.NEVER;
  }
  return new Date(ms).toISOString();
});

const SfyMcpServerRowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  proxyUrl: z.string().min(1),
  createdAt: IsoInstantSchema,
  updatedAt: IsoInstantSchema,
  manifest: z
    .object({
      description: z.string().min(1).optional(),
      auth_data: z
        .object({
          type: z.string().min(1).optional(),
        })
        .optional(),
    })
    .optional(),
});

export interface SfyMcpServerSummary {
  id: string;
  name: string;
  /** May contain `{{mcpProxyBaseURL}}`; callers must run {@link resolveMcpProxyUrl}. */
  proxyUrl: string;
  description: string;
  authType: string | undefined;
  createdAt: string;
  updatedAt: string;
}

/** Parse one SFY MCP list row. Throws ZodError on contract drift. */
export function parseSfyMcpServerSummary(row: unknown): SfyMcpServerSummary {
  const parsed = SfyMcpServerRowSchema.parse(row);
  return {
    id: parsed.id,
    name: parsed.name,
    proxyUrl: parsed.proxyUrl,
    // SFY description is optional; TrueForge manifests require a non-empty string.
    description: parsed.manifest?.description ?? parsed.name,
    authType: parsed.manifest?.auth_data?.type,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
  };
}

/** Map SFY MCP list rows; each row must satisfy the schema. */
export function mapSfyMcpServers(input: { rows: readonly unknown[] }): SfyMcpServerSummary[] {
  return input.rows.map(parseSfyMcpServerSummary);
}

/** Substitute `{{mcpProxyBaseURL}}` in an SFY proxy URL template. */
export function resolveMcpProxyUrl(input: { proxyUrl: string; gatewayBaseURL: string }): string {
  const base = input.gatewayBaseURL.replace(/\/+$/, '');
  if (!input.proxyUrl.includes(MCP_PROXY_BASE_URL_TEMPLATE)) {
    return input.proxyUrl;
  }
  return input.proxyUrl.replaceAll(MCP_PROXY_BASE_URL_TEMPLATE, base);
}

/**
 * Gateway proxy as `url`. SFY `oauth2` → wire `dcr` for Connect UX only (UI keys off auth type).
 * Invoke Bearer comes from the MCP store's `resolveInvokeHeaders` — not wire `header` auth.
 */
export function toTrueFoundryMcpManifest(input: {
  server: SfyMcpServerSummary;
  gatewayUrl: string;
}): McpServerManifest {
  return {
    type: 'truefoundry',
    name: input.server.name,
    url: resolveMcpProxyUrl({ proxyUrl: input.server.proxyUrl, gatewayBaseURL: input.gatewayUrl }),
    description: input.server.description,
    ...(input.server.authType === 'oauth2' ? { auth: { type: 'dcr' as const } } : {}),
  };
}
