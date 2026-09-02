'use client';

import { Icon } from '../icons/Icon.js';
import { useOptionalCatalogServer, useServerCapabilities } from '../server/ServerContext.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { cn } from './lib/cn.js';
import { Button } from './primitives/Button.js';

export function ShellActions({ className }: { className?: string }) {
  const shell = useOptionalShellMode();
  const catalog = useOptionalCatalogServer();
  const capabilities = useServerCapabilities();
  const { mode, setTheme } = useTheme();
  const ActionSlot = useSlot('ShellActionsActionSlot');

  return (
    <div className={cn('flex shrink-0 items-center gap-1 text-text-primary', className)}>
      <Button.Ghost
        type="button"
        aria-label={mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        title={mode === 'dark' ? 'Light theme' : 'Dark theme'}
        size="small"
        className="aspect-square px-0"
        onClick={() => setTheme(mode === 'dark' ? 'light' : 'dark')}
      >
        <Icon name={mode === 'dark' ? 'sun' : 'moon'} />
      </Button.Ghost>
      {shell != null && catalog != null && capabilities?.settings?.enabled !== false ? (
        <Button.Ghost
          type="button"
          aria-label="Settings"
          title="Settings"
          aria-expanded={shell.settingsOpen}
          size="small"
          className="aspect-square px-0"
          onClick={() => shell.setSettingsOpen(true)}
        >
          <Icon name="settings" />
        </Button.Ghost>
      ) : null}
      <ActionSlot />
    </div>
  );
}
