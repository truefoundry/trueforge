'use client';

import { Icon } from '../icons/Icon.js';
import { useOptionalCatalogServer, useServerCapabilities } from '../server/ServerContext.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { isSettingsChromeEnabled } from '../server/settingsChrome.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';

export function ShellActions({ className, labeled = false }: { className?: string; labeled?: boolean }) {
  const shell = useOptionalShellMode();
  const catalog = useOptionalCatalogServer();
  const capabilities = useServerCapabilities();
  const { mode, setTheme } = useTheme();
  const ActionSlot = useSlot('ShellActionsActionSlot');
  const isDark = mode === 'dark';
  const themeLabel = isDark ? 'Light' : 'Dark';
  const settingsChromeEnabled = isSettingsChromeEnabled({ catalog, capabilities });

  const labeledButtonClass =
    'h-auto w-full flex-col gap-1.5 whitespace-normal px-1 py-3 text-[0.625rem] leading-tight !justify-center';
  const hoverClass = 'hover:bg-secondary-button-hover hover:text-ghost-button-text';

  return (
    <div
      className={cn(
        'flex shrink-0 items-center gap-1 text-text-primary',
        labeled && 'w-full flex-col gap-1',
        className,
      )}
    >
      <button
        type="button"
        aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
        title={isDark ? 'Light theme' : 'Dark theme'}
        className={auiButtonClass({
          variant: 'ghost',
          size: labeled ? undefined : 'icon',
          className: cn(hoverClass, labeled && labeledButtonClass),
        })}
        onClick={() => setTheme(isDark ? 'light' : 'dark')}
      >
        <Icon name={isDark ? 'sun' : 'moon'} size={labeled ? 16 : undefined} />
        {labeled ? <span className="text-center">{themeLabel}</span> : null}
      </button>
      {shell != null && settingsChromeEnabled ? (
        <button
          type="button"
          aria-label="Settings"
          title="Settings"
          aria-expanded={shell.settingsOpen}
          aria-current={shell.settingsOpen ? 'page' : undefined}
          className={auiButtonClass({
            variant: 'ghost',
            size: labeled ? undefined : 'icon',
            className: cn(
              hoverClass,
              labeled && labeledButtonClass,
              shell.settingsOpen &&
                'bg-primary-button-bg text-primary-button-text hover:bg-primary-button-hover hover:text-primary-button-text',
            ),
          })}
          onClick={() => shell.setSettingsOpen(true)}
        >
          <Icon name="settings" size={labeled ? 16 : undefined} />
          {labeled ? <span className="text-center">Settings</span> : null}
        </button>
      ) : null}
      <ActionSlot />
    </div>
  );
}
