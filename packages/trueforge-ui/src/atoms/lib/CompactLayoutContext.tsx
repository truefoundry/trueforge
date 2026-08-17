'use client';

import { createContext, useContext, type ReactNode } from 'react';

const CompactLayoutContext = createContext(false);

export function CompactLayoutProvider({ children }: { children: ReactNode }) {
  return <CompactLayoutContext.Provider value>{children}</CompactLayoutContext.Provider>;
}

export function useCompactLayout() {
  return useContext(CompactLayoutContext);
}
