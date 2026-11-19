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
import { DesktopOnlyNotice } from '../atoms/DesktopOnlyNotice.js';
import { auiButtonClass, shellRailSelectedClassName, sidebarRailButtonClassName } from '../atoms/lib/buttonClasses.js';
import { cn } from '../atoms/lib/cn.js';
import { useIsMobile } from '../atoms/lib/useIsMobile.js';
import { NamedAgentHeaderLabel } from '../atoms/NamedAgentHeaderLabel.js';
import { PageHeader } from '../atoms/PageHeader.js';
import { Spinner } from '../atoms/primitives/Spinner.js';
import { RailTooltip } from '../atoms/primitives/Tooltip.js';
import { ShellActions } from '../atoms/ShellActions.js';
import { AgentConfigDrawerContainer } from '../containers/AgentConfigDrawerContainer.js';
import { Thread } from '../containers/Thread.js';
import { ThreadListContainer } from '../containers/ThreadListContainer.js';
import { FilePreviewProvider, useFilePreview } from '../filePreview/FilePreviewContext.js';
import { useChatHeaderContentVisible } from '../hooks/useChatChromeActionsVisible.js';
import { Icon } from '../icons/Icon.js';
import { shellIsCreateAgent, useOptionalShellMode, type ShellMode } from '../server/ShellModeContext.js';
import { resolveBrandChrome, useBrandName } from '../theme/brand.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { useBrand } from '../theme/ThemeProvider.js';

const TruefoundrySettingsBuilder = lazy(() => import('../containers/SettingsBuilder/index.js'));
const SchedulesPage = lazy(() =>
  import('../atoms/schedules/SchedulesPage.js').then(m => ({ default: m.SchedulesPage })),
);
const EnvironmentsPage = lazy(() =>
  import('../atoms/environments/EnvironmentsPage.js').then(m => ({ default: m.EnvironmentsPage })),
);

const brandLogoClassName = 'h-5 w-5 max-w-40 shrink-0 object-contain';
const brandLogoExpandedClassName = 'h-5 max-w-40 shrink-0 object-contain';
/** Icon-only app rail: 52px. */
const railWidthClassName = 'w-[3.25rem]';
const mobileDrawerWidthClassName = 'w-80';
const recentHistoryPanelId = 'aui-recent-chat-history';
/** Outer chrome behind the padded shell (rail + inset gutter). */
const shellChromeBgClassName = 'bg-primary-bg';
/** Chat history + main pane surface inside the padded shell. */
const shellSurfaceBgClassName = 'bg-card-bg';

const railActionButtonClassName = cn(sidebarRailButtonClassName, 'text-sidebar-text');

function isRecentHistoryVisible({ overlayOpen, mode }: { overlayOpen: boolean; mode?: ShellMode }): boolean {
  return !overlayOpen && mode?.status === 'active' && !mode.isCreateAgent;
}

function RecentChatsAside({
  collapsed,
  onCollapsedChange,
}: {
  collapsed: boolean;
  onCollapsedChange: (next: boolean) => void;
}) {
  const preview = useFilePreview();
  if (preview.presentation === 'full') return null;

  if (collapsed) {
    return (
      <aside
        id={recentHistoryPanelId}
        aria-label="Recent chats"
        className={cn('hidden min-h-0 w-12 shrink-0 flex-col border-r border-border md:flex', shellSurfaceBgClassName)}
      >
        <div className="flex min-h-14 w-full items-center justify-center border-b border-border px-2">
          <RailTooltip content="Open chat history">
            <button
              type="button"
              aria-label="Open chat history"
              aria-controls={recentHistoryPanelId}
              aria-expanded={false}
              className={auiButtonClass({
                variant: 'ghost',
                size: 'icon',
                className: 'size-7 text-text-secondary hover:bg-ghost-button-hover hover:text-ghost-button-text',
              })}
              onClick={() => onCollapsedChange(false)}
            >
              <Icon name="panel-left-open" className="size-3.5" />
            </button>
          </RailTooltip>
        </div>
      </aside>
    );
  }

  return (
    <aside
      id={recentHistoryPanelId}
      aria-label="Recent chats"
      className={cn('hidden min-h-0 w-64 shrink-0 border-r border-border md:flex', shellSurfaceBgClassName)}
    >
      <ThreadListContainer variant="recent-history" onCollapseRecentHistory={() => onCollapsedChange(true)} />
    </aside>
  );
}

