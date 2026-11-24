'use client';

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type Ref,
} from 'react';
import { createPortal } from 'react-dom';

import { useAui, useAuiState } from '../assistant-ui.js';
import { DesktopOnlyNotice } from '../atoms/DesktopOnlyNotice.js';
import {
  auiButtonClass,
  shellHoverClassName,
  shellRailSelectedClassName,
  shellSelectedClassName,
  sidebarButtonRadiusClassName,
  sidebarCompactNavButtonClassName,
} from '../atoms/lib/buttonClasses.js';
import { cn } from '../atoms/lib/cn.js';
import { themePortalRoot } from '../atoms/lib/themePortalRoot.js';
import { useIsMobile } from '../atoms/lib/useIsMobile.js';
import { NamedAgentHeaderLabel } from '../atoms/NamedAgentHeaderLabel.js';
import { PageHeader } from '../atoms/PageHeader.js';
import { Spinner } from '../atoms/primitives/Spinner.js';
import { RailTooltip } from '../atoms/primitives/Tooltip.js';
import { ShellActions } from '../atoms/ShellActions.js';
import { AgentConfigDrawerContainer } from '../containers/AgentConfigDrawerContainer.js';
import { Thread } from '../containers/Thread.js';
import { ThreadListContainer } from '../containers/ThreadListContainer.js';
import { FilePreviewProvider } from '../filePreview/FilePreviewContext.js';
import { useChatHeaderContentVisible } from '../hooks/useChatChromeActionsVisible.js';
import { Icon } from '../icons/Icon.js';
import { shellIsCreateAgent, useOptionalShellMode } from '../server/ShellModeContext.js';
import { resolveBrandChrome, useBrandName } from '../theme/brand.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { useBrand } from '../theme/ThemeProvider.js';

const TruefoundrySettingsBuilder = lazy(() => import('../containers/SettingsBuilder/index.js'));
const SchedulesPage = lazy(() =>
  import('../atoms/schedules/SchedulesPage.js').then(m => ({ default: m.SchedulesPage })),
);
/** Logomark slot — same h-5 w-5 in expanded and collapsed. */
const brandLogoClassName = 'h-5 w-5 shrink-0 object-contain';
/** Labeled sidebar with nav + chat history: 256px. */
const railExpandedWidthClassName = 'w-64';
/** Equal L/R padding around icon column — see `.aui-sidebar-rail-collapsed`. */
const railCollapsedWidthClassName = 'aui-sidebar-rail-collapsed';
const mobileDrawerWidthClassName = 'w-80';
const recentHistoryPanelId = 'aui-recent-chat-history';
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'aui-sidebar-collapsed';
/** Outer chrome behind the padded shell (rail + inset gutter). */
const shellChromeBgClassName = 'bg-primary-bg';
/** Main pane surface inside the padded shell. */
const shellSurfaceBgClassName = 'bg-card-bg';

const sidebarNavButtonClassName = cn(
  sidebarButtonRadiusClassName,
  'h-8 w-full !justify-start px-2.5 text-sm font-normal text-sidebar-text shadow-none',
  shellHoverClassName,
);

function readSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeSidebarCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    /* ignore quota / private mode */
  }
}

/** Collapsed-rail Chat History: flyout to the right with list + filter (keeps the rail collapsed). */
function CollapsedChatHistoryButton(): ReactNode {
  const shell = useOptionalShellMode();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const update = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPos({ top: rect.top, left: rect.right + 8 });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  const trigger = (
    <button
      ref={buttonRef}
      type="button"
      aria-label="Open chat history"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      className={auiButtonClass({
        variant: 'ghost',
        className: cn(sidebarCompactNavButtonClassName, open && shellRailSelectedClassName),
      })}
      onClick={() => {
        shell?.setSettingsOpen(false);
        shell?.setLibraryOpen(false);
        shell?.setSessionsOpen(false);
        shell?.setSchedulesOpen(false);
        setOpen(value => !value);
      }}
    >
      <Icon name="message-square-text" />
    </button>
  );

  const panel =
    open && pos != null
      ? createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label="Chat History"
            style={{ top: pos.top, left: pos.left }}
            className="aui-collapsed-chat-history-popover aui-popup-enter fixed z-[200] flex flex-col overflow-hidden border border-border bg-card-bg text-text-primary"
            onMouseDown={event => event.stopPropagation()}
          >
            <ThreadListContainer variant="recent-history" onThreadOpen={() => setOpen(false)} />
          </div>,
          themePortalRoot(buttonRef.current),
        )
      : null;

  return (
    <>
      {open ? trigger : <RailTooltip content="Chat History">{trigger}</RailTooltip>}
      {panel}
    </>
  );
}

