'use client';

import { createTrueFoundryAgentUIServer } from '@truefoundry/assistant-ui-runtime/plugins/truefoundry-agent-server-adapter';
import { useEffect, useState } from 'react';

import type { TrueforgeBuiltInServerConfig, TrueforgeServerConfig } from '../server/TrueforgeServerConfig.js';
import type { AgentUIServer } from '../server/types.js';

export type ResolvedServerState =
  | { status: 'loading'; server: null; error: null }
  | { status: 'ready'; server: AgentUIServer; error: null }
  | { status: 'error'; server: null; error: unknown };

function isBuiltInConfig(config: TrueforgeServerConfig): config is TrueforgeBuiltInServerConfig {
  return (
    typeof config === 'object' &&
    config !== null &&
    'type' in config &&
    (config.type === 'truefoundry' || config.type === 'trueforge')
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
      .then(server => {
        if (cancelled) return;
        const resolved = server as unknown as AgentUIServer;
        setState({
          status: 'ready',
          server: catalog != null ? ({ ...resolved, catalog } as AgentUIServer) : resolved,
          error: null,
        });
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
