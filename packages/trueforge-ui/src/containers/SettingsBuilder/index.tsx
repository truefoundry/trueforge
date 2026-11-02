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
import { isSettingsSectionEnabled } from '@/server/serverChrome.js';
import {
  useOptionalCatalogServer,
  useOptionalConfigurationServer,
  useOptionalRefreshServerCapabilities,
  useServerCapabilities,
} from '@/server/ServerContext.js';
import { useShellMode, type SettingsSection } from '@/server/ShellModeContext.js';
import type { SettingsCapability } from '@/server/types.js';

// Section modules (and their list/catalog APIs) load only when that tab mounts.
const ModelSettings = lazy(() => import('./ModelSettings.js'));
const ConnectorSettings = lazy(() => import('./ConnectorSettings.js'));
const SkillSettings = lazy(() => import('./SkillSettings.js'));
const SandboxSettings = lazy(() => import('./SandboxSettings.js'));
const WebSearchSettings = lazy(() => import('./WebSearchSettings.js'));

type SettingsSectionItem = {
  id: SettingsSection;
  label: string;
  icon: 'cpu' | 'plug' | 'lightbulb' | 'cube' | 'search';
  capability: keyof SettingsCapability;
};

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
  const configuration = useOptionalConfigurationServer();
  const settings = useServerCapabilities()?.settings;
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
  // The tab also hosts the tenant switch, so a catalog with no web-search provider
  // list still shows it whenever the host wires the configuration port.
  const hasWebSearch = catalog?.webSearchCatalog != null || configuration != null;

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

  const sections = useMemo<SettingsSectionItem[]>(() => {
    const mounted: SettingsSectionItem[] = [
      { id: 'models', label: 'Models', icon: 'cpu', capability: 'modelProviders' },
      { id: 'connectors', label: 'Connectors', icon: 'plug', capability: 'mcpServers' },
    ];
    if (hasSkills) {
      mounted.push({ id: 'skills', label: 'Skills', icon: 'lightbulb', capability: 'skills' });
    }
    if (hasSandbox) {
      mounted.push({ id: 'sandbox', label: 'Sandbox providers', icon: 'cube', capability: 'sandboxProviders' });
    }
    if (hasWebSearch) {
      mounted.push({ id: 'web-search', label: 'Web search', icon: 'search', capability: 'webSearch' });
    }
    return mounted.filter(item => isSettingsSectionEnabled({ settings, section: item.capability }));
  }, [hasSkills, hasSandbox, hasWebSearch, settings]);

  // A section the caller may not open (or the host never mounted) hands over to the first it may.
  const activeSection = sections.find(item => item.id === section);
  useEffect(() => {
    const fallback = sections[0];
    if (activeSection !== undefined || fallback === undefined) return;
    setSettingsOpen(settingsOpen, fallback.id);
  }, [activeSection, sections, settingsOpen, setSettingsOpen]);

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
              {activeSection?.id === 'models' ? <ModelSettings /> : null}
              {activeSection?.id === 'connectors' ? <ConnectorSettings /> : null}
              {activeSection?.id === 'skills' ? <SkillSettings /> : null}
              {activeSection?.id === 'sandbox' ? <SandboxSettings /> : null}
              {activeSection?.id === 'web-search' ? <WebSearchSettings /> : null}
            </Suspense>
          </div>
        </section>
      </div>
    </div>
  );
};

export default TruefoundrySettingsBuilder;
