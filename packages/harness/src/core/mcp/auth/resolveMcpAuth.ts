/**
 * Resolve a stored MCP OAuth access token into request headers, or surface a
 * browser authorization URL. No refresh — missing/expired tokens re-auth.
 */
import { buildMcpAuthorizationUrl } from './buildMcpAuthorizationUrl';
import type { IMcpTokenStore } from './IMcpTokenStore';

export enum McpAuthStatus {
  Authenticated = 'authenticated',
  AuthRequired = 'auth_required',
}

export type ResolveMcpAuthResult =
  | { status: McpAuthStatus.Authenticated; headers: Record<string, string> }
  | { status: McpAuthStatus.AuthRequired; authUrl: URL };

function isMcpAccessTokenUsable(expiresAtIso: string, nowMs: number): boolean {
  const expiresAtMs = Date.parse(expiresAtIso);
  return !Number.isNaN(expiresAtMs) && expiresAtMs > nowMs;
}

/**
 * Return Bearer headers when the stored access token is still valid; otherwise
 * {@link buildMcpAuthorizationUrl}. Expired tokens are deleted so they are not reused.
 */
export async function resolveMcpAuth(params: {
  tokenStore: IMcpTokenStore;
  serverId: string;
  mcpServerUrl: string;
  mcpServerName: string;
  publicBaseUrl: string;
  clientName: string;
  /** FE post-OAuth landing URL (not the OAuth redirect_uri). */
  redirectUrl?: string;
  nowMs?: number;
}): Promise<ResolveMcpAuthResult> {
  const nowMs = params.nowMs ?? Date.now();
  const token = await params.tokenStore.getToken({ serverId: params.serverId });

  if (token !== undefined && isMcpAccessTokenUsable(token.expiresAt, nowMs)) {
    return {
      status: McpAuthStatus.Authenticated,
      headers: { Authorization: `Bearer ${token.accessToken}` },
    };
  }

  if (token !== undefined) {
    await params.tokenStore.deleteToken({ serverId: params.serverId });
  }

  const authUrl = await buildMcpAuthorizationUrl({
    tokenStore: params.tokenStore,
    serverId: params.serverId,
    mcpServerUrl: params.mcpServerUrl,
    mcpServerName: params.mcpServerName,
    publicBaseUrl: params.publicBaseUrl,
    clientName: params.clientName,
    ...(params.redirectUrl !== undefined ? { redirectUrl: params.redirectUrl } : {}),
  });
  return { status: McpAuthStatus.AuthRequired, authUrl };
}
