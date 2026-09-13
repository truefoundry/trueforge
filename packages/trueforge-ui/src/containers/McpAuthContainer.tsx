'use client';

import { useThreadIsRunning } from '@assistant-ui/core/react';
import { useTrueFoundryMcpAuth } from '@truefoundry/assistant-ui-runtime';
import { useRef, useState } from 'react';

import { useDraftCatalog } from '@/atoms/draft/DraftCatalogProvider.js';
import { useMCPAuth } from '@/hooks/useMcpAuth.js';
import { useOptionalCatalogServer } from '@/server/ServerContext.js';
import { useSlot } from '../theme/SlotsProvider.js';

type McpAuthPromptProps = {
  servers: NonNullable<ReturnType<typeof useTrueFoundryMcpAuth>['pending']>['mcpServers'];
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
  const resumedRef = useRef(false);

  const startResume = () => {
    if (readOnly || resumedRef.current) return;
    resumedRef.current = true;
    setIsResuming(true);
    void onContinue().catch(() => {
      resumedRef.current = false;
      setIsResuming(false);
    });
  };

  const handleConnect = (serverId: string) => {
    void handleAuthorize(serverId, isSuccess => {
      if (isSuccess) {
        const nextConnectedServerIds = new Set([...connectedServerIdsRef.current, serverId]);
        connectedServerIdsRef.current = nextConnectedServerIds;
        setConnectedServerIds(nextConnectedServerIds);
        void refreshConnectors();
        if (servers.every(server => nextConnectedServerIds.has(server.id))) startResume();
      }
    });
  };

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

export function McpAuthContainer({ disabled = false }: { disabled?: boolean }) {
  const McpAuthPrompt = useSlot('McpAuthPrompt');
  const { pending, resume } = useTrueFoundryMcpAuth();
  const isRunning = useThreadIsRunning();
  const catalog = useOptionalCatalogServer();

  if (!pending) return null;

  if (catalog) {
    const pendingServerKey = JSON.stringify(pending.mcpServers.map(server => server.id));
    return (
      <CatalogMcpAuthPrompt
        key={pendingServerKey}
        servers={pending.mcpServers}
        onContinue={resume}
        readOnly={isRunning || disabled}
      />
    );
  }

  const handleConnect = (serverId: string) => {
    const server = pending.mcpServers.find(s => s.id === serverId);
    if (server?.authUrl) {
      window.open(server.authUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <McpAuthPrompt
      servers={pending.mcpServers}
      onConnect={handleConnect}
      onContinue={() => {
        if (!disabled) void resume();
      }}
      readOnly={isRunning || disabled}
    />
  );
}
