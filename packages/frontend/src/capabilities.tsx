import { createContext, use, type ReactNode } from 'react';
import type { ServerCapabilities } from './catalog';

const ServerCapabilitiesContext = createContext<ServerCapabilities | null>(null);

export function ServerCapabilitiesProvider({
  capabilities,
  children,
}: {
  capabilities: ServerCapabilities;
  children: ReactNode;
}) {
  return <ServerCapabilitiesContext value={capabilities}>{children}</ServerCapabilitiesContext>;
}

export function useServerCapabilities(): ServerCapabilities {
  const capabilities = use(ServerCapabilitiesContext);
  if (!capabilities) {
    throw new Error('useServerCapabilities must be used within ServerCapabilitiesProvider');
  }
  return capabilities;
}
