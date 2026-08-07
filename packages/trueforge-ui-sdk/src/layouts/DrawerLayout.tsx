'use client';

import { useEffect, useRef, useState } from 'react';

import { useAui } from '../assistant-ui.js';
import { NamedAgentHeaderLabel } from '../atoms/NamedAgentHeaderLabel.js';
import { ShellActions } from '../atoms/ShellActions.js';
import { auiButtonClass } from '../atoms/lib/buttonClasses.js';
import { cn } from '../atoms/lib/cn.js';
import TruefoundrySettingsBuilder from '../containers/SettingsBuilder/index.js';
import { Thread } from '../containers/Thread.js';
import { ThreadListContainer } from '../containers/ThreadListContainer.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { useSlot } from '../theme/SlotsProvider.js';

export function DrawerLayout({ className }: { className?: string }) {
  const aui = useAui();
  const shell = useOptionalShellMode();
  const ClearChatButton = useSlot('ClearChatButton');
  const SaveAgentButton = useSlot('SaveAgentButton');
  const SelectAgentEmptyState = useSlot('SelectAgentEmptyState');
  const [threadsOpen, setThreadsOpen] = useState(false);
  const threadsBtnRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const isIdle = shell?.mode.status === 'idle';
  const settingsOpen = shell?.settingsOpen === true;

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
    if (shell?.isComposerEnabled) {
      shell.openDraft();
    } else {
      shell?.setSettingsOpen(false);
      aui.threads().switchToNewThread();
    }
    setThreadsOpen(false);
  };

  return (
    <div className={cn('relative flex h-full min-h-0 w-full flex-col', className)}>
      {!settingsOpen ? (
        <header className="flex shrink-0 items-center gap-1 border-b border-border bg-background px-2 py-1.5">
          <NamedAgentHeaderLabel />
          <span className="min-w-0 flex-1" />
          <ClearChatButton />
          <SaveAgentButton />
          <ShellActions />
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
            className="text-muted-foreground hover:text-foreground inline-flex size-8 cursor-pointer items-center justify-center rounded-md"
            onClick={() => setThreadsOpen(v => !v)}
          >
            <Icon name="clock-rotate-left" />
          </button>
        </header>
      ) : null}
      <div ref={mainRef} className="min-h-0 min-w-0 flex-1">
        {settingsOpen ? <TruefoundrySettingsBuilder /> : isIdle ? <SelectAgentEmptyState /> : <Thread />}
      </div>
      {threadsOpen ? (
        <>
          <button
            type="button"
            aria-label="Close sessions"
            className="absolute inset-0 z-[9] cursor-pointer bg-black/20"
            onClick={() => setThreadsOpen(false)}
          />
          <div
            ref={dialogRef}
            className="absolute inset-y-0 right-0 z-10 flex w-full max-w-80 flex-col border-l border-border bg-background shadow-lg outline-none"
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
