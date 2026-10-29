'use client';

import { createContext, useContext, type ReactNode } from 'react';

import type { ObservabilityConfig } from './types.js';

const NO_OBSERVABILITY: ObservabilityConfig = {};

const ObservabilityContext = createContext<ObservabilityConfig>(NO_OBSERVABILITY);

export function ObservabilityProvider({
  observability,
  children,
}: {
  observability?: ObservabilityConfig | undefined;
  children: ReactNode;
}) {
  return (
    <ObservabilityContext.Provider value={observability ?? NO_OBSERVABILITY}>{children}</ObservabilityContext.Provider>
  );
}

/** Always-safe: an empty config (all no-ops) when the host passed none. */
export function useObservability(): ObservabilityConfig {
  return useContext(ObservabilityContext);
}
