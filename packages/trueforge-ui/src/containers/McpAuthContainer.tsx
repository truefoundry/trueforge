'use client';

import { useThreadIsRunning } from '@assistant-ui/core/react';
import { useTrueFoundryMcpAuth } from '@truefoundry/assistant-ui-runtime';

import { useDraftCatalog } from '@/atoms/draft/DraftCatalogProvider.js';
import { useMCPAuth } from '@/hooks/useMcpAuth.js';
import { useSlot } from '../theme/SlotsProvider.js';

export function McpAuthContainer() {
  const McpAuthPrompt = useSlot('McpAuthPrompt');
  const { pending, resume } = useTrueFoundryMcpAuth();
  const isRunning = useThreadIsRunning();
  const { handleAuthorize } = useMCPAuth();
  const { refreshConnectors } = useDraftCatalog();

  if (!pending) return null;

  const handleConnect = (serverId: string) => {
    handleAuthorize(serverId, async isSuccess => {
      if (isSuccess) {
        refreshConnectors();
      }
    });
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
