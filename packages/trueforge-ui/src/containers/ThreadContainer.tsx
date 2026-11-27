'use client';

import { ThreadPrimitive, useAuiState } from '@assistant-ui/react';
import { useEffect, type ReactNode } from 'react';
import { cn } from '../atoms/lib/cn.js';
import { preloadMarkdownOpenUI } from '../atoms/Markdown.js';
import { FilePreviewBoundary } from '../filePreview/FilePreviewContext.js';
import { ComposerBusyProvider } from '../hooks/useComposerBusyState.js';
import { useSyncSessionTitle } from '../hooks/useSyncSessionTitle.js';
import { useSyncThreadListLastTurnStatus } from '../hooks/useSyncThreadListLastTurnStatus.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { isNewChatView } from '../utils/isNewChatView.js';
import { ApprovalFocusProvider } from './approvalFocus.js';
import { AssistantMessageContainer } from './AssistantMessageContainer.js';
import { FilePreviewHost } from './FilePreviewHost.js';
import { HistoryLoaderContainer } from './HistoryLoaderContainer.js';
import { ResumeUnavailableContainer } from './ResumeUnavailableContainer.js';
import {
  SESSION_ARTIFACTS_COLUMN_INSET_CLASS,
  SESSION_ARTIFACTS_TRANSITION_CLASS,
  SessionArtifactsContainer,
  useSessionArtifactsVisible,
} from './SessionArtifactsContainer.js';
import { UserEditComposerContainer } from './UserEditComposerContainer.js';
import { UserMessageContainer } from './UserMessageContainer.js';

export { isNewChatView } from '../utils/isNewChatView.js';

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
  useSyncSessionTitle();
  useSyncThreadListLastTurnStatus();

  const shell = useOptionalShellMode();
  const WelcomeScreen = useSlot('WelcomeScreen');
  const MessageListSkeleton = useSlot('MessageListSkeleton');
  const ScrollToBottomButton = useSlot('ScrollToBottomButton');
  const MessageGroup = useSlot('MessageGroup');
  const ThreadComposerAreaShell = useSlot('ThreadComposerAreaShell');
  const artifactsVisible = useSessionArtifactsVisible();
  const ThreadRootShell = useSlot('ThreadRootShell');
  const ThreadViewportShell = useSlot('ThreadViewportShell');

  const isEmpty = useAuiState(isNewChatView);
  const isLoading = useAuiState(s => s.thread.isLoading);
  const messageCount = useAuiState(s => s.thread.messages.length);
  // Skeleton only while a thread that has no messages yet is loading.
  const showMessageSkeleton = isLoading && messageCount === 0;
  const welcomeHeading =
    shell?.mode.status === 'active'
      ? shell.mode.agentName != null && shell.mode.agentName.length > 0
        ? shell.mode.agentName
        : shell.mode.isMutable && shell.mode.isCreateAgent
          ? 'Start building a new Agent'
          : undefined
      : undefined;

  return (
    <FilePreviewBoundary>
      <ComposerBusyProvider>
        <ApprovalFocusProvider>
          <ThreadPrimitive.Root asChild>
            <ThreadRootShell>
              <div data-slot="aui_file-preview-row" className="relative flex min-h-0 w-full min-w-0 flex-1">
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  <ThreadPrimitive.Viewport asChild autoScroll>
                    <ThreadViewportShell isEmpty={isEmpty} aside={<SessionArtifactsContainer />}>
                      {isEmpty && <WelcomeScreen heading={welcomeHeading} />}
                      {isEmpty && !showMessageSkeleton && composer}
                      {showMessageSkeleton ? (
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
                              <ResumeUnavailableContainer />
                            </MessageGroup>
                          </>
                        )
                      )}
                    </ThreadViewportShell>
                  </ThreadPrimitive.Viewport>

                  {!showMessageSkeleton && !isEmpty && (
                    <div
                      className={cn(
                        'flex shrink-0 flex-col transition-[padding]',
                        SESSION_ARTIFACTS_TRANSITION_CLASS,
                        artifactsVisible && SESSION_ARTIFACTS_COLUMN_INSET_CLASS,
                      )}
                    >
                      <ThreadComposerAreaShell isEmpty={isEmpty}>
                        <ThreadPrimitive.ScrollToBottom asChild>
                          <ScrollToBottomButton />
                        </ThreadPrimitive.ScrollToBottom>
                        {composer}
                      </ThreadComposerAreaShell>
                    </div>
                  )}
                </div>
                <FilePreviewHost />
              </div>
            </ThreadRootShell>
          </ThreadPrimitive.Root>
        </ApprovalFocusProvider>
      </ComposerBusyProvider>
    </FilePreviewBoundary>
  );
}
