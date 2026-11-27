'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

type SessionArtifactsPanelValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

const SessionArtifactsPanelContext = createContext<SessionArtifactsPanelValue | null>(null);

/** Shared by the header toggle and the thread so both agree on whether the artifacts card is shown. */
export function SessionArtifactsPanelProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const value = useMemo(() => ({ open, setOpen }), [open]);
  return <SessionArtifactsPanelContext.Provider value={value}>{children}</SessionArtifactsPanelContext.Provider>;
}

/** Null when the host mounts the thread without the shell; the card then stays always shown, with no toggle. */
export function useOptionalSessionArtifactsPanel(): SessionArtifactsPanelValue | null {
  return useContext(SessionArtifactsPanelContext);
}
