'use client';

import { useTrueForgeMcpAuth } from '@truefoundry/trueforge-assistant-ui-runtime';
import { useEffect, useRef, useState } from 'react';

import { useDraftCatalog } from '@/atoms/draft/DraftCatalogProvider.js';
import { useMCPAuth } from '@/hooks/useMcpAuth.js';
import { useOptionalCatalogServer } from '@/server/ServerContext.js';
import { useSlot } from '../theme/SlotsProvider.js';

type McpAuthPromptProps = {
  servers: NonNullable<ReturnType<typeof useTrueForgeMcpAuth>['pending']>['mcpServers'];
  onContinue: () => Promise<void>;
  readOnly: boolean;
};

function CatalogMcpAuthPrompt({ servers, onContinue, readOnly }: McpAuthPromptProps) {
  const McpAuthPrompt = useSlot('McpAuthPrompt');
  const { handleAuthorize } = useMCPAuth();
  const { refreshConnectors } = useDraftCatalog();
  const [connectedServerIds, setConnectedServerIds] = useState<ReadonlySet<string>>(() => new Set());
  const connectedServerIdsRef = useRef(connectedServerIds);
  const [isResuming, setIsResuming] = useState(false);
  const [continueAccepted, setContinueAccepted] = useState(false);
  const resumedRef = useRef(false);
  const promptGenerationRef = useRef(0);

  useEffect(
    () => () => {
      promptGenerationRef.current += 1;
    },
    [],
  );

  const startResume = () => {
    if (readOnly || resumedRef.current || continueAccepted) return;
    resumedRef.current = true;
    setIsResuming(true);
    // On success, hide as soon as loading ends so Continue cannot be clicked
    // again while the turn catches up. Failures keep the prompt for retry;
    // runtime/stream can also bring Connect back if auth is still required.
    void onContinue()
      .then(() => {
        setContinueAccepted(true);
      })
      .catch(() => undefined)
      .finally(() => {
        resumedRef.current = false;
        setIsResuming(false);
      });
  };

  const handleConnect = (serverId: string) => {
    const generation = promptGenerationRef.current;
    void handleAuthorize(serverId, isSuccess => {
      if (generation !== promptGenerationRef.current || !isSuccess) return;
      const nextConnectedServerIds = new Set([...connectedServerIdsRef.current, serverId]);
      connectedServerIdsRef.current = nextConnectedServerIds;
      setConnectedServerIds(nextConnectedServerIds);
      void refreshConnectors();
      if (servers.every(server => nextConnectedServerIds.has(server.id))) startResume();
    });
  };

  if (continueAccepted) return null;

  return (
    <McpAuthPrompt
      servers={servers}
      connectedServerIds={connectedServerIds}
      continueLoading={isResuming}
      onConnect={handleConnect}
      onContinue={startResume}
      readOnly={readOnly}
    />
  );
}

function StandaloneMcpAuthPrompt({ servers, onContinue, readOnly }: McpAuthPromptProps) {
  const McpAuthPrompt = useSlot('McpAuthPrompt');
  const [isResuming, setIsResuming] = useState(false);
  const [continueAccepted, setContinueAccepted] = useState(false);
  const resumedRef = useRef(false);

  const startResume = () => {
    if (readOnly || resumedRef.current || continueAccepted) return;
    resumedRef.current = true;
    setIsResuming(true);
    void onContinue()
      .then(() => {
        setContinueAccepted(true);
      })
      .catch(() => undefined)
      .finally(() => {
        resumedRef.current = false;
        setIsResuming(false);
      });
  };

  if (continueAccepted) return null;

  const handleConnect = (serverId: string) => {
    const server = servers.find(s => s.id === serverId);
    if (server?.authUrl) {
      window.open(server.authUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <McpAuthPrompt
      servers={servers}
      continueLoading={isResuming}
      onConnect={handleConnect}
      onContinue={startResume}
      readOnly={readOnly}
    />
  );
}

export function McpAuthContainer({ disabled = false }: { disabled?: boolean }) {
  const { pending, continue: continueMcpAuth } = useTrueForgeMcpAuth();
  const catalog = useOptionalCatalogServer();

  if (!pending) return null;

  // Do not gate on thread isRunning: a sibling sub-agent can keep the turn
  // running while this prompt is still the path to finish MCP auth.
  const readOnly = disabled;
  const pendingServerKey = JSON.stringify(pending.mcpServers.map(server => server.id));

  if (catalog) {
    return (
      <CatalogMcpAuthPrompt
        key={pendingServerKey}
        servers={pending.mcpServers}
        onContinue={continueMcpAuth}
        readOnly={readOnly}
      />
    );
  }

  return (
    <StandaloneMcpAuthPrompt
      key={pendingServerKey}
      servers={pending.mcpServers}
      onContinue={continueMcpAuth}
      readOnly={readOnly}
    />
  );
}
