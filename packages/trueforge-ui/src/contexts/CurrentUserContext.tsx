import { createContext, useContext, type ReactNode } from 'react';

export type CurrentUser = {
  displayName: string;
  /** Stable subject identifier used for owner-only UI actions when available. */
  subjectId?: string;
};

const CurrentUserContext = createContext<CurrentUser | undefined>(undefined);

export function CurrentUserProvider({
  currentUser,
  children,
}: {
  currentUser: CurrentUser | undefined;
  children: ReactNode;
}) {
  return <CurrentUserContext.Provider value={currentUser}>{children}</CurrentUserContext.Provider>;
}

export function useOptionalCurrentUser(): CurrentUser | undefined {
  return useContext(CurrentUserContext);
}
