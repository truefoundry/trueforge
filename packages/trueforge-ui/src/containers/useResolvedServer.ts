'use client';

import { useEffect, useState } from 'react';

import type { TrueForgeBuiltInServerConfig, TrueForgeServerConfig } from '../server/TrueForgeServerConfig.js';
import type {
  AgentBuilderCapabilitiesResponse,
  AgentUIServer,
  CatalogServer,
  PermissionsServer,
} from '../server/types.js';

export type ResolvedServerState =
  | { status: 'loading'; server: null; error: null }
  | { status: 'ready'; server: AgentUIServer; error: null }
  | { status: 'error'; server: null; error: unknown };

/** Fallback when an older runtime adapter omits `getCapabilities`. */
const DEFAULT_CAPABILITIES = {
  data: {
    sandbox: { enabled: true },
    skill: { enabled: true },
    settings: { enabled: true },
    webSearch: { enabled: false },
  },
} satisfies AgentBuilderCapabilitiesResponse;

function isBuiltInConfig(config: TrueForgeServerConfig): config is TrueForgeBuiltInServerConfig {
  return typeof config === 'object' && config !== null && 'type' in config && config.type === 'trueforge';
}

function hasGetCapabilities(
  server: object,
): server is { getCapabilities: () => Promise<AgentBuilderCapabilitiesResponse> } {
  return typeof Reflect.get(server, 'getCapabilities') === 'function';
}

/**
 * Attach optional host ports and ensure `getCapabilities` exists on the composed port.
 */
function toAgentUIServer(
  server: object,
  catalog: CatalogServer | undefined,
  permissions: PermissionsServer | undefined,
): AgentUIServer {
  const getCapabilities = hasGetCapabilities(server)
    ? () => server.getCapabilities()
    : async () => DEFAULT_CAPABILITIES;
  const withCapabilities = { ...server, getCapabilities };
  const withOptionalPorts = {
    ...withCapabilities,
    ...(catalog == null ? {} : { catalog }),
    ...(permissions == null ? {} : { permissions }),
  };
  if (!isAgentUIServer(withOptionalPorts)) {
    throw new Error('TrueForgeUI: runtime adapter returned an incomplete AgentUIServer');
  }
  return withOptionalPorts;
}

function isAgentUIServer(value: object): value is AgentUIServer {
  return (
    typeof Reflect.get(value, 'createSession') === 'function' &&
    typeof Reflect.get(value, 'listSessions') === 'function' &&
    typeof Reflect.get(value, 'getSession') === 'function' &&
    typeof Reflect.get(value, 'updateSession') === 'function' &&
    typeof Reflect.get(value, 'createTurn') === 'function' &&
    typeof Reflect.get(value, 'cancelSession') === 'function' &&
    typeof Reflect.get(value, 'listTurns') === 'function' &&
    typeof Reflect.get(value, 'getTurn') === 'function' &&
    typeof Reflect.get(value, 'listEvents') === 'function' &&
    typeof Reflect.get(value, 'getCapabilities') === 'function' &&
    typeof Reflect.get(value, 'getModels') === 'function' &&
    typeof Reflect.get(value, 'getSkills') === 'function' &&
    typeof Reflect.get(value, 'getMcp') === 'function' &&
    typeof Reflect.get(value, 'searchAgents') === 'function' &&
    typeof Reflect.get(value, 'saveAgent') === 'function'
  );
}

/**
 * Resolves a {@link TrueForgeServerConfig} to an {@link AgentUIServer}.
 * - `AgentUIServer` — sync passthrough
 * - `trueforge` — via dynamic import of the Harness plugin adapter
 */
export function useResolvedServer(
  config: TrueForgeServerConfig,
  onError?: (error: unknown) => void,
): ResolvedServerState {
  const builtIn = isBuiltInConfig(config) ? config : null;
  const directServer: AgentUIServer | null = isBuiltInConfig(config) ? null : config;
  const trueforgeBaseUrl = builtIn?.baseUrl ?? '';
  const trueforgeToken = builtIn?.token ?? '';
  const trueforgeFetch = builtIn?.fetch;
  const catalog = builtIn?.catalog;
  const permissions = builtIn?.permissions;

  const [state, setState] = useState<ResolvedServerState>(() => {
    if (directServer) {
      return { status: 'ready', server: directServer, error: null };
    }
    return { status: 'loading', server: null, error: null };
  });

  useEffect(() => {
    if (directServer) {
      setState({ status: 'ready', server: directServer, error: null });
      return;
    }

    let cancelled = false;
    setState({ status: 'loading', server: null, error: null });

    const resolve = async (): Promise<AgentUIServer> => {
      const { createTrueForgeAgentUIServer } = await import('../plugins/trueforge-agent-server-adapter/index.js');
      return createTrueForgeAgentUIServer({
        ...(trueforgeBaseUrl ? { baseUrl: trueforgeBaseUrl } : {}),
        ...(trueforgeToken ? { token: trueforgeToken } : {}),
        ...(trueforgeFetch !== undefined ? { fetch: trueforgeFetch } : {}),
        ...(catalog != null ? { catalog } : {}),
        ...(permissions != null ? { permissions } : {}),
      });
    };

    void resolve()
      .then(server => {
        if (cancelled) return;
        try {
          setState({
            status: 'ready',
            server: toAgentUIServer(server, undefined, undefined),
            error: null,
          });
        } catch (error: unknown) {
          onError?.(error);
          setState({ status: 'error', server: null, error });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        onError?.(error);
        setState({ status: 'error', server: null, error });
      });

    return () => {
      cancelled = true;
    };
  }, [directServer, trueforgeBaseUrl, trueforgeToken, trueforgeFetch, catalog, permissions, onError]);

  return state;
}
