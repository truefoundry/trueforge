'use client';

import { useThreadIsRunning } from '@assistant-ui/core/react';
import { useTrueFoundryMcpAuth } from '@truefoundry/assistant-ui-runtime';

import { useDraftCatalog } from '@/atoms/draft/DraftCatalogProvider.js';
import { useMCPAuth } from '@/hooks/useMcpAuth.js';
import { useOptionalCatalogServer } from '@/server/ServerContext.js';
import { useSlot } from '../theme/SlotsProvider.js';

type McpAuthPromptProps = {
  servers: NonNullable<ReturnType<typeof useTrueFoundryMcpAuth>['pending']>['mcpServers'];
  onContinue: () => void;
  readOnly: boolean;
};

function CatalogMcpAuthPrompt({ servers, onContinue, readOnly }: McpAuthPromptProps) {
  const McpAuthPrompt = useSlot('McpAuthPrompt');
  const { handleAuthorize } = useMCPAuth();
  const { refreshConnectors } = useDraftCatalog();

  const handleConnect = (serverId: string) => {
    void handleAuthorize(serverId, isSuccess => {
      if (isSuccess) {
        void refreshConnectors();
      }
    });
  };

  return <McpAuthPrompt servers={servers} onConnect={handleConnect} onContinue={onContinue} readOnly={readOnly} />;
}

export function McpAuthContainer() {
  const McpAuthPrompt = useSlot('McpAuthPrompt');
  const { pending, resume } = useTrueFoundryMcpAuth();
  const isRunning = useThreadIsRunning();
  const catalog = useOptionalCatalogServer();

  if (!pending) return null;

  if (catalog) {
    return <CatalogMcpAuthPrompt servers={pending.mcpServers} onContinue={() => void resume()} readOnly={isRunning} />;
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
      onContinue={() => void resume()}
      readOnly={isRunning}
    />
  );
}
