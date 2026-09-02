'use client';

import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';

import { useAui } from '../assistant-ui.js';
import { NamedAgentHeaderLabel } from '../atoms/NamedAgentHeaderLabel.js';
import { ShellActions } from '../atoms/ShellActions.js';
import { cn } from '../atoms/lib/cn.js';
import { Button } from '../atoms/primitives/Button.js';
import { Spinner } from '../atoms/primitives/Spinner.js';
import { Thread } from '../containers/Thread.js';
import { ThreadListContainer } from '../containers/ThreadListContainer.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { useSlot } from '../theme/SlotsProvider.js';

const TruefoundrySettingsBuilder = lazy(() => import('../containers/SettingsBuilder/index.js'));

export type StackChatPanelProps = {
  className?: string;
  /** Extra actions in the thread header (e.g. close for widget). */
  threadHeaderEnd?: ReactNode;
};

/**
 * List XOR thread stack used by `dock` and `widget` layouts.
 * Starts on a new chat; history icon opens the session list; New / select opens the thread.
 */
export function StackChatPanel({ className, threadHeaderEnd }: StackChatPanelProps) {
  const [view, setView] = useState<'list' | 'thread'>('thread');
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

  useEffect(() => {
    if (isIdle) return;
    void Promise.resolve(aui.threads().switchToNewThread()).catch(() => undefined);
  }, [aui, isIdle]);

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
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
          <AgentsLibrary onSelectAgent={() => setView('thread')} />
        </div>
      ) : view === 'list' ? (
        <ThreadListContainer onThreadOpen={() => setView('thread')} />
      ) : (
        <>
          <header className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
            <Button.Ghost
              type="button"
              aria-label="Sessions"
              title="Sessions"
              size="small"
              className="aspect-square px-0"
              onClick={() => setView('list')}
            >
              <Icon name="clock-rotate-left" />
            </Button.Ghost>
            <NamedAgentHeaderLabel />
            <span className="min-w-0 flex-1" />
            <ClearChatButton />
            <SaveAgentButton />
            {threadHeaderEnd}
          </header>
          <div className="min-h-0 flex-1">{isIdle ? <SelectAgentEmptyState /> : <Thread />}</div>
        </>
      )}
      {/* Stable mount: only ShellActions needs to survive Settings / list / thread; host end chrome stays in the thread header. */}
      <footer className="flex shrink-0 justify-end border-t border-border px-2 py-1.5">
        <ShellActions key="shell-actions" />
      </footer>
    </div>
  );
}
