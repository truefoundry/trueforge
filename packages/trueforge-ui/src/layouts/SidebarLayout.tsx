'use client';

import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';

import { useAui } from '../assistant-ui.js';
import { auiButtonClass } from '../atoms/lib/buttonClasses.js';
import { cn } from '../atoms/lib/cn.js';
import { NamedAgentHeaderLabel } from '../atoms/NamedAgentHeaderLabel.js';
import { Spinner } from '../atoms/primitives/Spinner.js';
import { ShellActions } from '../atoms/ShellActions.js';
import { Thread } from '../containers/Thread.js';
import { useChatHeaderContentVisible } from '../hooks/useChatChromeActionsVisible.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { resolveBrandChrome, useBrandName } from '../theme/brand.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { useBrand } from '../theme/ThemeProvider.js';

const TruefoundrySettingsBuilder = lazy(() => import('../containers/SettingsBuilder/index.js'));
const SchedulesPage = lazy(() =>
  import('../atoms/schedules/SchedulesPage.js').then(m => ({ default: m.SchedulesPage })),
);

const brandLogoClassName = 'h-5 max-w-40 shrink-0 object-contain';

function SidebarNav({ onNavigate, className }: { onNavigate?: () => void; className?: string }): ReactNode {
  const aui = useAui();
  const shell = useOptionalShellMode();
  const AgentsLibraryButton = useSlot('AgentsLibraryButton');
  const SessionsBrowserButton = useSlot('SessionsBrowserButton');
  const SchedulesButton = useSlot('SchedulesButton');

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

  return (
    <nav
      className={cn('flex min-h-0 flex-1 flex-col items-center gap-2 px-2', className)}
      aria-label="Sidebar"
      onClick={event => {
        if (onNavigate == null) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest('button') != null) onNavigate();
      }}
    >
      {shell?.isNewChatEnabled !== false ? (
        <button
          type="button"
          aria-label="Start new chat"
          title="New chat"
          className={auiButtonClass({
            variant: 'ghost',
            className:
              'h-auto w-full flex-col gap-0.5 whitespace-normal px-1 py-1.5 text-[10px] leading-tight !justify-center text-text-primary shadow-none hover:bg-ghost-button-hover hover:text-ghost-button-text',
          })}
          onClick={handleNewChat}
        >
          <Icon name="square-pen" size={16} />
          <span className="text-center">New Chat</span>
        </button>
      ) : null}
      <AgentsLibraryButton compact />
      <SessionsBrowserButton compact />
      <SchedulesButton compact />
    </nav>
  );
}

export function SidebarLayout({ className }: { className?: string }) {
  const shell = useOptionalShellMode();
  const brand = useBrand();
  const brandName = useBrandName();
  const chrome = resolveBrandChrome(brand);
  const BrandLogo = useSlot('BrandLogo');
  const AgentDetailsPage = useSlot('AgentDetailsPage');
  const AgentsLibrary = useSlot('AgentsLibrary');
  const SessionsPage = useSlot('SessionsPage');
  const ClearChatButton = useSlot('ClearChatButton');
  const SaveAgentButton = useSlot('SaveAgentButton');
  const SelectAgentEmptyState = useSlot('SelectAgentEmptyState');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const isIdle = shell?.mode.status === 'idle';
  const settingsOpen = shell?.settingsOpen === true;
  const libraryOpen = shell?.libraryOpen === true;
  const sessionsOpen = shell?.sessionsOpen === true;
  const schedulesOpen = shell?.schedulesOpen === true;
  const overlayOpen = settingsOpen || libraryOpen || sessionsOpen || schedulesOpen;
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

  return (
    <div className={cn('relative flex h-full min-h-0 w-full min-w-0', className)}>
      {/* Desktop sidebar — permanent icon+label rail */}
      <aside className="hidden w-20 min-h-0 shrink-0 flex-col border-r border-border bg-sidebar-bg md:flex">
        <div className="flex shrink-0 flex-col items-center gap-3 border-b border-border px-2 py-3">
          <div className="flex min-w-0 items-center justify-center text-text-primary">
            <BrandLogo variant={chrome.collapsedVariant} className={cn(brandLogoClassName, 'w-5')} />
          </div>
        </div>

        <SidebarNav />

        <footer className="flex shrink-0 flex-col items-center border-t border-border px-2 py-2">
          <ShellActions labeled className="flex-col" />
        </footer>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-primary-bg">
        {/* Mobile ShellActions stay mounted while Settings is open so host overrides (e.g. logout) do not remount.
            Desktop keeps shell chrome in the aside footer (always mounted). */}
        <header
          className={cn(
            'flex shrink-0 items-center gap-1 border-b border-border bg-topbar-bg px-2 py-1.5',
            // Desktop: hide when settings/idle or the thread header has nothing to show
            // (empty untitled draft). Mobile still needs menu + ShellActions.
            (overlayOpen || isIdle || !hasChatHeaderContent) && 'md:hidden',
          )}
        >
          {!overlayOpen ? (
            <>
              <button
                ref={menuBtnRef}
                type="button"
                aria-label="Navigation"
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
      </div>

      {/* Mobile navigation drawer */}
      {mobileNavOpen ? (
        <>
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 z-[9] cursor-pointer bg-[var(--overlay)] md:hidden"
            onClick={() => setMobileNavOpen(false)}
          />
          <div
            ref={dialogRef}
            className="absolute inset-y-0 left-0 z-10 flex w-full max-w-80 flex-col border-r border-border bg-sidebar-bg shadow-lg outline-none md:hidden"
            role="dialog"
            aria-label="Navigation"
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
            <SidebarNav onNavigate={() => setMobileNavOpen(false)} className="items-stretch p-3" />
          </div>
        </>
      ) : null}
    </div>
  );
}
