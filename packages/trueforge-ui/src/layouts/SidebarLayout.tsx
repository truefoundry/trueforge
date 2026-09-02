'use client';

import { lazy, Suspense, useEffect, useRef, useState } from 'react';

import { useAui } from '../assistant-ui.js';
import { cn } from '../atoms/lib/cn.js';
import { NamedAgentHeaderLabel } from '../atoms/NamedAgentHeaderLabel.js';
import { Button } from '../atoms/primitives/Button.js';
import { Spinner } from '../atoms/primitives/Spinner.js';
import { ShellActions } from '../atoms/ShellActions.js';
import { Thread } from '../containers/Thread.js';
import { ThreadListContainer } from '../containers/ThreadListContainer.js';
import { useChatHeaderContentVisible } from '../hooks/useChatChromeActionsVisible.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { resolveBrandChrome, useBrandName } from '../theme/brand.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { useBrand } from '../theme/ThemeProvider.js';

const TruefoundrySettingsBuilder = lazy(() => import('../containers/SettingsBuilder/index.js'));

// Survives ChatProvider remounts when openDraft / selectAgent bumps runtimeKey.
let desktopCollapsed = false;

const brandLogoClassName = 'h-5 max-w-40 shrink-0 object-contain';

export function SidebarLayout({ className }: { className?: string }) {
  const aui = useAui();
  const shell = useOptionalShellMode();
  const brand = useBrand();
  const brandName = useBrandName();
  const chrome = resolveBrandChrome(brand);
  const BrandLogo = useSlot('BrandLogo');
  const AgentDetailsPage = useSlot('AgentDetailsPage');
  const AgentsLibrary = useSlot('AgentsLibrary');
  const AgentsLibraryButton = useSlot('AgentsLibraryButton');
  const SessionsBrowserButton = useSlot('SessionsBrowserButton');
  const SessionsPage = useSlot('SessionsPage');
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
  const libraryOpen = shell?.libraryOpen === true;
  const sessionsOpen = shell?.sessionsOpen === true;
  const overlayOpen = settingsOpen || libraryOpen || sessionsOpen;
  const hasChatHeaderContent = useChatHeaderContentVisible();

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
    shell?.setLibraryOpen(false);
    shell?.setSessionsOpen(false);
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
          'hidden min-h-0 shrink-0 flex-col border-r border-border bg-sidebar-bg transition-[width] duration-300 ease-in-out md:flex',
          collapsed ? 'w-16' : 'w-64',
        )}
      >
        <div
          className={cn('flex shrink-0 items-center px-3 py-3', collapsed ? 'flex-col gap-3' : 'justify-between gap-2')}
        >
          <div className={cn('flex min-w-0 items-center text-text-primary', collapsed ? 'justify-center' : 'gap-2')}>
            <BrandLogo
              variant={collapsed ? chrome.collapsedVariant : chrome.expandedVariant}
              className={cn(brandLogoClassName, (collapsed || chrome.expandedVariant === 'icon') && 'w-5')}
            />
            {!collapsed && chrome.showTitle && brandName != null ? (
              <span className="truncate text-lg font-semibold tracking-tight">{brandName}</span>
            ) : null}
          </div>
          <Button.Ghost
            type="button"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            size="small"
            className="aspect-square px-0"
            onClick={() => setDesktopCollapsed(value => !value)}
          >
            <Icon name={collapsed ? 'panel-left-open' : 'panel-left-close'} />
          </Button.Ghost>
        </div>

        {/* Keep both trees mounted; toggle with `hidden` so AgentsLibraryButton does not remount. */}
        <nav className="flex min-h-0 flex-1 flex-col items-center gap-2 px-3" hidden={!collapsed} aria-label="Sidebar">
          {shell?.isNewChatEnabled !== false ? (
            <Button.Ghost
              type="button"
              aria-label="Start new chat"
              title="New chat"
              size="small"
              className="aspect-square px-0"
              onClick={handleNewChat}
            >
              <Icon name="square-pen" />
            </Button.Ghost>
          ) : null}
          <AgentsLibraryButton compact />
          <SessionsBrowserButton compact />
        </nav>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden" hidden={collapsed}>
          <ThreadListContainer />
        </div>

        <footer
          className={cn(
            'flex shrink-0 border-t border-border px-3 py-2',
            collapsed ? 'flex-col items-center gap-2' : 'items-center gap-1',
          )}
        >
          <ShellActions className={collapsed ? 'flex-col' : undefined} />
        </footer>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-primary-bg">
        {/* Mobile ShellActions stay mounted while Settings is open so host overrides (e.g. logout) do not remount.
            Desktop keeps shell chrome in the aside footer (always mounted). */}
        <header
          className={cn(
            'flex shrink-0 items-center gap-1 border-b border-border bg-topbar-bg px-2 py-1.5',
            // Desktop: hide when settings/idle or the thread header has nothing to show
            // (empty untitled draft). Mobile still needs Sessions + ShellActions.
            (overlayOpen || isIdle || !hasChatHeaderContent) && 'md:hidden',
          )}
        >
          {!overlayOpen ? (
            <>
              <Button.Ghost
                ref={menuBtnRef}
                type="button"
                aria-label="Sessions"
                aria-expanded={mobileNavOpen}
                size="small"
                className="aspect-square px-0 md:hidden"
                onClick={() => setMobileNavOpen(true)}
              >
                <Icon name="bars" />
              </Button.Ghost>
              <NamedAgentHeaderLabel />
              <span className="min-w-0 flex-1" />
              <ClearChatButton />
              <SaveAgentButton />
            </>
          ) : (
            <span className="min-w-0 flex-1" />
          )}
          <div key="mobile-shell-actions" className="md:hidden">
            <ShellActions />
          </div>
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
            <AgentsLibrary onSelectAgent={() => setMobileNavOpen(false)} />
          ) : isIdle ? (
            <SelectAgentEmptyState />
          ) : (
            <Thread />
          )}
        </div>
      </div>

      {/* Mobile sessions drawer */}
      {mobileNavOpen ? (
        <>
          <Button.Ghost
            type="button"
            aria-label="Close sessions"
            className="absolute inset-0 z-[9] h-auto rounded-none bg-[var(--overlay)] p-0 shadow-none hover:bg-[var(--overlay)] md:hidden"
            onClick={() => setMobileNavOpen(false)}
          />
          <div
            ref={dialogRef}
            className="absolute inset-y-0 left-0 z-10 flex w-full max-w-80 flex-col border-r border-border bg-sidebar-bg shadow-lg outline-none md:hidden"
            role="dialog"
            aria-label="Sessions"
            tabIndex={-1}
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-3 text-text-primary">
              <BrandLogo
                variant={chrome.expandedVariant}
                className={cn(brandLogoClassName, chrome.expandedVariant === 'icon' && 'w-5')}
              />
              {chrome.showTitle && brandName != null ? (
                <span className="truncate text-lg font-semibold tracking-tight">{brandName}</span>
              ) : null}
            </div>
            <ThreadListContainer onThreadOpen={() => setMobileNavOpen(false)} />
          </div>
        </>
      ) : null}
    </div>
  );
}