function SidebarNav({ compact = false }: { compact?: boolean }): ReactNode {
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
  // Match history-row active: main thread is a persisted session (has remoteId).
  const viewingHistorySession = useAuiState(s => {
    const mainId = s.threads.mainThreadId;
    const mainItem = s.threads.threadItems.find(item => item.id === mainId);
    return (mainItem?.remoteId ?? s.threadListItem.remoteId) != null;
  });
  const onPersistedChat = viewingHistorySession || shell?.pendingSessionId != null;
  const newChatSelected =
    !overlayOpen &&
    !onPersistedChat &&
    mode?.status === 'active' &&
    !mode.isCreateAgent &&
    shell?.historyAgentFilter?.intent !== 'try-agent';
  // Mirror New Chat: leave New Agent when a persisted history session is active.
  const newAgentSelected = !overlayOpen && !onPersistedChat && mode != null && shellIsCreateAgent(mode);

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

  const navButtonClass = compact ? sidebarCompactNavButtonClassName : sidebarNavButtonClassName;
  const selectedClass = compact ? shellRailSelectedClassName : shellSelectedClassName;

  const newChatButton = (
    <button
      type="button"
      aria-label="Start new chat"
      aria-current={newChatSelected ? 'page' : undefined}
      className={auiButtonClass({
        variant: 'ghost',
        className: cn(navButtonClass, newChatSelected && selectedClass),
      })}
      onClick={handleNewChat}
    >
      <Icon name="square-pen" />
      {compact ? null : <span className="truncate">New Chat</span>}
    </button>
  );

  const newAgentButton = (
    <button
      type="button"
      aria-label="Start new agent"
      aria-current={newAgentSelected ? 'page' : undefined}
      className={auiButtonClass({
        variant: 'ghost',
        className: cn(navButtonClass, newAgentSelected && selectedClass),
      })}
      onClick={handleNewAgent}
    >
      <Icon name="message-ai-3-line" />
      {compact ? null : <span className="truncate">New Agent</span>}
    </button>
  );

  return (
    <nav
      className={cn('flex shrink-0 flex-col gap-1', compact ? 'items-center' : 'items-stretch')}
      aria-label="Sidebar"
    >
      {showNewActions ? compact ? <RailTooltip content="New chat">{newChatButton}</RailTooltip> : newChatButton : null}
      {showNewActions && shell?.isComposerEnabled ? (
        compact ? (
          <RailTooltip content="New Agent">{newAgentButton}</RailTooltip>
        ) : (
          newAgentButton
        )
      ) : null}
      <AgentsLibraryButton compact={compact} />
      <SessionsBrowserButton compact={compact} />
      <SchedulesButton compact={compact} />
      {compact ? <CollapsedChatHistoryButton /> : null}
    </nav>
  );
}

function SidebarRecentHistory(): ReactNode {
  return (
    <aside
      id={recentHistoryPanelId}
      aria-label="Recent chats"
      tabIndex={-1}
      // No separator — 1rem gap above the section label instead.
      className="flex min-h-0 min-w-0 flex-1 flex-col pt-4 outline-none"
    >
      <ThreadListContainer variant="recent-history" />
    </aside>
  );
}

