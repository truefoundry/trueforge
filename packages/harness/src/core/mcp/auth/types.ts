/**
 * MCP-specific auth status. Everything else in the old version of this file (client record,
 * token, pending authorization) was a renamed copy of the generic `core/auth` shapes with no
 * MCP-specific behavior — callers now use `OAuthClientRecord` / `OAuthToken` /
 * `OAuthPendingAuthorization` directly (see `core/auth/IOAuthClientStore.ts` /
 * `IOAuthTokenStore.ts`), keyed by the MCP server id instead of a made-up MCP field name.
 */
export enum McpAuthStatus {
  Authenticated = 'authenticated',
  AuthenticationRequired = 'authentication_required',
}
