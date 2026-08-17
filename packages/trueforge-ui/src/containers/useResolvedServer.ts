'use client';

import { createTrueFoundryAgentUIServer } from '@truefoundry/assistant-ui-runtime/plugins/truefoundry-agent-server-adapter';
import { useEffect, useState } from 'react';

import type { TrueForgeBuiltInServerConfig, TrueForgeServerConfig } from '../server/TrueForgeServerConfig.js';
import type { AgentBuilderCapabilitiesResponse, AgentUIServer, CatalogServer } from '../server/types.js';

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
  },
} satisfies AgentBuilderCapabilitiesResponse;

function isBuiltInConfig(config: TrueForgeServerConfig): config is TrueForgeBuiltInServerConfig {
  return (
    typeof config === 'object' &&
    config !== null &&
    'type' in config &&
    (config.type === 'truefoundry' || config.type === 'trueforge')
  );
}

function hasGetCapabilities(
  server: object,
): server is { getCapabilities: () => Promise<AgentBuilderCapabilitiesResponse> } {
  return typeof Reflect.get(server, 'getCapabilities') === 'function';
}

/**
 * Attach optional catalog and ensure `getCapabilities` exists on the composed port.
 */
function toAgentUIServer(server: object, catalog: CatalogServer | undefined): AgentUIServer {
  const getCapabilities = hasGetCapabilities(server)
    ? () => server.getCapabilities()
    : async () => DEFAULT_CAPABILITIES;
  const withCapabilities = { ...server, getCapabilities };
  const withCatalog = catalog != null ? { ...withCapabilities, catalog } : withCapabilities;
  if (!isAgentUIServer(withCatalog)) {
    throw new Error('TrueForgeUI: runtime adapter returned an incomplete AgentUIServer');
  }
  return withCatalog;
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
 * - `truefoundry` — async via `createTrueFoundryAgentUIServer`
 * - `trueforge` — via dynamic import of the Harness plugin adapter
 */
export function useResolvedServer(
  config: TrueForgeServerConfig,
  onError?: (error: unknown) => void,
): ResolvedServerState {
  const builtIn = isBuiltInConfig(config) ? config : null;
  const directServer: AgentUIServer | null = isBuiltInConfig(config) ? null : config;
  const type = builtIn?.type;
  const apiKey = builtIn?.type === 'truefoundry' ? builtIn.apiKey : '';
  const controlPlaneURL = builtIn?.type === 'truefoundry' ? builtIn.controlPlaneURL : '';
  const gatewayPlaneURL = builtIn?.type === 'truefoundry' ? (builtIn.gatewayPlaneURL ?? '') : '';
  const trueforgeBaseUrl = builtIn?.type === 'trueforge' ? (builtIn.baseUrl ?? '') : '';
  const trueforgeToken = builtIn?.type === 'trueforge' ? (builtIn.token ?? '') : '';
  const trueforgeFetch = builtIn?.type === 'trueforge' ? builtIn.fetch : undefined;
  const catalog = builtIn?.catalog;

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
      if (type === 'trueforge') {
        const { createTrueForgeAgentUIServer } = await import('../plugins/trueforge-agent-server-adapter/index.js');
        return createTrueForgeAgentUIServer({
          ...(trueforgeBaseUrl ? { baseUrl: trueforgeBaseUrl } : {}),
          ...(trueforgeToken ? { token: trueforgeToken } : {}),
          ...(trueforgeFetch !== undefined ? { fetch: trueforgeFetch } : {}),
          ...(catalog != null ? { catalog } : {}),
        });
      }

      const runtimeServer = await createTrueFoundryAgentUIServer({
        apiKey,
        cpURL: controlPlaneURL,
        ...(gatewayPlaneURL ? { gatewayURL: gatewayPlaneURL } : {}),
      });
      // TrueFoundry adapter may omit catalog; attach host-supplied catalog here.
      return toAgentUIServer(runtimeServer, catalog);
    };

    void resolve()
      .then(server => {
        if (cancelled) return;
        try {
          // trueforge factory already includes catalog; still normalize capabilities.
          setState({
            status: 'ready',
            server: type === 'trueforge' ? toAgentUIServer(server, undefined) : server,
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
  }, [
    type,
    directServer,
    apiKey,
    controlPlaneURL,
    gatewayPlaneURL,
    trueforgeBaseUrl,
    trueforgeToken,
    trueforgeFetch,
    catalog,
    onError,
  ]);

  return state;
}
