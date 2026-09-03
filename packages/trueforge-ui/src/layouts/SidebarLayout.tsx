'use client';

import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type Ref,
} from 'react';

import { useAui } from '../assistant-ui.js';
import { auiButtonClass } from '../atoms/lib/buttonClasses.js';
import { cn } from '../atoms/lib/cn.js';
import { NamedAgentHeaderLabel } from '../atoms/NamedAgentHeaderLabel.js';
import { Spinner } from '../atoms/primitives/Spinner.js';
import { ShellActions } from '../atoms/ShellActions.js';
import { AgentConfigDrawerContainer } from '../containers/AgentConfigDrawerContainer.js';
import { Thread } from '../containers/Thread.js';
import { useChatHeaderContentVisible } from '../hooks/useChatChromeActionsVisible.js';
import { Icon } from '../icons/Icon.js';
import { shellIsCreateAgent, useOptionalShellMode } from '../server/ShellModeContext.js';
import { resolveBrandChrome } from '../theme/brand.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { useBrand } from '../theme/ThemeProvider.js';

const TruefoundrySettingsBuilder = lazy(() => import('../containers/SettingsBuilder/index.js'));
const SchedulesPage = lazy(() =>
  import('../atoms/schedules/SchedulesPage.js').then(m => ({ default: m.SchedulesPage })),
);

const brandLogoClassName = 'h-5 w-5 max-w-40 shrink-0 object-contain';
const railWidthClassName = 'w-18';

const railActionButtonClassName =
  'h-auto w-full flex-col gap-1 whitespace-normal px-1 py-1.5 text-[10px] leading-tight !justify-center text-text-primary shadow-none hover:bg-ghost-button-hover hover:text-ghost-button-text';

const railSelectedClassName =
  'bg-primary-button-bg text-primary-button-text hover:bg-primary-button-hover hover:text-primary-button-text';

function SidebarNav(): ReactNode {
  const aui = useAui();
  const shell = useOptionalShellMode();
  const AgentsLibraryButton = useSlot('AgentsLibraryButton');
  const SessionsBrowserButton = useSlot('SessionsBrowserButton');
  const SchedulesButton = useSlot('SchedulesButton');
  const showNewActions = shell?.isNewChatEnabled !== false;
  const overlayOpen =
    shell?.settingsOpen === true ||
    shell?.libraryOpen === true ||
    shell?.sessionsOpen === true ||
    shell?.schedulesOpen === true;
  const mode = shell?.mode;
  const newChatSelected = !overlayOpen && mode?.status === 'active' && mode.isMutable && !mode.isCreateAgent;
  const newAgentSelected = !overlayOpen && mode != null && shellIsCreateAgent(mode);

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
    <nav className="flex min-h-0 flex-1 flex-col items-center gap-2 p-1" aria-label="Sidebar">
      {showNewActions ? (
        <button
          type="button"
          aria-label="Start new chat"
          title="New chat"
          aria-current={newChatSelected ? 'page' : undefined}
          className={auiButtonClass({
            variant: 'ghost',
            className: cn(railActionButtonClassName, newChatSelected && railSelectedClassName),
          })}
          onClick={handleNewChat}
        >
          <Icon name="square-pen" size={16} />
          <span className="text-center">New Chat</span>
        </button>
      ) : null}
      {showNewActions && shell?.isComposerEnabled ? (
        <button
          type="button"
          aria-label="Start new agent"
          title="New Agent"
          aria-current={newAgentSelected ? 'page' : undefined}
          className={auiButtonClass({
            variant: 'ghost',
            className: cn(railActionButtonClassName, newAgentSelected && railSelectedClassName),
          })}
          onClick={handleNewAgent}
        >
          <Icon name="agent-2" size={16} />
          <span className="text-center">New Agent</span>
        </button>
      ) : null}
      <AgentsLibraryButton compact />
      <SessionsBrowserButton compact />
      <SchedulesButton compact />
    </nav>
  );
}

/** Shared desktop + mobile icon+label rail (brand, nav, footer actions). */
function SidebarRail({
  onNavigate,
  className,
  railRef,
  ...dialogProps
}: {
  onNavigate?: () => void;
  className?: string;
  railRef?: Ref<HTMLElement>;
} & Omit<ComponentPropsWithoutRef<'aside'>, 'children' | 'className'>): ReactNode {
  const brand = useBrand();
  const chrome = resolveBrandChrome(brand);
  const BrandLogo = useSlot('BrandLogo');

  return (
    <aside
      ref={railRef}
      className={cn(
        railWidthClassName,
        'flex min-h-0 shrink-0 flex-col border-r border-border bg-sidebar-bg',
        className,
      )}
      onClick={event => {
        if (onNavigate == null) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest('button') != null) onNavigate();
      }}
      {...dialogProps}
    >
      <div className="flex h-14 w-full shrink-0 items-center justify-center text-text-primary">
        <BrandLogo variant={chrome.collapsedVariant} className={brandLogoClassName} />
      </div>
      <SidebarNav />
      <footer className="flex shrink-0 flex-col items-center border-border p-2">
        <ShellActions labeled className="flex-col" />
      </footer>
    </aside>
  );
}

export function SidebarLayout({ className }: { className?: string }) {
  const shell = useOptionalShellMode();
  const AgentDetailsPage = useSlot('AgentDetailsPage');
  const AgentsLibrary = useSlot('AgentsLibrary');
  const SessionsPage = useSlot('SessionsPage');
  const ClearChatButton = useSlot('ClearChatButton');
  const SaveAgentButton = useSlot('SaveAgentButton');
  const SelectAgentEmptyState = useSlot('SelectAgentEmptyState');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
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
      <SidebarRail className="hidden md:flex" />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-primary-bg">
        {/* Desktop keeps shell chrome in the rail footer (always mounted, including
            when visually hidden on small screens so host action-slot state persists).
            Mobile reaches theme/settings via the nav drawer rail. */}
        <header
          className={cn(
            'flex shrink-0 items-center gap-1 border-b border-border bg-topbar-bg px-2 py-1.5',
            // Desktop: hide when settings/idle or the thread header has nothing to show
            // (empty untitled draft). Mobile still needs the menu button.
            // Keep visible while Agent Config is open so New Agent / title stay in chrome;
            // SaveAgentButton is omitted below to avoid duplicating the drawer's save control.
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
              {!shell?.agentConfigOpen ? <SaveAgentButton /> : null}
            </>
          ) : (
            <span className="min-w-0 flex-1" />
          )}
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

      {shell?.agentConfigOpen ? (
        <aside
          role="dialog"
          aria-label="Agent Config"
          className="absolute inset-y-0 right-0 z-20 w-full max-w-sm border-l border-border shadow-xl md:static md:z-auto md:w-[22rem] md:max-w-none md:shrink-0 md:shadow-none"
        >
          <AgentConfigDrawerContainer />
        </aside>
      ) : null}

      {/* Mobile: same narrow rail as desktop */}
      {mobileNavOpen ? (
        <>
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 z-[9] cursor-pointer bg-[var(--overlay)] md:hidden"
            onClick={() => setMobileNavOpen(false)}
          />
          <SidebarRail
            railRef={dialogRef}
            role="dialog"
            aria-label="Navigation"
            tabIndex={-1}
            onNavigate={() => setMobileNavOpen(false)}
            className="absolute inset-y-0 left-0 z-10 shadow-lg outline-none md:hidden"
          />
        </>
      ) : null}
    </div>
  );
}
