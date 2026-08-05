'use client';

import { useEffect, useMemo, useState } from 'react';

import { cn } from '@/atoms/lib/cn.js';
import { CenteredModal } from '@/atoms/primitives/CenteredModal.js';
import { Icon } from '@/icons/Icon.js';
import { useOptionalCatalogServer } from '@/server/ServerContext.js';
import { useShellMode } from '@/server/ShellModeContext.js';
import ConnectorSettings from './ConnectorSettings.js';
import ModelSettings from './ModelSettings.js';
import SandboxSettings from './SandboxSettings.js';
import SkillSettings from './SkillSettings.js';

type SettingsSection = 'models' | 'connectors' | 'skills' | 'sandbox';

const TruefoundrySettingsBuilder = () => {
  const { settingsOpen, setSettingsOpen } = useShellMode();
  const catalog = useOptionalCatalogServer();
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
      baseSections.push({ id: 'sandbox', label: 'Sandbox', icon: 'cube' });
    }
    return baseSections;
  }, [hasSkills, hasSandbox]);

  if (!catalog) return null;

  return (
    <CenteredModal open={settingsOpen} onOpenChange={setSettingsOpen} title="Settings" className="md:max-w-6xl">
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav
          aria-label="Settings sections"
          className="flex w-full justify-center gap-1 border-r border-border bg-muted/30 p-2 md:w-48 md:flex-col md:justify-start"
        >
          {sections.map(item => (
            <button
              key={item.id}
              type="button"
              aria-current={section === item.id ? 'page' : undefined}
              className={cn(
                'flex min-h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                section === item.id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
              onClick={() => {
                setSection(item.id);
              }}
            >
              <Icon name={item.icon} className="h-4 w-4" />
              {item.label}
            </button>
          ))}
        </nav>

        <section className="flex h-full flex-1 flex-col overflow-y-hidden px-6 py-4">
          {section === 'models' && <ModelSettings />}
          {section === 'connectors' && <ConnectorSettings />}
          {section === 'skills' && hasSkills ? <SkillSettings /> : null}
          {section === 'sandbox' && hasSandbox ? <SandboxSettings /> : null}
        </section>
      </div>
    </CenteredModal>
  );
};

export default TruefoundrySettingsBuilder;