function SidebarNav(): ReactNode {
  const aui = useAui();
  const shell = useOptionalShellMode();
  const AgentsLibraryButton = useSlot('AgentsLibraryButton');
  const SessionsBrowserButton = useSlot('SessionsBrowserButton');
  const SchedulesButton = useSlot('SchedulesButton');
  const EnvironmentsButton = useSlot('EnvironmentsButton');
  const showNewActions = shell?.isNewChatEnabled !== false;
  const overlayOpen =
    shell?.settingsOpen === true ||
    shell?.libraryOpen === true ||
    shell?.sessionsOpen === true ||
    shell?.schedulesOpen === true ||
    shell?.environmentsOpen === true;
  const mode = shell?.mode;
  const newChatSelected =
    !overlayOpen &&
    mode?.status === 'active' &&
    !mode.isCreateAgent &&
    shell?.historyAgentFilter?.intent !== 'try-agent';
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
    shell?.setEnvironmentsOpen(false);
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
    <nav className="flex min-h-0 flex-1 flex-col items-center gap-4" aria-label="Sidebar">
      {showNewActions ? (
        <RailTooltip content="New chat">
          <button
            type="button"
            aria-label="Start new chat"
            aria-current={newChatSelected ? 'page' : undefined}
            className={auiButtonClass({
              variant: 'ghost',
              className: cn(railActionButtonClassName, newChatSelected && shellRailSelectedClassName),
            })}
            onClick={handleNewChat}
          >
            <Icon name="square-pen" size={16} />
          </button>
        </RailTooltip>
      ) : null}
      {showNewActions && shell?.isComposerEnabled ? (
        <RailTooltip content="New Agent">
          <button
            type="button"
            aria-label="Start new agent"
            aria-current={newAgentSelected ? 'page' : undefined}
            className={auiButtonClass({
              variant: 'ghost',
              className: cn(railActionButtonClassName, newAgentSelected && shellRailSelectedClassName),
            })}
            onClick={handleNewAgent}
          >
            <Icon name="agent-2" size={16} />
          </button>
        </RailTooltip>
      ) : null}
      <AgentsLibraryButton compact />
      <SessionsBrowserButton compact />
      <SchedulesButton compact />
      <EnvironmentsButton compact />
    </nav>
  );
}

/** Desktop icon-only rail (brand, nav, footer actions). */
function SidebarRail({
  className,
  railRef,
  ...dialogProps
}: {
  className?: string;
  railRef?: Ref<HTMLElement>;
} & Omit<ComponentPropsWithoutRef<'aside'>, 'children' | 'className'>): ReactNode {
  const brand = useBrand();
  const chrome = resolveBrandChrome(brand);
  const BrandLogo = useSlot('BrandLogo');
  const UserAvatar = useSlot('UserAvatar');

  return (
    <aside
      ref={railRef}
      data-slot="aui_app-rail"
      className={cn(
        railWidthClassName,
        'flex min-h-0 shrink-0 flex-col text-sidebar-text',
        shellChromeBgClassName,
        className,
      )}
      {...dialogProps}
    >
      {/* pt-2 matches the padded shell inset; h-14 matches PageHeader / chat-history title. */}
      <div className="flex shrink-0 flex-col items-center px-2 pt-2">
        <div className="flex h-14 w-full shrink-0 items-center justify-center text-text-primary">
          <BrandLogo variant={chrome.collapsedVariant} className={brandLogoClassName} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center gap-4 px-2 pt-2">
        <SidebarNav />
      </div>
      <footer className="flex shrink-0 flex-col items-center gap-2 px-2 py-2">
        <ShellActions iconOnly />
        <UserAvatar iconOnly />
      </footer>
    </aside>
  );
}

