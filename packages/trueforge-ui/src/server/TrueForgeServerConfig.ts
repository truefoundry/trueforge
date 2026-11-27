import type { AgentBuilderCapabilitiesResponse, AgentUIServer, CatalogServer, PermissionsServer } from './types.js';

/**
 * Built-in backends init inside `<TrueForgeUI />`.
 * Optional host ports are attached onto the resolved `AgentUIServer`.
 */
export type TrueForgeBuiltInServerConfig = {
  type: 'trueforge';
  /** Harness API root. Defaults to `'/'` (same-origin / proxied). */
  baseUrl?: string;
  /** Bearer token for `@truefoundry/trueforge-sdk` (`Authorization: Bearer …`). */
  token?: string;
  /** Custom fetch (cookie sessions, auth interceptors). */
  fetch?: typeof fetch;
  catalog?: CatalogServer;
  permissions?: PermissionsServer;
  /**
   * Capabilities the host already loaded (for example at boot). The shell uses this as the
   * capabilities query's initial data so it does not fetch the same flags again on mount.
   * Keep the reference stable; a new object re-resolves the built-in server.
   */
  capabilities?: AgentBuilderCapabilitiesResponse['data'];
};

/**
 * `server` prop for `<TrueForgeUI />`: a built-in config, or a ready
 * {@link AgentUIServer} passed directly (no `{ type: "custom" }` wrapper).
 */
export type TrueForgeServerConfig = TrueForgeBuiltInServerConfig | AgentUIServer;
