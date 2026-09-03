/**
 * ServiceFoundry MCP list rows and auth responses → harness shapes (Zod, fail loudly).
 */
import { z } from 'zod';
import type { McpAuthStatus, McpServerManifest } from '../schemas/mcpServer';

/** Placeholder in SFY `proxyUrl` replaced with the tenant gateway base URL. */
export const MCP_PROXY_BASE_URL_TEMPLATE = '{{mcpProxyBaseURL}}';

/** SFY subject types for auth status / delete. */
export type SfyMcpAuthSubjectType = 'user' | 'virtualaccount';

/** SFY per-subject auth record kinds for DELETE /mcp/:id/auth. */
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
/** Status-only: needs auth, no consent URL (SFY `MCPServerAuthStatusAuthRequired`). */
const SfyMcpAuthStatusRequiredSchema = z.object({ status: z.literal('authentication_required') });
/** Authorize: same as status required + consent URL (SFY `MCPServerAuthorizeAuthRequired`). */
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
 * Gateway proxy as `url`. SFY `oauth2` → wire `dcr` (Connect UX + mid-turn auth gate in getMcpConnection).
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

/** Parse + map `GET v1/mcp/:id/auth/status`. */
export function parseSfyMcpAuthStatus(payload: unknown): McpAuthStatus {
  return toHarnessAuthStatus(SfyMcpAuthStatusSchema.parse(payload));
}

/** Parse + map `GET v1/mcp/:id/authorize` (requires consent URL when auth is required). */
export function parseSfyMcpAuthorizeResult(payload: unknown): McpAuthStatus {
  return toHarnessAuthStatus(SfyMcpAuthorizeResultSchema.parse(payload));
}