/** Collapsed brand control: same h-5 w-5 logomark slot as expanded; expand icon on hover/focus. */
function CollapsedRailExpandButton({ onExpand }: { onExpand: () => void }): ReactNode {
  const brand = useBrand();
  const chrome = resolveBrandChrome(brand);
  const BrandLogo = useSlot('BrandLogo');
  const [showExpand, setShowExpand] = useState(false);

  return (
    <button
      type="button"
      aria-label="Expand sidebar"
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-md text-sidebar-text',
        shellHoverClassName,
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring',
      )}
      onClick={onExpand}
      onMouseEnter={() => setShowExpand(true)}
      onMouseLeave={() => setShowExpand(false)}
      onFocus={() => setShowExpand(true)}
      onBlur={() => setShowExpand(false)}
    >
      {showExpand ? (
        <Icon name="panel-left-open" className="size-5" />
      ) : (
        <BrandLogo linked={false} variant={chrome.collapsedVariant} className={brandLogoClassName} />
      )}
    </button>
  );
}

/** Desktop labeled / icon rail (brand, nav, optional chat history, footer). */
function SidebarRail({
  className,
  railRef,
  collapsed,
  onCollapsedChange,
  ...dialogProps
}: {
  className?: string;
  railRef?: Ref<HTMLElement>;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
} & Omit<ComponentPropsWithoutRef<'aside'>, 'children' | 'className'>): ReactNode {
  const brand = useBrand();
  const chrome = resolveBrandChrome(brand);
  const brandName = useBrandName();
  const BrandLogo = useSlot('BrandLogo');
  const UserAvatar = useSlot('UserAvatar');

  return (
    <aside
      ref={railRef}
      data-slot="aui_app-rail"
      data-collapsed={collapsed ? 'true' : 'false'}
      className={cn(
        collapsed ? railCollapsedWidthClassName : railExpandedWidthClassName,
        // Clip labels when collapsed so the icon column stays fixed.
        'flex min-h-0 shrink-0 flex-col overflow-x-hidden text-sidebar-text',
        shellChromeBgClassName,
        className,
      )}
      {...dialogProps}
    >
      {/* Expanded: pr-3 matches footer/history so collapse lines up with filter, ages, settings. */}
      <div className={cn('flex shrink-0 flex-col pt-1.5', collapsed ? 'px-1.5' : 'pl-1.5 pr-3')}>
        <div
          className={cn(
            'flex h-14 w-full shrink-0 items-center text-text-primary',
            // Collapsed: center the logomark; expanded: start-aligned with title + collapse.
            collapsed ? 'justify-center' : 'gap-2 pl-2.5',
          )}
        >
          {collapsed ? (
            <CollapsedRailExpandButton onExpand={() => onCollapsedChange(false)} />
          ) : (
            <>
              {/* Same h-5 w-5 logomark as collapsed; name/title beside it when expanded. */}
              <BrandLogo variant={chrome.collapsedVariant} className={brandLogoClassName} />
              {brandName != null && (chrome.showTitle || chrome.expandedVariant === 'logo') ? (
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{brandName}</span>
              ) : (
                <span className="min-w-0 flex-1" />
              )}
              <button
                type="button"
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
                className={auiButtonClass({
                  variant: 'ghost',
                  size: 'icon',
                  className: cn('size-7 shrink-0 text-sidebar-text', shellHoverClassName),
                })}
                onClick={() => onCollapsedChange(true)}
              >
                <Icon name="panel-left-close" />
              </button>
            </>
          )}
        </div>
      </div>
      {/* Collapsed keeps px-2 for the 3.125rem icon column; expanded px-3 matches footer. */}
      <div className={cn('flex min-h-0 flex-1 flex-col pt-1', collapsed ? 'px-2' : 'px-3')}>
        <SidebarNav compact={collapsed} />
        {collapsed ? null : <SidebarRecentHistory />}
      </div>
      {collapsed ? (
        <footer className="flex shrink-0 flex-col items-center gap-1 px-2 pt-2 pb-2">
          <ShellActions iconOnly showDocs={false} />
          <UserAvatar iconOnly />
        </footer>
      ) : (
        // No top rule; pb matches `.aui-shell-card-inset` (0.5rem) so the row aligns with the main pane.
        <footer className="flex shrink-0 items-center gap-2 px-3 pt-2 pb-2">
          <UserAvatar className="max-w-none flex-1 flex-row items-center justify-start gap-2 [&_span]:text-left [&_span]:text-xs" />
          <ShellActions showDocs={false} />
        </footer>
      )}
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
        'aui-mobile-nav-drawer absolute inset-y-0 left-0 z-10 flex min-h-0 flex-col border-r border-border bg-sidebar-bg shadow-lg outline-none md:hidden',
      )}
    >
      <div className="flex h-14 w-full shrink-0 items-center gap-2 border-b border-border px-3 text-text-primary">
        <BrandLogo variant={chrome.collapsedVariant} className={brandLogoClassName} />
        {brandName != null && (chrome.showTitle || chrome.expandedVariant === 'logo') ? (
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
        {/* `contents` lets Theme / Settings share this row with the avatar. */}
        <ShellActions labeled onAction={onClose} className="contents" />
        <UserAvatar labeled />
      </footer>
    </aside>
  );
}

