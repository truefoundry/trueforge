'use client';

import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessageLike } from '@assistant-ui/react';
import type { ReactNode } from 'react';

import { SlotsProvider, type SlotOverrides } from '../theme/SlotsProvider.js';
import { SessionReplayContext } from './sessionReplayContext.js';

/** Read-only assistant-ui runtime for one turn's projected messages. */
export function ReadOnlySessionTurnRuntime({
  messages,
  slotOverrides,
  children,
}: {
  messages: ThreadMessageLike[];
  slotOverrides?: SlotOverrides;
  children: ReactNode;
}) {
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages,
    isRunning: false,
    convertMessage: message => message,
    onNew: async () => {},
  });

  const tree = (
    <SessionReplayContext.Provider value={true}>
      <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
    </SessionReplayContext.Provider>
  );
  if (slotOverrides == null) {
    return tree;
  }
  return <SlotsProvider overrides={slotOverrides}>{tree}</SlotsProvider>;
}
