'use client';

import { lazy, Suspense, useCallback, useEffect, useMemo, type ReactNode } from 'react';

import { useTrackAnalytics } from '@/analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '@/analytics/events.js';

import { useDraftCatalog } from '@/atoms/draft/DraftCatalogProvider.js';
import { auiButtonClass } from '@/atoms/lib/buttonClasses.js';
import { cn } from '@/atoms/lib/cn.js';
import { useCompactLayout } from '@/atoms/lib/CompactLayoutContext.js';
import { isMobileNavDrawerOpen } from '@/atoms/lib/isMobileNavDrawerOpen.js';
import { useIsMobile } from '@/atoms/lib/useIsMobile.js';
import { PageHeader } from '@/atoms/PageHeader.js';
import { Spinner } from '@/atoms/primitives/Spinner.js';
import { Icon } from '@/icons/Icon.js';
import { useOptionalCatalogServer, useOptionalRefreshServerCapabilities } from '@/server/ServerContext.js';
import { useShellMode, type SettingsSection } from '@/server/ShellModeContext.js';

// Section modules (and their list/catalog APIs) load only when that tab mounts.
const ModelSettings = lazy(() => import('./ModelSettings.js'));
const ConnectorSettings = lazy(() => import('./ConnectorSettings.js'));
const SkillSettings = lazy(() => import('./SkillSettings.js'));
const SandboxSettings = lazy(() => import('./SandboxSettings.js'));
const WebSearchSettings = lazy(() => import('./WebSearchSettings.js'));

function SettingsSectionFallback() {
  return (
    <div className="flex flex-1 items-center justify-center py-8" role="status" aria-live="polite" aria-busy="true">
      <Spinner size={20} className="text-text-secondary" />
      <span className="sr-only">Loading</span>
    </div>
  );
}

const TruefoundrySettingsBuilder = ({ headerStart }: { headerStart?: ReactNode } = {}) => {
  const { settingsOpen, settingsSection: section, setSettingsOpen } = useShellMode();
  const catalog = useOptionalCatalogServer();
  const refreshServerCapabilities = useOptionalRefreshServerCapabilities();
  const track = useTrackAnalytics();
  const { refresh: refreshDraftCatalog } = useDraftCatalog();
  // dock/widget panels are ~mobile width even on a wide viewport — keep Settings stacked.
  // SidebarLayout mobile is not under CompactLayoutProvider, so treat it the same.
  const compactLayout = useCompactLayout();
  const isMobile = useIsMobile();
  const compact = compactLayout || isMobile;
  const hasSkills = catalog?.skillCatalog != null;
  const hasSandbox = catalog?.sandboxCatalog != null;
  const hasWebSearch = catalog?.webSearchCatalog != null;

  const closeSettings = useCallback(() => {
    track(AnalyticsEvents.Settings.CLOSED, { section });
    setSettingsOpen(false);
  }, [section, setSettingsOpen, track]);

  // Refresh catalogs whenever settings are closed or navigated away from.
  useEffect(() => {
    if (!settingsOpen) return;
    return () => {
      refreshDraftCatalog();
      refreshServerCapabilities?.();
    };
  }, [settingsOpen, refreshDraftCatalog, refreshServerCapabilities]);

  useEffect(() => {
    if (!hasSkills && section === 'skills') {
      setSettingsOpen(settingsOpen, 'models');
    }
    if (!hasSandbox && section === 'sandbox') {
      setSettingsOpen(settingsOpen, 'models');
    }
    if (!hasWebSearch && section === 'web-search') {
      setSettingsOpen(settingsOpen, 'models');
    }
  }, [hasSkills, hasSandbox, hasWebSearch, section, settingsOpen, setSettingsOpen]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Let the mobile nav drawer consume Escape when it is open on top.
      if (isMobileNavDrawerOpen()) return;
      event.stopImmediatePropagation();
      closeSettings();
    };
    // Capture so layout Escape handlers (sessions drawer / widget) do not also fire.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [closeSettings, settingsOpen]);

  const sections = useMemo<
    Array<{
      id: SettingsSection;
      label: string;
      icon: 'cpu' | 'plug' | 'lightbulb' | 'cube' | 'search';
    }>
  >(() => {
    const baseSections: Array<{
      id: SettingsSection;
      label: string;
      icon: 'cpu' | 'plug' | 'lightbulb' | 'cube' | 'search';
    }> = [
      { id: 'models', label: 'Models', icon: 'cpu' },
      { id: 'connectors', label: 'Connectors', icon: 'plug' },
    ];
    if (hasSkills) {
      baseSections.push({ id: 'skills', label: 'Skills', icon: 'lightbulb' });
    }
    if (hasSandbox) {
      baseSections.push({ id: 'sandbox', label: 'Sandbox providers', icon: 'cube' });
    }
    if (hasWebSearch) {
      baseSections.push({ id: 'web-search', label: 'Web search', icon: 'search' });
    }
    return baseSections;
  }, [hasSkills, hasSandbox, hasWebSearch]);

  if (!settingsOpen || !catalog) return null;

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-x-hidden bg-primary-bg">
      <PageHeader
        title="Settings"
        start={
          headerStart ?? (
            <button
              type="button"
              aria-label="Back"
              title="Back"
              className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
              onClick={closeSettings}
            >
              <Icon name="arrow-left" />
            </button>
          )
        }
      />

      <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', !compact && 'md:flex-row')}>
        <nav
          aria-label="Settings sections"
          className={cn(
            'flex w-full min-w-0 gap-1 border-b border-border bg-secondary-bg/40 p-2',
            compact
              ? 'overflow-x-auto'
              : 'justify-center md:w-48 md:flex-col md:justify-start md:border-b-0 md:border-r',
          )}
        >
          {sections.map(item => (
            <button
              key={item.id}
              type="button"
              aria-current={section === item.id ? 'page' : undefined}
              {...(compact ? { title: item.label } : {})}
              className={cn(
                'flex min-h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring',
                // Narrow panels cannot fit fixed-width tabs, so tabs split the row instead.
                compact ? 'min-w-0 flex-1 justify-center gap-1.5 px-1.5' : 'shrink-0',
                section === item.id
                  ? 'bg-primary-button-bg/10 text-primary-button-bg'
                  : 'text-text-secondary hover:bg-ghost-button-hover/60 hover:text-text-primary',
              )}
              onClick={() => {
                track(AnalyticsEvents.Settings.SECTION_CHANGED, { section: item.id });
                setSettingsOpen(true, item.id);
              }}
            >
              <Icon name={item.icon} className="h-4 w-4 shrink-0" />
              {compact ? <span className="truncate">{item.label}</span> : item.label}
            </button>
          ))}
        </nav>

        <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-hidden px-4 py-4 sm:px-6">
          <div className="mx-auto flex h-full min-h-0 w-full min-w-0 max-w-210 flex-col">
            <Suspense fallback={<SettingsSectionFallback />}>
              {section === 'models' ? <ModelSettings /> : null}
              {section === 'connectors' ? <ConnectorSettings /> : null}
              {section === 'skills' && hasSkills ? <SkillSettings /> : null}
              {section === 'sandbox' && hasSandbox ? <SandboxSettings /> : null}
              {section === 'web-search' && hasWebSearch ? <WebSearchSettings /> : null}
            </Suspense>
          </div>
        </section>
      </div>
    </div>
  );
};

export default TruefoundrySettingsBuilder;
