import type { AgentUIServer, CatalogServer } from './types.js';

/**
 * Built-in backends init inside `<TrueforgeUI />`.
 * Optional `catalog` is attached onto the resolved `AgentUIServer`.
 */
export type TrueforgeBuiltInServerConfig =
  | {
      type: 'truefoundry';
      apiKey: string;
      controlPlaneURL: string;
      gatewayPlaneURL?: string;
      catalog?: CatalogServer;
    }
  | ({
      type: 'trueforge';
      apiKey: string;
      catalog?: CatalogServer;
    } & Record<string, unknown>);

/**
 * `server` prop for `<TrueforgeUI />`: a built-in config, or a ready
 * {@link AgentUIServer} passed directly (no `{ type: "custom" }` wrapper).
 */
export type TrueforgeServerConfig = TrueforgeBuiltInServerConfig | AgentUIServer;