function SidebarLayoutBody({ className }: { className?: string }) {
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
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
  const overlayOpen = settingsOpen || libraryOpen || sessionsOpen || schedulesOpen;
  const isCreateAgent = shell != null && shellIsCreateAgent(shell.mode);
  // Build Agent, Sessions, and Schedules are desktop-only; keep the URL and show a notice.
  const showDesktopOnlyNotice =
    isMobile && (sessionsOpen || schedulesOpen || (isCreateAgent && !settingsOpen && !libraryOpen));
  const showAgentConfig = isCreateAgent && !overlayOpen && !isMobile;
  const hasChatHeaderContent = useChatHeaderContentVisible();
  // Agents / Settings own a page header — put the hamburger there instead of a second top bar.
  const inlineMobileNav = isMobile && (settingsOpen || libraryListOpen);
  const closeMobileNav = () => setMobileNavOpen(false);
  const handleSidebarCollapsedChange = useCallback((collapsed: boolean) => {
    setSidebarCollapsed(collapsed);
    writeSidebarCollapsed(collapsed);
  }, []);
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
      <SidebarRail
        className="hidden md:flex"
        collapsed={sidebarCollapsed}
        onCollapsedChange={handleSidebarCollapsedChange}
      />

      {/* Desktop: 0.5rem inset on top/right/bottom; flush to the sidebar on the left. */}
      <div className={cn('aui-shell-card-inset flex min-h-0 min-w-0 flex-1 flex-col', shellChromeBgClassName)}>
        <div
          className={cn(
            // Soft left-cast + ambient shadow so the pane reads raised above the rail.
            'relative z-[1] flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:rounded-2xl md:border md:border-border md:shadow-[-0.25rem_0_1.25rem_color-mix(in_oklab,var(--shadow-color)_7%,transparent),0_0.0625rem_0.375rem_color-mix(in_oklab,var(--shadow-color)_3.5%,transparent)]',
            shellSurfaceBgClassName,
          )}
        >
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

            <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', shellSurfaceBgClassName)}>
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
                ) : isIdle ? (
                  <SelectAgentEmptyState />
                ) : (
                  <Thread />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {mobileNavOpen ? (
        <>
          <button
            type="button"
            aria-label="Close navigation backdrop"
            className="aui-mobile-nav-backdrop absolute inset-0 z-[9] cursor-pointer bg-[var(--overlay)] md:hidden"
            onClick={closeMobileNav}
          />
          <MobileNavDrawer drawerRef={dialogRef} onClose={closeMobileNav} />
        </>
      ) : null}
    </div>
  );
}

export function SidebarLayout({ className }: { className?: string }) {
  return (
    <FilePreviewProvider>
      <SidebarLayoutBody className={className} />
    </FilePreviewProvider>
  );
}
