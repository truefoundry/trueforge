import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useToasterOptional } from '../containers/ToasterContainer.js';
import { useCatalogServer } from '../server/ServerContext.js';

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

export const useMCPAuth = ({ callbackPath }: UseMCPAuthOptions = {}) => {
  const { connectorCatalog } = useCatalogServer();
  const toaster = useToasterOptional();
  const [isOAuthLoading, setIsOAuthLoading] = useState(false);
  const popupUid = useMemo(() => generatePopupUid(), []);
  const listenerCleanupRef = useRef<(() => void) | null>(null);

  const clearPopupListener = useCallback(() => {
    listenerCleanupRef.current?.();
    listenerCleanupRef.current = null;
  }, []);

  useEffect(() => clearPopupListener, [clearPopupListener]);

  const openAuthPopup = useCallback(
    (authorizationEndpoint: string, callback: McpAuthCallback) => {
      clearPopupListener();

      const channel = new BroadcastChannel(MCP_AUTH_POPUP_CHANNEL);
      let popup: Window | null = null;
      const cleanup = () => {
        channel.close();
        popup?.close();
      };

      channel.onmessage = (event: MessageEvent<unknown>) => {
        if (!isPopupMessage(event.data) || event.data.popupUid !== popupUid) return;
        try {
          callback(event.data.isSuccess);
        } finally {
          clearPopupListener();
        }
      };
      listenerCleanupRef.current = cleanup;

      popup = window.open(authorizationEndpoint, '_blank', 'popup=true');
      if (!popup) {
        clearPopupListener();
        throw new Error('Popup blocked. Please allow pop-ups to authorize the MCP server.');
      }

      popup.focus();
    },
    [clearPopupListener, popupUid],
  );

  const handleAuthorize = useCallback(
    async (integrationId: string, callback: McpAuthCallback) => {
      if (!integrationId) return;

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

        if (
          ('status' in result && result.status?.toUpperCase() === 'AUTHENTICATED') ||
          ('authenticated' in result && result.authenticated)
        ) {
          callback(true);
          return;
        }

        const authorizationEndpoint = 'authorization_endpoint' in result ? result.authorization_endpoint : undefined;
        if (!authorizationEndpoint) {
          throw new Error('The MCP server did not return an authorization URL.');
        }

        openAuthPopup(authorizationEndpoint, callback);
      } catch (error: unknown) {
        toaster?.showError(error);
        callback(false);
      } finally {
        setIsOAuthLoading(false);
      }
    },
    [callbackPath, connectorCatalog, openAuthPopup, popupUid, toaster],
  );

  return {
    handleAuthorize,
    isOAuthLoading,
  };
};
