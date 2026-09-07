'use client';

import { createContext, useContext, type ReactNode } from 'react';

import type { ResolvedRoutes } from './types.js';

const ResolvedRoutesContext = createContext<ResolvedRoutes | null>(null);

/** Present only when the shell is mounted under `withRouter`. */
export function ResolvedRoutesProvider({ routes, children }: { routes: ResolvedRoutes; children: ReactNode }) {
  return <ResolvedRoutesContext.Provider value={routes}>{children}</ResolvedRoutesContext.Provider>;
}

export function useOptionalResolvedRoutes(): ResolvedRoutes | null {
  return useContext(ResolvedRoutesContext);
}
