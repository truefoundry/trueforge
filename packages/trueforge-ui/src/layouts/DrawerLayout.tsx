'use client';

import { lazy, Suspense, useEffect, useRef, useState } from 'react';

import { useAui } from '../assistant-ui.js';
import { NamedAgentHeaderLabel } from '../atoms/NamedAgentHeaderLabel.js';
import { PageHeader } from '../atoms/PageHeader.js';
import { ShellActions } from '../atoms/ShellActions.js';
import { auiButtonClass } from '../atoms/lib/buttonClasses.js';
import { cn } from '../atoms/lib/cn.js';
import { useIsMobile } from '../atoms/lib/useIsMobile.js';
import { Spinner } from '../atoms/primitives/Spinner.js';
import { AgentConfigDrawerContainer } from '../containers/AgentConfigDrawerContainer.js';
import { Thread } from '../containers/Thread.js';
import { ThreadListContainer } from '../containers/ThreadListContainer.js';
import { Icon } from '../icons/Icon.js';
import { shellIsCreateAgent, useOptionalShellMode, type ShellMode } from '../server/ShellModeContext.js';
import { useSlot } from '../theme/SlotsProvider.js';

const TruefoundrySettingsBuilder = lazy(() => import('../containers/SettingsBuilder/index.js'));
const SchedulesPage = lazy(() =>
  import('../atoms/schedules/SchedulesPage.js').then(m => ({ default: m.SchedulesPage })),
);

function isRecentHistoryAllowed({ overlayOpen, mode }: { overlayOpen: boolean; mode?: ShellMode }): boolean {
  return !overlayOpen && mode?.status === 'active' && !mode.isCreateAgent;
}

