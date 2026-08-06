'use client';

import { useThreadIsRunning } from '@assistant-ui/core/react';
import { useTrueFoundryMcpAuth } from '@truefoundry/assistant-ui-runtime';

import { useSlot } from '../theme/SlotsProvider.js';

export function McpAuthContainer() {
  const McpAuthPrompt = useSlot('McpAuthPrompt');
  const { pending, resume } = useTrueFoundryMcpAuth();
  const isRunning = useThreadIsRunning();

  if (!pending) return null;

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
