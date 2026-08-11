import type { AssistantState } from '@assistant-ui/react';

// Startup exposes a loading placeholder thread; treat it as a new chat so the
// composer mounts centered. Loads after startup keep the docked layout.
//
// `remoteId == null` keeps welcome off during first-turn edit/retry: the
// runtime briefly rewinds to an empty snapshot before applying pendingUser,
// and messages.length===0 alone would flash the welcome screen.
export type NewChatViewState = {
  thread: Pick<AssistantState['thread'], 'messages' | 'isLoading'>;
  threads: Pick<AssistantState['threads'], 'isLoading'>;
  threadListItem: Pick<AssistantState['threadListItem'], 'remoteId'>;
};

export const isNewChatView = (s: NewChatViewState) =>
  s.thread.messages.length === 0 && (!s.thread.isLoading || s.threads.isLoading) && s.threadListItem.remoteId == null;