export function DrawerLayout({ className }: { className?: string }) {
  const aui = useAui();
  const shell = useOptionalShellMode();
  const isMobile = useIsMobile();
  const ClearChatButton = useSlot('ClearChatButton');
  const AgentDetailsPage = useSlot('AgentDetailsPage');
  const AgentsLibrary = useSlot('AgentsLibrary');
  const AgentsLibraryButton = useSlot('AgentsLibraryButton');
  const SessionsBrowserButton = useSlot('SessionsBrowserButton');
  const SchedulesButton = useSlot('SchedulesButton');
  const SessionsPage = useSlot('SessionsPage');
  const SaveAgentButton = useSlot('SaveAgentButton');
  const SelectAgentEmptyState = useSlot('SelectAgentEmptyState');
  const DraftAgentConfigTrigger = useSlot('DraftAgentConfigTrigger');
  const UserAvatar = useSlot('UserAvatar');
  const mainRef = useRef<HTMLDivElement>(null);
  const isIdle = shell?.mode.status === 'idle';
  const settingsOpen = shell?.settingsOpen === true;
  const libraryOpen = shell?.libraryOpen === true;
  const sessionsOpen = shell?.sessionsOpen === true;
  const schedulesOpen = shell?.schedulesOpen === true;
  const overlayOpen = settingsOpen || libraryOpen || sessionsOpen || schedulesOpen;
  const showAgentConfig =
    shell != null && shellIsCreateAgent(shell.mode) && !overlayOpen && (!isMobile || shell.agentConfigOpen);
  const showConfigReopen =
    shell != null && shellIsCreateAgent(shell.mode) && !overlayOpen && isMobile && !shell.agentConfigOpen;
  const recentsAllowed = isRecentHistoryAllowed({ overlayOpen, mode: shell?.mode });
  const showNewActions = shell?.isNewChatEnabled !== false;
  // Recents starts open in New Chat; users can collapse it from the top tab.
  const [recentsOpen, setRecentsOpen] = useState(true);

  useEffect(() => {
    if (!recentsAllowed) setRecentsOpen(false);
  }, [recentsAllowed]);

  const handleNewChat = () => {
    shell?.setLibraryOpen(false);
    shell?.setSessionsOpen(false);
    if (shell?.isComposerEnabled) {
      shell.openDraft();
      setRecentsOpen(true);
      return;
    }
    shell?.setSettingsOpen(false);
    shell?.setSchedulesOpen(false);
    void Promise.resolve(aui.threads().switchToNewThread()).catch(() => undefined);
    setRecentsOpen(true);
  };

  const handleNewAgent = () => {
    shell?.setLibraryOpen(false);
    shell?.setSessionsOpen(false);
    setRecentsOpen(false);
    if (shell?.isComposerEnabled) {
      shell.openAgentBuilder();
    }
  };

  const handleBackToChat = () => {
    shell?.setLibraryOpen(false);
    shell?.setSessionsOpen(false);
    shell?.setSchedulesOpen(false);
  };

  const showRecentsPane = recentsAllowed && recentsOpen;

  return (
    <div className={cn('relative flex h-full min-h-0 w-full bg-primary-bg', className)}>
      {showAgentConfig ? (
        <aside
          role="dialog"
          aria-label="Agent Config"
          className="absolute inset-y-0 left-0 z-20 w-full max-w-sm border-r border-border shadow-xl md:static md:z-auto md:w-88 md:max-w-none md:shrink-0 md:shadow-none"
        >
          <AgentConfigDrawerContainer showClose={isMobile} />
        </aside>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Keep ShellActions mounted across Settings open/close so host action-slot state persists. */}
        <PageHeader
          className="bg-topbar-bg"
          title={
            !overlayOpen ? (
              <NamedAgentHeaderLabel />
            ) : libraryOpen || sessionsOpen || schedulesOpen ? (
              <button
                type="button"
                className={auiButtonClass({ variant: 'ghost', size: 'small' })}
                onClick={handleBackToChat}
              >
                <Icon name="arrow-left" />
                Back to chat
              </button>
            ) : null
          }
          end={
            <>
              {!overlayOpen ? (
                <>
                  <ClearChatButton />
                  <SaveAgentButton />
                  {showConfigReopen ? <DraftAgentConfigTrigger /> : null}
                  <AgentsLibraryButton toolbar />
                  <SessionsBrowserButton toolbar />
                  <SchedulesButton toolbar />
                </>
              ) : null}
              <ShellActions key="shell-actions" />
              <UserAvatar />
              {!overlayOpen ? (
                <>
                  {showNewActions ? (
                    <button
                      type="button"
                      aria-label="New Chat"
                      title="New Chat"
                      className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
                      onClick={handleNewChat}
                    >
                      <Icon name="square-pen" />
                    </button>
                  ) : null}
                  {recentsAllowed ? (
                    <button
                      type="button"
                      aria-label="Recents"
                      title="Recents"
                      aria-pressed={recentsOpen}
                      className={auiButtonClass({
                        variant: 'ghost',
                        size: 'icon',
                        className: cn(
                          recentsOpen &&
                            'bg-primary-button-bg font-medium text-primary-button-text hover:bg-primary-button-hover hover:text-primary-button-text',
                        ),
                      })}
                      onClick={() => setRecentsOpen(open => !open)}
                    >
                      <Icon name="clock-rotate-left" />
                    </button>
                  ) : null}
                  {showNewActions && shell?.isComposerEnabled ? (
                    <button
                      type="button"
                      aria-label="New Agent"
                      title="New Agent"
                      className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
                      onClick={handleNewAgent}
                    >
                      <Icon name="agent-2" />
                    </button>
                  ) : null}
                </>
              ) : null}
            </>
          }
        />
        <div className="flex min-h-0 min-w-0 flex-1">
          <div ref={mainRef} className="min-h-0 min-w-0 flex-1">
            {settingsOpen ? (
              <Suspense
                fallback={
                  <div
                    className="flex h-full items-center justify-center"
                    role="status"
                    aria-live="polite"
                    aria-busy="true"
                  >
                    <Spinner size={28} className="text-text-primary" />
                    <span className="sr-only">Loading</span>
                  </div>
                }
              >
                <TruefoundrySettingsBuilder />
              </Suspense>
            ) : sessionsOpen ? (
              <SessionsPage />
            ) : libraryOpen && shell?.libraryAgentId != null ? (
              <AgentDetailsPage key={shell.libraryAgentId} agentId={shell.libraryAgentId} />
            ) : libraryOpen ? (
              <AgentsLibrary />
            ) : schedulesOpen ? (
              <Suspense
                fallback={
                  <div
                    className="flex h-full items-center justify-center"
                    role="status"
                    aria-live="polite"
                    aria-busy="true"
                  >
                    <Spinner size={28} className="text-text-primary" />
                    <span className="sr-only">Loading</span>
                  </div>
                }
              >
                <SchedulesPage />
              </Suspense>
            ) : isIdle ? (
              <SelectAgentEmptyState />
            ) : (
              <Thread />
            )}
          </div>
          {showRecentsPane ? (
            <aside
              aria-label="Recent chats"
              className="flex min-h-0 w-64 shrink-0 border-l border-border bg-sidebar-bg"
            >
              <ThreadListContainer
                variant="recent-history"
                onThreadOpen={() => {
                  if (isMobile) setRecentsOpen(false);
                }}
              />
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}
