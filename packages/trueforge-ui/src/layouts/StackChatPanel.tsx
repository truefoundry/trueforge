'use client';

import { lazy, Suspense, useEffect, type ReactNode } from 'react';

import { useAui } from '../assistant-ui.js';
import { NamedAgentHeaderLabel } from '../atoms/NamedAgentHeaderLabel.js';
import { PageHeader } from '../atoms/PageHeader.js';
import { ShellActions } from '../atoms/ShellActions.js';
import { auiButtonClass } from '../atoms/lib/buttonClasses.js';
import { cn } from '../atoms/lib/cn.js';
import { Spinner } from '../atoms/primitives/Spinner.js';
import { AgentConfigDrawerContainer } from '../containers/AgentConfigDrawerContainer.js';
import { Thread } from '../containers/Thread.js';
import { Icon } from '../icons/Icon.js';
import { shellIsCreateAgent, useOptionalShellMode } from '../server/ShellModeContext.js';
import { useSlot } from '../theme/SlotsProvider.js';

const TruefoundrySettingsBuilder = lazy(() => import('../containers/SettingsBuilder/index.js'));
const SchedulesPage = lazy(() =>
  import('../atoms/schedules/SchedulesPage.js').then(m => ({ default: m.SchedulesPage })),
);

export type StackChatPanelProps = {
  className?: string;
  /** Extra actions in the thread header (e.g. close for widget). */
  threadHeaderEnd?: ReactNode;
};

/**
 * Thread stack used by `dock` and `widget` layouts.
 * New Chat / New Agent replace the former in-panel recent-session list.
 */
export function StackChatPanel({ className, threadHeaderEnd }: StackChatPanelProps) {
  const aui = useAui();
  const shell = useOptionalShellMode();
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
  const isIdle = shell?.mode.status === 'idle';
  const settingsOpen = shell?.settingsOpen === true;
  const libraryOpen = shell?.libraryOpen === true;
  const sessionsOpen = shell?.sessionsOpen === true;
  const schedulesOpen = shell?.schedulesOpen === true;
  const overlayOpen = settingsOpen || libraryOpen || sessionsOpen || schedulesOpen;
  const showNewActions = shell?.isNewChatEnabled !== false;
  const isCreateAgent = shell != null && shellIsCreateAgent(shell.mode);
  const showConfigReopen = isCreateAgent && !overlayOpen && shell?.agentConfigOpen !== true;

  useEffect(() => {
    if (isIdle) return;
    void Promise.resolve(aui.threads().switchToNewThread()).catch(() => undefined);
  }, [aui, isIdle]);

  const handleNewChat = () => {
    shell?.setLibraryOpen(false);
    shell?.setSessionsOpen(false);
    if (shell?.isComposerEnabled) {
      shell.openDraft();
      return;
    }
    shell?.setSettingsOpen(false);
    shell?.setSchedulesOpen(false);
    void Promise.resolve(aui.threads().switchToNewThread()).catch(() => undefined);
  };

  const handleNewAgent = () => {
    shell?.setLibraryOpen(false);
    shell?.setSessionsOpen(false);
    if (shell?.isComposerEnabled) {
      shell.openAgentBuilder();
    }
  };

  const handleBackToChat = () => {
    shell?.setLibraryOpen(false);
    shell?.setSessionsOpen(false);
    shell?.setSchedulesOpen(false);
    shell?.setSettingsOpen(false);
  };

  return (
    <div className={cn('relative flex h-full min-h-0 flex-col', className)}>
      {settingsOpen ? (
        <div className="min-h-0 flex-1">
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
        </div>
      ) : sessionsOpen ? (
        <div className="min-h-0 flex-1">
          <SessionsPage />
        </div>
      ) : libraryOpen && shell?.libraryAgentId != null ? (
        <div className="min-h-0 flex-1">
          <AgentDetailsPage key={shell.libraryAgentId} agentId={shell.libraryAgentId} />
        </div>
      ) : libraryOpen ? (
        <div className="min-h-0 flex-1">
          <AgentsLibrary />
        </div>
      ) : schedulesOpen ? (
        <div className="min-h-0 flex-1">
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
        </div>
      ) : (
        <>
          <PageHeader
            start={
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
            }
            title={<NamedAgentHeaderLabel />}
            end={
              <>
                <ClearChatButton />
                <SaveAgentButton />
                {showConfigReopen ? <DraftAgentConfigTrigger /> : null}
                {threadHeaderEnd}
              </>
            }
          />
          <div className="min-h-0 flex-1">{isIdle ? <SelectAgentEmptyState /> : <Thread />}</div>
        </>
      )}
      {/* Stable mount: ShellActions + nav survive Settings / list / thread; widget close stays visible on overlays. */}
      <footer className="flex shrink-0 items-center justify-between border-t border-border px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1">
          {overlayOpen ? (
            <button
              type="button"
              className={auiButtonClass({ variant: 'ghost', size: 'small' })}
              onClick={handleBackToChat}
            >
              <Icon name="arrow-left" />
              Back to chat
            </button>
          ) : null}
          {!overlayOpen ? (
            <>
              <AgentsLibraryButton toolbar />
              <SessionsBrowserButton toolbar />
              <SchedulesButton toolbar />
            </>
          ) : null}
          <UserAvatar />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ShellActions key="shell-actions" />
          {overlayOpen ? threadHeaderEnd : null}
        </div>
      </footer>
      {shell?.agentConfigOpen ? (
        <aside
          role="dialog"
          aria-label="Agent Config"
          className="absolute inset-0 z-20 border-l border-border shadow-xl"
        >
          <AgentConfigDrawerContainer showClose />
        </aside>
      ) : null}
    </div>
  );
}
