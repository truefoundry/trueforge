'use client';

import { Icon } from '../icons/Icon.js';
import { useOptionalCatalogServer, useServerCapabilities } from '../server/ServerContext.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';

export function ShellActions({ className }: { className?: string }) {
  const shell = useOptionalShellMode();
  const catalog = useOptionalCatalogServer();
  const capabilities = useServerCapabilities();
  const { mode, setTheme } = useTheme();
  const ActionSlot = useSlot('ShellActionsActionSlot');

  return (
    <div className={cn('flex shrink-0 items-center gap-1 text-text-primary', className)}>
      <button
        type="button"
        aria-label={mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        title={mode === 'dark' ? 'Light theme' : 'Dark theme'}
        className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
        onClick={() => setTheme(mode === 'dark' ? 'light' : 'dark')}
      >
        <Icon name={mode === 'dark' ? 'sun' : 'moon'} />
      </button>
      {shell != null && catalog != null && capabilities?.settings?.enabled !== false ? (
        <button
          type="button"
          aria-label="Settings"
          title="Settings"
          aria-expanded={shell.settingsOpen}
          className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
          onClick={() => shell.setSettingsOpen(true)}
        >
          <Icon name="settings" />
        </button>
      ) : null}
      <ActionSlot />
    </div>
  );
}
