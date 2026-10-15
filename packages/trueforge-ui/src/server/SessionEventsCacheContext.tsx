'use client';

import type { SessionEventsCache } from '@truefoundry/trueforge-assistant-ui-runtime';
import { createContext, useContext, type ReactNode } from 'react';

const SessionEventsCacheContext = createContext<SessionEventsCache | null>(null);

export function SessionEventsCacheProvider({ cache, children }: { cache: SessionEventsCache; children: ReactNode }) {
  return <SessionEventsCacheContext.Provider value={cache}>{children}</SessionEventsCacheContext.Provider>;
}

/** Returns null when history mounts outside a shell that owns a timeline cache. */
export function useOptionalSessionEventsCache(): SessionEventsCache | null {
  return useContext(SessionEventsCacheContext);
}
