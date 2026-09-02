'use client';

import { lazy, Suspense, useCallback, useEffect, useMemo } from 'react';

import { useDraftCatalog } from '@/atoms/draft/DraftCatalogProvider.js';
import { cn } from '@/atoms/lib/cn.js';
import { useCompactLayout } from '@/atoms/lib/CompactLayoutContext.js';
import { Button } from '@/atoms/primitives/Button.js';
import { Spinner } from '@/atoms/primitives/Spinner.js';
import { Icon } from '@/icons/Icon.js';
import { useOptionalCatalogServer, useOptionalRefreshServerCapabilities } from '@/server/ServerContext.js';
import { useShellMode, type SettingsSection } from '@/server/ShellModeContext.js';

// Section modules (and their list/catalog APIs) load only when that tab mounts.
const ModelSettings = lazy(() => import('./ModelSettings.js'));
const ConnectorSettings = lazy(() => import('./ConnectorSettings.js'));
const SkillSettings = lazy(() => import('./SkillSettings.js'));
const SandboxSettings = lazy(() => import('./SandboxSettings.js'));

function SettingsSectionFallback() {
  return (
    <div className="flex flex-1 items-center justify-center py-8" role="status" aria-live="polite" aria-busy="true">
      <Spinner size={20} className="text-text-secondary" />
      <span className="sr-only">Loading</span>
    </div>
  );
}

const TruefoundrySettingsBuilder = () => {
  const { settingsOpen, settingsSection: section, setSettingsOpen } = useShellMode();
  const catalog = useOptionalCatalogServer();
  const refreshServerCapabilities = useOptionalRefreshServerCapabilities();
  const { refresh: refreshDraftCatalog } = useDraftCatalog();
  // dock/widget panels are ~mobile width even on a wide viewport — keep Settings stacked.
  const compact = useCompactLayout();
  const hasSkills = catalog?.skillCatalog != null;
  const hasSandbox = catalog?.sandboxCatalog != null;

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
  }, [setSettingsOpen]);

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
  }, [hasSkills, hasSandbox, section, settingsOpen, setSettingsOpen]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
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
      icon: 'cpu' | 'plug' | 'lightbulb' | 'cube';
    }>
  >(() => {
    const baseSections: Array<{
      id: SettingsSection;
      label: string;
      icon: 'cpu' | 'plug' | 'lightbulb' | 'cube';
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
    return baseSections;
  }, [hasSkills, hasSandbox]);

  if (!settingsOpen || !catalog) return null;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-primary-bg">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
        <Button.Ghost
          type="button"
          aria-label="Back"
          title="Back"
          size="small"
          className="aspect-square px-0"
          onClick={closeSettings}
        >
          <Icon name="arrow-left" />
        </Button.Ghost>
        <h1 className="text-lg font-semibold tracking-tight text-text-primary">Settings</h1>
      </header>

      <div className={cn('flex min-h-0 flex-1 flex-col', !compact && 'md:flex-row')}>
        <nav
          aria-label="Settings sections"
          className={cn(
            'flex w-full gap-1 border-b border-border bg-secondary-bg/40 p-2',
            compact ? 'min-w-0' : 'justify-center md:w-48 md:flex-col md:justify-start md:border-b-0 md:border-r',
          )}
        >
          {sections.map(item => (
            <Button.Ghost
              key={item.id}
              type="button"
              aria-current={section === item.id ? 'page' : undefined}
              {...(compact ? { title: item.label } : {})}
              className={cn(
                'min-h-9 h-auto justify-normal items-center gap-2 px-3 text-sm shadow-none',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring',
                // Narrow panels cannot fit fixed-width tabs, so tabs split the row instead.
                compact ? 'min-w-0 flex-1 justify-center gap-1.5 px-1.5' : 'shrink-0',
                section === item.id
                  ? 'bg-primary-button-bg text-primary-button-text hover:bg-primary-button-bg'
                  : 'text-text-secondary hover:bg-ghost-button-hover/60 hover:text-text-primary',
              )}
              onClick={() => {
                setSettingsOpen(true, item.id);
              }}
            >
              <Icon name={item.icon} className="h-4 w-4 shrink-0" />
              {compact ? <span className="truncate">{item.label}</span> : item.label}
            </Button.Ghost>
          ))}
        </nav>

        <section className="flex flex-col h-full flex-1 overflow-y-hidden px-6 py-4">
          <div className="w-full max-w-210 h-full min-h-0 flex flex-col mx-auto">
            <Suspense fallback={<SettingsSectionFallback />}>
              {section === 'models' ? <ModelSettings /> : null}
              {section === 'connectors' ? <ConnectorSettings /> : null}
              {section === 'skills' && hasSkills ? <SkillSettings /> : null}
              {section === 'sandbox' && hasSandbox ? <SandboxSettings /> : null}
            </Suspense>
          </div>
        </section>
      </div>
    </div>
  );
};

export default TruefoundrySettingsBuilder;
