/**
 * Redirect URI allowlist matching — parity with servicefoundry `redirectUriMatches` /
 * `validateRedirectUris` (inbound MCP OAuth), adapted for harness FE post-OAuth `redirect_url`.
 */
import { McpConnectionError } from '../../errors';

/** RFC 8252 §7.3 loopback hosts — port/path/query are ignored when both sides are loopback. */
export const MCP_LOOPBACK_REDIRECT_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

/**
 * Matches a candidate redirect URL against a registered allowlist entry.
 * Exact string match always wins; for loopback hosts (RFC 8252 §7.3) any candidate is accepted
 * when both hosts are loopback — port, path, and query are ignored. Non-loopback hosts also
 * accept same-origin (path/query may differ) so FE landing pages under `PUBLIC_BASE_URL` work.
 */
export function redirectUriMatches(candidate: string, registered: string): boolean {
  if (candidate === registered) {
    return true;
  }
  let candidateUrl: URL;
  let registeredUrl: URL;
  try {
    candidateUrl = new URL(candidate);
    registeredUrl = new URL(registered);
  } catch {
    return false;
  }
  if (candidateUrl.protocol !== 'http:' && candidateUrl.protocol !== 'https:') {
    return false;
  }
  const bothLoopback =
    MCP_LOOPBACK_REDIRECT_HOSTS.has(candidateUrl.hostname) && MCP_LOOPBACK_REDIRECT_HOSTS.has(registeredUrl.hostname);
  if (bothLoopback) {
    return true;
  }
  // Same origin as an allowlisted base (FE paths under PUBLIC_BASE_URL).
  return candidateUrl.origin === registeredUrl.origin;
}

/**
 * Validates redirect URLs (must parse as http(s) URLs). When `allowList` is set, each URI must
 * match at least one registered entry via `redirectUriMatches`.
 *
 * TODO(mcp-oauth): callers should pass `allowList` once a configured FE redirect allowlist exists
 * (open-redirect guard). Today only shape/scheme are checked.
 */
export function validateRedirectUris({
  redirectUris,
  allowList,
}: {
  redirectUris: string[];
  allowList?: string[];
}): void {
  for (const redirectUri of redirectUris) {
    let parsed: URL;
    try {
      parsed = new URL(redirectUri);
    } catch {
      throw new McpConnectionError(`Invalid redirect URI: ${redirectUri}. Must be a valid URL.`, 400);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new McpConnectionError(`Invalid redirect URI: ${redirectUri}. Must be a valid URL.`, 400);
    }
    if (allowList && !allowList.some(registered => redirectUriMatches(redirectUri, registered))) {
      throw new McpConnectionError(`redirect_uri '${redirectUri}' is not registered for this client`, 400);
    }
  }
}
