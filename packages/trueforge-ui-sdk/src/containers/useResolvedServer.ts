'use client';

import { createTrueFoundryAgentUIServer } from '@truefoundry/assistant-ui-runtime/plugins/truefoundry-agent-server-adapter';
import { useEffect, useState } from 'react';

import type { TrueforgeBuiltInServerConfig, TrueforgeServerConfig } from '../server/TrueforgeServerConfig.js';
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

function isBuiltInConfig(config: TrueforgeServerConfig): config is TrueforgeBuiltInServerConfig {
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
    throw new Error('TrueforgeUI: runtime adapter returned an incomplete AgentUIServer');
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
 * Resolves a {@link TrueforgeServerConfig} to an {@link AgentUIServer}.
 * - `AgentUIServer` — sync passthrough
 * - `truefoundry` — async via `createTrueFoundryAgentUIServer`
 * - `trueforge` — not implemented yet (error state)
 */
export function useResolvedServer(
  config: TrueforgeServerConfig,
  onError?: (error: unknown) => void,
): ResolvedServerState {
  const builtIn = isBuiltInConfig(config) ? config : null;
  const directServer: AgentUIServer | null = isBuiltInConfig(config) ? null : config;
  const type = builtIn?.type;
  const apiKey = builtIn?.apiKey ?? '';
  const controlPlaneURL = builtIn?.type === 'truefoundry' ? builtIn.controlPlaneURL : '';
  const gatewayPlaneURL = builtIn?.type === 'truefoundry' ? (builtIn.gatewayPlaneURL ?? '') : '';
  const catalog = builtIn?.catalog;

  const [state, setState] = useState<ResolvedServerState>(() => {
    if (directServer) {
      return { status: 'ready', server: directServer, error: null };
    }
    if (type === 'trueforge') {
      return {
        status: 'error',
        server: null,
        error: new Error('TrueforgeUI: type "trueforge" is not implemented yet'),
      };
    }
    return { status: 'loading', server: null, error: null };
  });

  useEffect(() => {
    if (directServer) {
      setState({ status: 'ready', server: directServer, error: null });
      return;
    }

    if (type === 'trueforge') {
      const error = new Error('TrueforgeUI: type "trueforge" is not implemented yet');
      onError?.(error);
      setState({ status: 'error', server: null, error });
      return;
    }

    let cancelled = false;
    setState({ status: 'loading', server: null, error: null });

    void createTrueFoundryAgentUIServer({
      apiKey,
      cpURL: controlPlaneURL,
      ...(gatewayPlaneURL ? { gatewayURL: gatewayPlaneURL } : {}),
    })
      .then(runtimeServer => {
        if (cancelled) return;
        try {
          setState({
            status: 'ready',
            server: toAgentUIServer(runtimeServer, catalog),
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
  }, [type, directServer, apiKey, controlPlaneURL, gatewayPlaneURL, catalog, onError]);

  return state;
}
