'use client';

import { createContext, useContext } from 'react';

/**
 * Session detail replay has no composer AskUserContainer. When true,
 * ToolCallContainer renders pending ask_user prompts as read-only Unanswered
 * cards instead of returning null (live chat keeps those in the composer).
 */
export const SessionReplayContext = createContext(false);

export function useSessionReplay(): boolean {
  return useContext(SessionReplayContext);
}