/** Claude-style mobile side drawer: branding, New Chat + Agents, history, footer actions. */
function MobileNavDrawer({ drawerRef, onClose }: { drawerRef: Ref<HTMLElement>; onClose: () => void }): ReactNode {
  const brand = useBrand();
  const chrome = resolveBrandChrome(brand);
  const brandName = useBrandName();
  const BrandLogo = useSlot('BrandLogo');
  const UserAvatar = useSlot('UserAvatar');

  return (
    <aside
      ref={drawerRef}
      role="dialog"
      aria-label="Navigation"
      tabIndex={-1}
      className={cn(
        mobileDrawerWidthClassName,
        'absolute inset-y-0 left-0 z-10 flex min-h-0 flex-col border-r border-border bg-sidebar-bg shadow-lg outline-none md:hidden',
      )}
    >
      <div className="flex h-14 w-full shrink-0 items-center gap-2 border-b border-border px-3 text-text-primary">
        <BrandLogo variant={chrome.expandedVariant} className={brandLogoExpandedClassName} />
        {chrome.showTitle && brandName != null ? (
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{brandName}</span>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        <button
          type="button"
          aria-label="Close navigation"
          className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
          onClick={onClose}
        >
          <Icon name="xmark" />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <ThreadListContainer variant="mobile-drawer" onThreadOpen={onClose} />
      </div>
      <footer className="flex shrink-0 items-center justify-around gap-1 border-t border-border p-2 text-sidebar-text">
        {/* `contents` lets Docs / Theme / Settings share this row with the avatar. */}
        <ShellActions labeled onAction={onClose} className="contents" />
        <UserAvatar labeled />
      </footer>
    </aside>
  );
}

export function SidebarLayout({ className }: { className?: string }) {
  const shell = useOptionalShellMode();
  const isMobile = useIsMobile();
  const AgentDetailsPage = useSlot('AgentDetailsPage');
  const AgentsLibrary = useSlot('AgentsLibrary');
  const SessionsPage = useSlot('SessionsPage');
  const ShareChatButton = useSlot('ShareChatButton');
  const ResetAgentBuilderButton = useSlot('ResetAgentBuilderButton');
  const ClearChatButton = useSlot('ClearChatButton');
  const SaveAgentButton = useSlot('SaveAgentButton');
  const SelectAgentEmptyState = useSlot('SelectAgentEmptyState');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [recentHistoryCollapsed, setRecentHistoryCollapsed] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const isIdle = shell?.mode.status === 'idle';
  const settingsOpen = shell?.settingsOpen === true;
  const libraryOpen = shell?.libraryOpen === true;
  const libraryListOpen = libraryOpen && shell?.libraryAgentId == null;
  const sessionsOpen = shell?.sessionsOpen === true;
  const schedulesOpen = shell?.schedulesOpen === true;
  const environmentsOpen = shell?.environmentsOpen === true;
  const overlayOpen = settingsOpen || libraryOpen || sessionsOpen || schedulesOpen || environmentsOpen;
  const isCreateAgent = shell != null && shellIsCreateAgent(shell.mode);
  // Build Agent, Sessions, Schedules, and Environments are desktop-only; keep the URL and show a notice.
  const showDesktopOnlyNotice =
    isMobile && (sessionsOpen || schedulesOpen || environmentsOpen || (isCreateAgent && !settingsOpen && !libraryOpen));
  const showAgentConfig = isCreateAgent && !overlayOpen && !isMobile;
  const showRecentHistory = isRecentHistoryVisible({ overlayOpen, mode: shell?.mode });
  const hasChatHeaderContent = useChatHeaderContentVisible();
  // Agents / Settings own a page header — put the hamburger there instead of a second top bar.
  const inlineMobileNav = isMobile && (settingsOpen || libraryListOpen);
  const closeMobileNav = () => setMobileNavOpen(false);
  const mobileNavButton = (
    <button
      ref={menuBtnRef}
      type="button"
      aria-label="Navigation"
      aria-expanded={mobileNavOpen}
      className={cn(auiButtonClass({ variant: 'ghost', size: 'icon' }), 'md:hidden')}
      onClick={() => setMobileNavOpen(true)}
    >
      <Icon name="panel-left" />
    </button>
  );

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Capture + stop so Settings / Agents / Agent Details Escape handlers do not steal this.
      event.stopImmediatePropagation();
      setMobileNavOpen(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
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
    <div className={cn('relative flex h-full min-h-0 w-full min-w-0', shellChromeBgClassName, className)}>
      <SidebarRail className="hidden md:flex" />

      {/* Desktop: 8px inset on top/right/bottom; flush to the icon rail on the left. */}
      <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col md:pt-2 md:pr-2 md:pb-2', shellChromeBgClassName)}>
        <div
          className={cn(
            // Soft left-cast + ambient shadow so the pane reads raised above the rail.
            'relative z-[1] flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:rounded-2xl md:border md:border-border md:shadow-[-0.25rem_0_1.25rem_color-mix(in_oklab,var(--shadow-color)_7%,transparent),0_0.0625rem_0.375rem_color-mix(in_oklab,var(--shadow-color)_3.5%,transparent)]',
            shellSurfaceBgClassName,
          )}
        >
          <FilePreviewProvider>
            <div className="flex min-h-0 min-w-0 flex-1">
              {/* New Agent config sits inside the shell beside the chat column (same card as New Agent). */}
              {showAgentConfig ? (
                <aside
                  role="dialog"
                  aria-label="Agent Config"
                  className="flex min-h-0 w-full max-w-sm shrink-0 flex-col border-r border-border md:max-w-140 md:flex-1 2xl:max-w-150"
                >
                  <AgentConfigDrawerContainer />
                </aside>
              ) : null}

              {showRecentHistory ? (
                <RecentChatsAside collapsed={recentHistoryCollapsed} onCollapsedChange={setRecentHistoryCollapsed} />
              ) : null}

              <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', shellSurfaceBgClassName)}>
                {/* Header sits beside history so "New Chat" starts after the history column. */}
                {inlineMobileNav ? null : (
                  <PageHeader
                    className={cn(
                      shellSurfaceBgClassName,
                      // Desktop: hide when settings/idle or the thread header has nothing to show
                      // (empty untitled draft). Mobile still needs the menu button.
                      // Builder mode keeps New Agent and its actions beside the persistent config.
                      (overlayOpen || isIdle || !hasChatHeaderContent || showDesktopOnlyNotice) && 'md:hidden',
                    )}
                    start={mobileNavButton}
                    title={!overlayOpen && !showDesktopOnlyNotice ? <NamedAgentHeaderLabel /> : null}
                    end={
                      !overlayOpen && !showDesktopOnlyNotice ? (
                        <>
                          <ResetAgentBuilderButton />
                          <ShareChatButton />
                          <ClearChatButton />
                          <SaveAgentButton />
                        </>
                      ) : null
                    }
                  />
                )}

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
                      <TruefoundrySettingsBuilder {...(inlineMobileNav ? { headerStart: mobileNavButton } : {})} />
                    </Suspense>
                  ) : showDesktopOnlyNotice ? (
                    <DesktopOnlyNotice />
                  ) : sessionsOpen ? (
                    <SessionsPage />
                  ) : libraryOpen && shell?.libraryAgentId != null ? (
                    <AgentDetailsPage key={shell.libraryAgentId} agentId={shell.libraryAgentId} />
                  ) : libraryOpen ? (
                    <AgentsLibrary
                      onSelectAgent={closeMobileNav}
                      {...(inlineMobileNav ? { headerStart: mobileNavButton } : {})}
                    />
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
                  ) : environmentsOpen ? (
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
                      <EnvironmentsPage />
                    </Suspense>
                  ) : isIdle ? (
                    <SelectAgentEmptyState />
                  ) : (
                    <Thread />
                  )}
                </div>
              </div>
            </div>
          </FilePreviewProvider>
        </div>
      </div>

      {mobileNavOpen ? (
        <>
          <button
            type="button"
            aria-label="Close navigation backdrop"
            className="absolute inset-0 z-[9] cursor-pointer bg-[var(--overlay)] md:hidden"
            onClick={closeMobileNav}
          />
          <MobileNavDrawer drawerRef={dialogRef} onClose={closeMobileNav} />
        </>
      ) : null}
    </div>
  );
}
