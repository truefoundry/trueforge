'use client';

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';

type WidgetVisibilityContextValue = {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
};

const WidgetVisibilityContext = createContext<WidgetVisibilityContextValue | null>(null);

export function WidgetVisibilityProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ open, setOpen }), [open]);

  return <WidgetVisibilityContext.Provider value={value}>{children}</WidgetVisibilityContext.Provider>;
}

export function useWidgetVisibility(): WidgetVisibilityContextValue {
  const value = useContext(WidgetVisibilityContext);
  if (value === null) {
    throw new Error('useWidgetVisibility must be used within WidgetVisibilityProvider');
  }
  return value;
}
