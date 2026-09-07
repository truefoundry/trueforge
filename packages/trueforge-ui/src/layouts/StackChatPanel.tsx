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
import { useOptionalShellMode } from '../server/ShellModeContext.js';
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
  const SessionsPage = useSlot('SessionsPage');
  const SaveAgentButton = useSlot('SaveAgentButton');
  const SelectAgentEmptyState = useSlot('SelectAgentEmptyState');
  const isIdle = shell?.mode.status === 'idle';
  const settingsOpen = shell?.settingsOpen === true;
  const libraryOpen = shell?.libraryOpen === true;
  const sessionsOpen = shell?.sessionsOpen === true;
  const schedulesOpen = shell?.schedulesOpen === true;
  const showNewActions = shell?.isNewChatEnabled !== false;

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
                {threadHeaderEnd}
              </>
            }
          />
          <div className="min-h-0 flex-1">{isIdle ? <SelectAgentEmptyState /> : <Thread />}</div>
        </>
      )}
      {/* Stable mount: only ShellActions needs to survive Settings / list / thread; host end chrome stays in the thread header. */}
      <footer className="flex shrink-0 items-center justify-between border-t border-border px-2 py-1.5">
        {libraryOpen || schedulesOpen ? (
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
        ) : (
          <span />
        )}
        <ShellActions key="shell-actions" />
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
