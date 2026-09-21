import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useToasterOptional } from '../containers/ToasterContainer.js';
import { useCatalogServer, useOptionalServer } from '../server/ServerContext.js';

export const MCP_AUTH_POPUP_CHANNEL = 'truefoundry-mcp-auth-popup';

export type McpAuthPopupMessage = {
  popupUid: string;
  isSuccess: boolean;
};

export type McpAuthCallback = (isSuccess: boolean) => void;

export type UseMCPAuthOptions = {
  callbackPath?: string;
};

const generatePopupUid = () => `mcp-oauth-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const isPopupMessage = (value: unknown): value is McpAuthPopupMessage => {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<McpAuthPopupMessage>;
  return typeof message.popupUid === 'string' && typeof message.isSuccess === 'boolean';
};

/**
 * Browser side of the MCP OAuth handshake:
 * 1. `authenticateConnector` either reports the connector already authenticated or returns an authorization URL.
 * 2. That URL opens in a popup; the callback page broadcasts its result on `MCP_AUTH_POPUP_CHANNEL`, matched by `popupUid`.
 * 3. Success is re-read from the connector before `callback(true)` — the popup only proves the redirect ran, not that
 *    tokens were stored.
 *
 * Every callback is gated on an authorize generation, so a late popup result cannot report into an unmounted caller or
 * a newer authorize attempt.
 */
export const useMCPAuth = ({ callbackPath }: UseMCPAuthOptions = {}) => {
  const { connectorCatalog } = useCatalogServer();
  const server = useOptionalServer();
  const toaster = useToasterOptional();
  const [isOAuthLoading, setIsOAuthLoading] = useState(false);
  const popupUid = useMemo(() => generatePopupUid(), []);
  const listenerCleanupRef = useRef<(() => void) | null>(null);
  const authorizeGenerationRef = useRef(0);

  const clearPopupListener = useCallback(() => {
    listenerCleanupRef.current?.();
    listenerCleanupRef.current = null;
  }, []);

  useEffect(
    () => () => {
      authorizeGenerationRef.current += 1;
      clearPopupListener();
    },
    [clearPopupListener],
  );

  // Check the user's MCP authentication status with `getMcpConnector`; `getConnector` is only available to admins.
  const loadConnector = useCallback(
    async (integrationId: string) => {
      if (server?.getMcpConnector !== undefined) {
        return server.getMcpConnector({ connectorId: integrationId });
      }
      return connectorCatalog.getConnector({ id: integrationId });
    },
    [connectorCatalog, server],
  );

  const reportVerifiedSuccess = useCallback(
    async ({
      integrationId,
      callback,
      generation,
    }: {
      integrationId: string;
      callback: McpAuthCallback;
      generation: number;
    }) => {
      try {
        const connector = await loadConnector(integrationId);
        if (authorizeGenerationRef.current !== generation) return;
        if (!connector.authenticated) {
          throw new Error('The MCP server is not authenticated yet. Please try again.');
        }
        callback(true);
      } catch (error: unknown) {
        if (authorizeGenerationRef.current !== generation) return;
        toaster?.showError(error);
        callback(false);
      }
    },
    [loadConnector, toaster],
  );

  const openAuthPopup = useCallback(
    ({
      authorizationEndpoint,
      integrationId,
      callback,
      generation,
    }: {
      authorizationEndpoint: string;
      integrationId: string;
      callback: McpAuthCallback;
      generation: number;
    }) => {
      clearPopupListener();

      const channel = new BroadcastChannel(MCP_AUTH_POPUP_CHANNEL);
      let popup: Window | null = null;
      const cleanup = () => {
        channel.close();
        popup?.close();
      };

      channel.onmessage = (event: MessageEvent<unknown>) => {
        if (!isPopupMessage(event.data) || event.data.popupUid !== popupUid) return;
        const { isSuccess } = event.data;
        clearPopupListener();
        if (!isSuccess) {
          if (authorizeGenerationRef.current === generation) callback(false);
          return;
        }
        void reportVerifiedSuccess({ integrationId, callback, generation });
      };
      listenerCleanupRef.current = cleanup;

      popup = window.open(authorizationEndpoint, '_blank', 'popup=true');
      if (!popup) {
        clearPopupListener();
        throw new Error('Popup blocked. Please allow pop-ups to authorize the MCP server.');
      }

      popup.focus();
    },
    [clearPopupListener, popupUid, reportVerifiedSuccess],
  );

  const handleAuthorize = useCallback(
    async (integrationId: string, callback: McpAuthCallback) => {
      if (!integrationId) return;
      const generation = ++authorizeGenerationRef.current;

      try {
        setIsOAuthLoading(true);
        const callbackUrl = callbackPath
          ? new URL(callbackPath, window.location.origin)
          : new URL(window.location.href);
        callbackUrl.searchParams.set('screenType', 'mcp-auth');
        callbackUrl.searchParams.set('integrationId', integrationId);
        callbackUrl.searchParams.set('pUid', popupUid);

        const result = await connectorCatalog.authenticateConnector({
          id: integrationId,
          returnTo: `${callbackUrl.pathname}${callbackUrl.search}`,
        });
        if (authorizeGenerationRef.current !== generation) return;

        if (
          ('status' in result && result.status?.toUpperCase() === 'AUTHENTICATED') ||
          ('authenticated' in result && result.authenticated)
        ) {
          await reportVerifiedSuccess({ integrationId, callback, generation });
          return;
        }

        const authorizationEndpoint = 'authorization_endpoint' in result ? result.authorization_endpoint : undefined;
        if (!authorizationEndpoint) {
          throw new Error('The MCP server did not return an authorization URL.');
        }

        openAuthPopup({ authorizationEndpoint, integrationId, callback, generation });
      } catch (error: unknown) {
        if (authorizeGenerationRef.current !== generation) return;
        toaster?.showError(error);
        callback(false);
      } finally {
        if (authorizeGenerationRef.current === generation) setIsOAuthLoading(false);
      }
    },
    [callbackPath, connectorCatalog, openAuthPopup, popupUid, reportVerifiedSuccess, toaster],
  );

  return {
    handleAuthorize,
    isOAuthLoading,
  };
};
