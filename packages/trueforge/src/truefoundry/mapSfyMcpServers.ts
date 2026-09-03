import { z } from 'zod';
import type { McpAuthStatus, McpServerManifest } from '../schemas/mcpServer';

/** Placeholder in upstream `proxyUrl` replaced with the tenant gateway base URL. */
export const MCP_PROXY_BASE_URL_TEMPLATE = '{{mcpProxyBaseURL}}';

/** Upstream per-subject auth record kinds for DELETE auth. */
export type SfyMcpAuthSource = 'oauth' | 'auth-override';

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

const SfyMcpAuthStatusAuthenticatedSchema = z.object({ status: z.literal('authenticated') });
const SfyMcpAuthStatusNotRequiredSchema = z.object({ status: z.literal('authentication_not_required') });
const SfyMcpAuthStatusRequiredSchema = z.object({ status: z.literal('authentication_required') });
const SfyMcpAuthorizeRequiredSchema = SfyMcpAuthStatusRequiredSchema.extend({
  authorization_endpoint: z.url(),
});

const SfyMcpAuthStatusSchema = z.discriminatedUnion('status', [
  SfyMcpAuthStatusAuthenticatedSchema,
  SfyMcpAuthStatusRequiredSchema,
  SfyMcpAuthStatusNotRequiredSchema,
]);

const SfyMcpAuthorizeResultSchema = z.discriminatedUnion('status', [
  SfyMcpAuthStatusAuthenticatedSchema,
  SfyMcpAuthorizeRequiredSchema,
  SfyMcpAuthStatusNotRequiredSchema,
]);

export interface SfyMcpServerSummary {
  id: string;
  name: string;
  /** May contain `{{mcpProxyBaseURL}}`; resolve with `resolveMcpProxyUrl`. */
  proxyUrl: string;
  description: string;
  authType: string | undefined;
  createdAt: string;
  updatedAt: string;
}

/** Parse one upstream MCP list row. Throws ZodError on contract drift. */
export function parseSfyMcpServerSummary(row: unknown): SfyMcpServerSummary {
  const parsed = SfyMcpServerRowSchema.parse(row);
  return {
    id: parsed.id,
    name: parsed.name,
    proxyUrl: parsed.proxyUrl,
    // Description is optional upstream; TrueForge manifests require a non-empty string.
    description: parsed.manifest?.description ?? parsed.name,
    authType: parsed.manifest?.auth_data?.type,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
  };
}

/** Map upstream MCP list rows; each row must satisfy the schema. */
export function mapSfyMcpServers(input: { rows: readonly unknown[] }): SfyMcpServerSummary[] {
  return input.rows.map(parseSfyMcpServerSummary);
}

/** Substitute `{{mcpProxyBaseURL}}` in an upstream proxy URL template. */
export function resolveMcpProxyUrl(input: { proxyUrl: string; gatewayBaseURL: string }): string {
  const base = input.gatewayBaseURL.replace(/\/+$/, '');
  if (!input.proxyUrl.includes(MCP_PROXY_BASE_URL_TEMPLATE)) {
    return input.proxyUrl;
  }
  return input.proxyUrl.replaceAll(MCP_PROXY_BASE_URL_TEMPLATE, base);
}

/** Map an upstream MCP row to a TrueFoundry wire manifest (`oauth2` → `dcr`). */
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

function toHarnessAuthStatus(
  payload: z.infer<typeof SfyMcpAuthStatusSchema> | z.infer<typeof SfyMcpAuthorizeResultSchema>,
): McpAuthStatus {
  switch (payload.status) {
    case 'authenticated':
      return { status: 'authenticated' };
    case 'authentication_not_required':
      return { status: 'not_required' };
    case 'authentication_required': {
      if ('authorization_endpoint' in payload) {
        return { status: 'auth_required', authorization_url: payload.authorization_endpoint };
      }
      return { status: 'auth_required' };
    }
  }
}

/** Parse an upstream MCP auth/status payload. */
export function parseSfyMcpAuthStatus(payload: unknown): McpAuthStatus {
  return toHarnessAuthStatus(SfyMcpAuthStatusSchema.parse(payload));
}

/** Parse an upstream MCP authorize payload (consent URL when auth is required). */
export function parseSfyMcpAuthorizeResult(payload: unknown): McpAuthStatus {
  return toHarnessAuthStatus(SfyMcpAuthorizeResultSchema.parse(payload));
}
