'use client';

import { Icon } from '../icons/Icon.js';
import { useOptionalCatalogServer } from '../server/ServerContext.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';

export function ShellActions({ className }: { className?: string }) {
  const shell = useOptionalShellMode();
  const catalog = useOptionalCatalogServer();
  const { mode, setTheme } = useTheme();

  return (
    <div className={cn('flex shrink-0 items-center gap-1 text-foreground', className)}>
      <button
        type="button"
        aria-label={mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        title={mode === 'dark' ? 'Light theme' : 'Dark theme'}
        className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
        onClick={() => setTheme(mode === 'dark' ? 'light' : 'dark')}
      >
        <Icon name={mode === 'dark' ? 'sun' : 'moon'} />
      </button>
      {shell != null && catalog != null ? (
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
    </div>
  );
}
