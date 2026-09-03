'use client';

import { lazy, Suspense, useRef } from 'react';

import { useAui } from '../assistant-ui.js';
import { NamedAgentHeaderLabel } from '../atoms/NamedAgentHeaderLabel.js';
import { ShellActions } from '../atoms/ShellActions.js';
import { auiButtonClass } from '../atoms/lib/buttonClasses.js';
import { cn } from '../atoms/lib/cn.js';
import { Spinner } from '../atoms/primitives/Spinner.js';
import { AgentConfigDrawerContainer } from '../containers/AgentConfigDrawerContainer.js';
import { Thread } from '../containers/Thread.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { useSlot } from '../theme/SlotsProvider.js';

const TruefoundrySettingsBuilder = lazy(() => import('../containers/SettingsBuilder/index.js'));
const SchedulesPage = lazy(() =>
  import('../atoms/schedules/SchedulesPage.js').then(m => ({ default: m.SchedulesPage })),
);

export function DrawerLayout({ className }: { className?: string }) {
  const aui = useAui();
  const shell = useOptionalShellMode();
  const ClearChatButton = useSlot('ClearChatButton');
  const AgentDetailsPage = useSlot('AgentDetailsPage');
  const AgentsLibrary = useSlot('AgentsLibrary');
  const SessionsPage = useSlot('SessionsPage');
  const SaveAgentButton = useSlot('SaveAgentButton');
  const SelectAgentEmptyState = useSlot('SelectAgentEmptyState');
  const mainRef = useRef<HTMLDivElement>(null);
  const isIdle = shell?.mode.status === 'idle';
  const settingsOpen = shell?.settingsOpen === true;
  const libraryOpen = shell?.libraryOpen === true;
  const sessionsOpen = shell?.sessionsOpen === true;
  const schedulesOpen = shell?.schedulesOpen === true;
  const overlayOpen = settingsOpen || libraryOpen || sessionsOpen || schedulesOpen;
  const showNewActions = shell?.isNewChatEnabled !== false;

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

  return (
    <div className={cn('relative flex h-full min-h-0 w-full flex-col bg-primary-bg', className)}>
      {/* Keep ShellActions mounted across Settings open/close so host action-slot state persists. */}
      <header className="flex shrink-0 items-center gap-1 border-b border-border bg-topbar-bg px-2 py-1.5">
        {!overlayOpen ? (
          <>
            <NamedAgentHeaderLabel />
            <span className="min-w-0 flex-1" />
            <ClearChatButton />
            {!shell?.agentConfigOpen ? <SaveAgentButton /> : null}
          </>
        ) : libraryOpen || schedulesOpen ? (
          <>
            <button
              type="button"
              className={auiButtonClass({ variant: 'ghost', size: 'sm' })}
              onClick={() => {
                shell?.setLibraryOpen(false);
                shell?.setSchedulesOpen(false);
              }}
            >
              <Icon name="arrow-left" />
              Back to chat
            </button>
            <span className="min-w-0 flex-1" />
          </>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        <ShellActions key="shell-actions" />
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
      </header>
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
        {shell?.agentConfigOpen ? (
          <aside
            role="dialog"
            aria-label="Agent Config"
            className="absolute inset-y-0 right-0 z-20 w-full max-w-sm border-l border-border shadow-xl md:static md:z-auto md:w-[22rem] md:max-w-none md:shrink-0 md:shadow-none"
          >
            <AgentConfigDrawerContainer />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
