import type { AgentUIServer, ArtifactServer, CatalogServer, PermissionsServer } from './types.js';

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
  /** Custom artifacts port. When set, it replaces the built-in list client. */
  artifacts?: ArtifactServer;
  /** Attach the built-in list client. Ignored when `artifacts` is set. */
  artifactsEnabled?: boolean;
};

/**
 * `server` prop for `<TrueForgeUI />`: a built-in config, or a ready
 * {@link AgentUIServer} passed directly (no `{ type: "custom" }` wrapper).
 */
export type TrueForgeServerConfig = TrueForgeBuiltInServerConfig | AgentUIServer;
