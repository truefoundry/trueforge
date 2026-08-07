'use client';

import { useEffect, useState, type ReactNode } from 'react';

import { useAui } from '../assistant-ui.js';
import { NamedAgentHeaderLabel } from '../atoms/NamedAgentHeaderLabel.js';
import { SaveAgentButton } from '../atoms/SaveAgentButton.js';
import { SelectAgentEmptyState } from '../atoms/SelectAgentEmptyState.js';
import { ShellActions } from '../atoms/ShellActions.js';
import { auiButtonClass } from '../atoms/lib/buttonClasses.js';
import { cn } from '../atoms/lib/cn.js';
import TruefoundrySettingsBuilder from '../containers/SettingsBuilder/index.js';
import { Thread } from '../containers/Thread.js';
import { ThreadListContainer } from '../containers/ThreadListContainer.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { useSlot } from '../theme/SlotsProvider.js';

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
  const isIdle = shell?.mode.status === 'idle';
  const settingsOpen = shell?.settingsOpen === true;

  useEffect(() => {
    if (isIdle) return;
    void Promise.resolve(aui.threads().switchToNewThread()).catch(() => undefined);
  }, [aui, isIdle]);

  if (settingsOpen) {
    return (
      <div className={cn('flex h-full min-h-0 flex-col', className)}>
        <TruefoundrySettingsBuilder />
      </div>
    );
  }

  if (view === 'list') {
    return (
      <div className={cn('flex h-full min-h-0 flex-col', className)}>
        <ThreadListContainer onThreadOpen={() => setView('thread')} />
        <footer className="flex shrink-0 justify-end border-t border-border px-2 py-1.5">
          <ShellActions />
        </footer>
      </div>
    );
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <header className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        <button
          type="button"
          aria-label="Sessions"
          title="Sessions"
          className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
          onClick={() => setView('list')}
        >
          <Icon name="clock-rotate-left" />
        </button>
        <NamedAgentHeaderLabel />
        <span className="min-w-0 flex-1" />
        <ClearChatButton />
        <SaveAgentButton />
        <ShellActions />
        {threadHeaderEnd}
      </header>
      <div className="min-h-0 flex-1">{isIdle ? <SelectAgentEmptyState /> : <Thread />}</div>
    </div>
  );
}
