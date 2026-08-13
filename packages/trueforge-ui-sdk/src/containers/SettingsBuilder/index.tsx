'use client';

import { lazy, Suspense, useEffect, useMemo, useState } from 'react';

import { auiButtonClass } from '@/atoms/lib/buttonClasses.js';
import { cn } from '@/atoms/lib/cn.js';
import { useCompactLayout } from '@/atoms/lib/CompactLayoutContext.js';
import { Spinner } from '@/atoms/primitives/Spinner.js';
import { Icon } from '@/icons/Icon.js';
import { useOptionalCatalogServer } from '@/server/ServerContext.js';
import { useShellMode } from '@/server/ShellModeContext.js';

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

type SettingsSection = 'models' | 'connectors' | 'skills' | 'sandbox';

const TruefoundrySettingsBuilder = () => {
  const { settingsOpen, setSettingsOpen } = useShellMode();
  const catalog = useOptionalCatalogServer();
  // dock/widget panels are ~mobile width even on a wide viewport — keep Settings stacked.
  const compact = useCompactLayout();
  const [section, setSection] = useState<SettingsSection>('models');

  const hasSkills = catalog?.skillCatalog != null;
  const hasSandbox = catalog?.sandboxCatalog != null;

  useEffect(() => {
    if (!hasSkills && section === 'skills') {
      setSection('models');
    }
    if (!hasSandbox && section === 'sandbox') {
      setSection('models');
    }
  }, [hasSkills, hasSandbox, section]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopImmediatePropagation();
      setSettingsOpen(false);
    };
    // Capture so layout Escape handlers (sessions drawer / widget) do not also fire.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [settingsOpen, setSettingsOpen]);

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
        <button
          type="button"
          aria-label="Back"
          title="Back"
          className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
          onClick={() => setSettingsOpen(false)}
        >
          <Icon name="arrow-left" />
        </button>
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
                  ? 'bg-primary-button-bg text-primary-button-text'
                  : 'text-text-secondary hover:bg-ghost-button-hover/60 hover:text-text-primary',
              )}
              onClick={() => {
                setSection(item.id);
              }}
            >
              <Icon name={item.icon} className="h-4 w-4 shrink-0" />
              {compact ? <span className="truncate">{item.label}</span> : item.label}
            </button>
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
