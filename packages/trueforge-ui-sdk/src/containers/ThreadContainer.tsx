'use client';

import { ThreadPrimitive, useAuiState, type AssistantState } from '@assistant-ui/react';
import { useEffect, type ReactNode } from 'react';
import { preloadMarkdownOpenUI } from '../atoms/Markdown.js';
import { ComposerBusyProvider } from '../hooks/useComposerBusyState.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { AssistantMessageContainer } from './AssistantMessageContainer.js';
import { HistoryLoaderContainer } from './HistoryLoaderContainer.js';
import { UserEditComposerContainer } from './UserEditComposerContainer.js';
import { UserMessageContainer } from './UserMessageContainer.js';

// Startup exposes a loading placeholder thread; treat it as a new chat so the
// composer mounts centered. Loads after startup keep the docked layout.
//
// `remoteId == null` keeps welcome off during first-turn edit/retry: the
// runtime briefly rewinds to an empty snapshot before applying pendingUser,
// and messages.length===0 alone would flash the welcome screen.
export const isNewChatView = (s: AssistantState) =>
  s.thread.messages.length === 0 && (!s.thread.isLoading || s.threads.isLoading) && s.threadListItem.remoteId == null;

/** Mount-only lift. Keyed by message.id via ThreadPrimitive.Messages — not content (streaming). */
function AnimatedMessageShell({ children }: { children: ReactNode }) {
  return <div className="animate-in fade-in slide-in-from-bottom-1 fill-mode-both duration-200">{children}</div>;
}

function ThreadMessage({ isEditing }: { isEditing: boolean }) {
  const role = useAuiState(s => s.message.role);
  if (role === 'user') {
    if (isEditing) {
      return <UserEditComposerContainer />;
    }
    return <UserMessageContainer />;
  }
  return <AssistantMessageContainer />;
}

export type ThreadContainerProps = {
  /** Composer for the empty-welcome and docked bottom areas. `<Thread />` passes `<ComposerContainer />`. */
  composer?: ReactNode;
};

export function ThreadContainer({ composer }: ThreadContainerProps) {
  useEffect(() => {
    void preloadMarkdownOpenUI();
  }, []);

  const shell = useOptionalShellMode();
  const WelcomeScreen = useSlot('WelcomeScreen');
  const MessageListSkeleton = useSlot('MessageListSkeleton');
  const ScrollToBottomButton = useSlot('ScrollToBottomButton');
  const MessageGroup = useSlot('MessageGroup');
  const ThreadComposerAreaShell = useSlot('ThreadComposerAreaShell');
  const ThreadRootShell = useSlot('ThreadRootShell');
  const ThreadViewportShell = useSlot('ThreadViewportShell');

  const isEmpty = useAuiState(isNewChatView);
  const isLoading = useAuiState(s => s.thread.isLoading);
  const welcomeHeading = shell?.mode.status === 'active' ? shell.mode.agentName : undefined;

  return (
    <ComposerBusyProvider>
      <ThreadPrimitive.Root asChild>
        <ThreadRootShell>
          <ThreadPrimitive.Viewport asChild autoScroll>
            <ThreadViewportShell isEmpty={isEmpty}>
              {isEmpty && <WelcomeScreen heading={welcomeHeading} />}
              {isEmpty && !isLoading && composer}
              {isLoading ? (
                <MessageListSkeleton />
              ) : (
                !isEmpty && (
                  <>
                    <HistoryLoaderContainer />
                    <MessageGroup>
                      <ThreadPrimitive.Messages>
                        {({ message }) => (
                          <AnimatedMessageShell>
                            <ThreadMessage isEditing={message.role === 'user' && message.composer.isEditing} />
                          </AnimatedMessageShell>
                        )}
                      </ThreadPrimitive.Messages>
                    </MessageGroup>
                  </>
                )
              )}
            </ThreadViewportShell>
          </ThreadPrimitive.Viewport>

          {!isLoading && !isEmpty && (
            <ThreadComposerAreaShell isEmpty={isEmpty}>
              <ThreadPrimitive.ScrollToBottom asChild>
                <ScrollToBottomButton />
              </ThreadPrimitive.ScrollToBottom>
              {composer}
            </ThreadComposerAreaShell>
          )}
        </ThreadRootShell>
      </ThreadPrimitive.Root>
    </ComposerBusyProvider>
  );
}
