'use client';

import { lazy, Suspense, useEffect, useRef, useState } from 'react';

import { useAui } from '../assistant-ui.js';
import { NamedAgentHeaderLabel } from '../atoms/NamedAgentHeaderLabel.js';
import { ShellActions } from '../atoms/ShellActions.js';
import { auiButtonClass } from '../atoms/lib/buttonClasses.js';
import { cn } from '../atoms/lib/cn.js';
import { Spinner } from '../atoms/primitives/Spinner.js';
import { Thread } from '../containers/Thread.js';
import { ThreadListContainer } from '../containers/ThreadListContainer.js';
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
  const [threadsOpen, setThreadsOpen] = useState(false);
  const threadsBtnRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const isIdle = shell?.mode.status === 'idle';
  const settingsOpen = shell?.settingsOpen === true;
  const libraryOpen = shell?.libraryOpen === true;
  const sessionsOpen = shell?.sessionsOpen === true;
  const schedulesOpen = shell?.schedulesOpen === true;
  const overlayOpen = settingsOpen || libraryOpen || sessionsOpen || schedulesOpen;

  useEffect(() => {
    if (libraryOpen || sessionsOpen || schedulesOpen) setThreadsOpen(false);
  }, [libraryOpen, sessionsOpen, schedulesOpen]);

  useEffect(() => {
    if (!threadsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setThreadsOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [threadsOpen]);

  useEffect(() => {
    const main = mainRef.current;
    if (threadsOpen) {
      wasOpen.current = true;
      if (main) main.inert = true;
      dialogRef.current?.focus();
      return;
    }
    if (wasOpen.current) {
      if (main) main.inert = false;
      threadsBtnRef.current?.focus();
      wasOpen.current = false;
    }
  }, [threadsOpen]);

  const handleNewChat = () => {
    shell?.setLibraryOpen(false);
    shell?.setSessionsOpen(false);
    if (shell?.isComposerEnabled) {
      shell.openDraft();
    } else {
      shell?.setSettingsOpen(false);
      shell?.setSchedulesOpen(false);
      aui.threads().switchToNewThread();
    }
    setThreadsOpen(false);
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
            <SaveAgentButton />
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
            {shell?.isNewChatEnabled !== false ? (
              <button
                type="button"
                aria-label="New chat"
                title="New chat"
                className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
                onClick={handleNewChat}
              >
                <Icon name="plus" />
              </button>
            ) : null}
            <button
              ref={threadsBtnRef}
              type="button"
              aria-label="Sessions"
              aria-expanded={threadsOpen}
              className="text-text-secondary hover:text-text-primary inline-flex size-8 cursor-pointer items-center justify-center rounded-md"
              onClick={() => setThreadsOpen(v => !v)}
            >
              <Icon name="clock-rotate-left" />
            </button>
          </>
        ) : null}
      </header>
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
          <AgentsLibrary onSelectAgent={() => setThreadsOpen(false)} />
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
      {threadsOpen ? (
        <>
          <button
            type="button"
            aria-label="Close sessions"
            className="absolute inset-0 z-[9] cursor-pointer bg-[var(--overlay)]"
            onClick={() => setThreadsOpen(false)}
          />
          <div
            ref={dialogRef}
            className="absolute inset-y-0 right-0 z-10 flex w-full max-w-80 flex-col border-l border-border bg-sidebar-bg shadow-lg outline-none"
            role="dialog"
            aria-label="Sessions"
            tabIndex={-1}
          >
            <ThreadListContainer onThreadOpen={() => setThreadsOpen(false)} />
          </div>
        </>
      ) : null}
    </div>
  );
}
