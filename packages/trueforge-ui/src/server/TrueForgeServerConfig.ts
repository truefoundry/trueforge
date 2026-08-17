import type { AgentUIServer, CatalogServer } from './types.js';

/**
 * Built-in backends init inside `<TrueForgeUI />`.
 * Optional `catalog` is attached onto the resolved `AgentUIServer`.
 */
export type TrueForgeBuiltInServerConfig =
  | {
      type: 'truefoundry';
      apiKey: string;
      controlPlaneURL: string;
      gatewayPlaneURL?: string;
      catalog?: CatalogServer;
    }
  | {
      type: 'trueforge';
      /** Harness API root. Defaults to `'/'` (same-origin / proxied). */
      baseUrl?: string;
      /** Bearer token for `@truefoundry/trueforge-sdk` (`Authorization: Bearer …`). */
      token?: string;
      /** Custom fetch (cookie sessions, auth interceptors). */
      fetch?: typeof fetch;
      catalog?: CatalogServer;
    };

/**
 * `server` prop for `<TrueForgeUI />`: a built-in config, or a ready
 * {@link AgentUIServer} passed directly (no `{ type: "custom" }` wrapper).
 */
export type TrueForgeServerConfig = TrueForgeBuiltInServerConfig | AgentUIServer;
