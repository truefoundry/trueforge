'use client';

import { useEffect, useRef, useState } from 'react';

import { useAui } from '../assistant-ui.js';
import { auiButtonClass } from '../atoms/lib/buttonClasses.js';
import { cn } from '../atoms/lib/cn.js';
import { NamedAgentHeaderLabel } from '../atoms/NamedAgentHeaderLabel.js';
import { ShellActions } from '../atoms/ShellActions.js';
import TruefoundrySettingsBuilder from '../containers/SettingsBuilder/index.js';
import { Thread } from '../containers/Thread.js';
import { ThreadListContainer } from '../containers/ThreadListContainer.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { BrandIcon } from '../theme/brand.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { useBrand } from '../theme/ThemeProvider.js';

// Survives ChatProvider remounts when openDraft / selectAgent bumps runtimeKey.
let desktopCollapsed = false;

export function SidebarLayout({ className }: { className?: string }) {
  const aui = useAui();
  const shell = useOptionalShellMode();
  const brand = useBrand();
  const AgentsLibraryButton = useSlot('AgentsLibraryButton');
  const ClearChatButton = useSlot('ClearChatButton');
  const SaveAgentButton = useSlot('SaveAgentButton');
  const SelectAgentEmptyState = useSlot('SelectAgentEmptyState');
  const [collapsed, setCollapsed] = useState(desktopCollapsed);
  const setDesktopCollapsed = (value: boolean | ((prev: boolean) => boolean)) => {
    setCollapsed(prev => {
      const next = typeof value === 'function' ? value(prev) : value;
      desktopCollapsed = next;
      return next;
    });
  };
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const isIdle = shell?.mode.status === 'idle';
  const settingsOpen = shell?.settingsOpen === true;

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileNavOpen]);

  useEffect(() => {
    const main = mainRef.current;
    if (mobileNavOpen) {
      wasOpen.current = true;
      if (main) main.inert = true;
      dialogRef.current?.focus();
      return;
    }
    if (wasOpen.current) {
      if (main) main.inert = false;
      menuBtnRef.current?.focus();
      wasOpen.current = false;
    }
  }, [mobileNavOpen]);

  const handleNewChat = () => {
    if (shell?.isComposerEnabled) {
      shell.openDraft();
      return;
    }
    shell?.setSettingsOpen(false);
    void Promise.resolve(aui.threads().switchToNewThread()).catch(() => undefined);
  };

  return (
    <div className={cn('relative flex h-full min-h-0 w-full min-w-0', className)}>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden min-h-0 shrink-0 flex-col border-r border-border bg-background transition-[width] duration-300 ease-in-out md:flex',
          collapsed ? 'w-16' : 'w-64',
        )}
      >
        <div
          className={cn('flex shrink-0 items-center px-3 py-3', collapsed ? 'flex-col gap-3' : 'justify-between gap-2')}
        >
          <div className={cn('flex min-w-0 items-center text-foreground', collapsed ? 'justify-center' : 'gap-2')}>
            <BrandIcon className="size-6 shrink-0 object-contain" />
            {!collapsed ? (
              <span className="truncate text-lg font-semibold tracking-tight">{brand.name ?? 'TrueFoundry'}</span>
            ) : null}
          </div>
          <button
            type="button"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
            onClick={() => setDesktopCollapsed(value => !value)}
          >
            <Icon name={collapsed ? 'panel-left-open' : 'panel-left-close'} />
          </button>
        </div>

        {collapsed ? (
          <nav className="flex min-h-0 flex-1 flex-col items-center gap-2 px-3" aria-label="Sidebar">
            {shell?.isNewChatEnabled !== false ? (
              <button
                type="button"
                aria-label="Start new chat"
                title="New chat"
                className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
                onClick={handleNewChat}
              >
                <Icon name="pencil" />
              </button>
            ) : null}
            <AgentsLibraryButton compact />
          </nav>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <ThreadListContainer />
          </div>
        )}

        <footer
          className={cn(
            'flex shrink-0 border-t border-border px-3 py-2',
            collapsed ? 'flex-col items-center gap-2' : 'items-center gap-1',
          )}
        >
          <ShellActions className={collapsed ? 'flex-col' : undefined} />
        </footer>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Thread header: always on mobile; on desktop when Clear Chat / Save are relevant. Hidden while Settings owns the pane. */}
        {!settingsOpen ? (
          <header
            className={cn(
              'flex shrink-0 items-center gap-1 border-b border-border bg-background px-2 py-1.5',
              isIdle && 'md:hidden',
            )}
          >
            <button
              ref={menuBtnRef}
              type="button"
              aria-label="Sessions"
              aria-expanded={mobileNavOpen}
              className={cn(auiButtonClass({ variant: 'ghost', size: 'icon' }), 'md:hidden')}
              onClick={() => setMobileNavOpen(true)}
            >
              <Icon name="bars" />
            </button>
            <NamedAgentHeaderLabel />
            <span className="min-w-0 flex-1" />
            <ClearChatButton />
            <SaveAgentButton />
            <div className="md:hidden">
              <ShellActions />
            </div>
          </header>
        ) : null}

        <div ref={mainRef} className="min-h-0 min-w-0 flex-1">
          {settingsOpen ? <TruefoundrySettingsBuilder /> : isIdle ? <SelectAgentEmptyState /> : <Thread />}
        </div>
      </div>

      {/* Mobile sessions drawer */}
      {mobileNavOpen ? (
        <>
          <button
            type="button"
            aria-label="Close sessions"
            className="absolute inset-0 z-[9] cursor-pointer bg-black/20 md:hidden"
            onClick={() => setMobileNavOpen(false)}
          />
          <div
            ref={dialogRef}
            className="absolute inset-y-0 left-0 z-10 flex w-full max-w-80 flex-col border-r border-border bg-background shadow-lg outline-none md:hidden"
            role="dialog"
            aria-label="Sessions"
            tabIndex={-1}
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-3 text-foreground">
              <BrandIcon className="size-6 shrink-0 object-contain" />
              <span className="truncate text-lg font-semibold tracking-tight">{brand.name ?? 'TrueFoundry'}</span>
            </div>
            <ThreadListContainer onThreadOpen={() => setMobileNavOpen(false)} />
          </div>
        </>
      ) : null}
    </div>
  );
}
