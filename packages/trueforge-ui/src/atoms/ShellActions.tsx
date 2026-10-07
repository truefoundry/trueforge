'use client';

import { useTrackAnalytics } from '../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../analytics/events.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalCatalogServer, useServerCapabilities } from '../server/ServerContext.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { isSettingsChromeEnabled } from '../server/serverChrome.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { auiButtonClass, sidebarRailButtonClassName } from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';

export function ShellActions({
  className,
  labeled = false,
  onAction,
}: {
  className?: string;
  labeled?: boolean;
  /** Fired after Docs, theme, or Settings is activated — e.g. close a mobile drawer. */
  onAction?: () => void;
}) {
  const shell = useOptionalShellMode();
  const track = useTrackAnalytics();
  const catalog = useOptionalCatalogServer();
  const capabilities = useServerCapabilities();
  const { mode, setTheme } = useTheme();
  const ActionSlot = useSlot('ShellActionsActionSlot');
  const isDark = mode === 'dark';
  const themeLabel = isDark ? 'Light' : 'Dark';
  const settingsChromeEnabled = isSettingsChromeEnabled({ catalog, capabilities });

  const hoverClass = 'hover:bg-secondary-button-hover hover:text-ghost-button-text';

  return (
    <div
      className={cn(
        'flex shrink-0 items-center gap-1',
        labeled ? 'w-full flex-col items-center gap-1 text-sidebar-text' : 'text-text-primary',
        className,
      )}
    >
      <a
        href="https://trueforge.dev"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Documentation"
        title="Documentation"
        className={auiButtonClass({
          variant: 'ghost',
          size: labeled ? undefined : 'icon',
          className: cn(hoverClass, labeled && sidebarRailButtonClassName),
        })}
        onClick={() => onAction?.()}
      >
        <Icon name="book-open" size={labeled ? 14 : undefined} />
        {labeled ? <span className="text-center">Docs</span> : null}
      </a>
      <button
        type="button"
        aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
        title={isDark ? 'Light theme' : 'Dark theme'}
        className={auiButtonClass({
          variant: 'ghost',
          size: labeled ? undefined : 'icon',
          className: cn(hoverClass, labeled && sidebarRailButtonClassName),
        })}
        onClick={() => {
          setTheme(isDark ? 'light' : 'dark');
          onAction?.();
        }}
      >
        <Icon name={isDark ? 'sun' : 'moon'} size={labeled ? 14 : undefined} />
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
              labeled && sidebarRailButtonClassName,
              shell.settingsOpen &&
                'bg-primary-button-bg font-medium text-primary-button-text hover:bg-primary-button-hover hover:text-primary-button-text',
            ),
          })}
          onClick={() => {
            if (!shell.settingsOpen) track(AnalyticsEvents.Settings.OPENED);
            shell.setSettingsOpen(true);
            onAction?.();
          }}
        >
          <Icon name="settings" size={labeled ? 14 : undefined} />
          {labeled ? <span className="text-center">Settings</span> : null}
        </button>
      ) : null}
      <ActionSlot />
    </div>
  );
}
