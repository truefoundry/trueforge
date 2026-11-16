'use client';

import type { ReactElement } from 'react';

import { useTrackAnalytics } from '../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../analytics/events.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalCatalogServer, useServerCapabilities } from '../server/ServerContext.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { isSettingsChromeEnabled } from '../server/serverChrome.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { auiButtonClass, shellRailSelectedClassName, sidebarRailButtonClassName } from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';
import { RailTooltip } from './primitives/Tooltip.js';

export function ShellActions({
  className,
  labeled = false,
  iconOnly = false,
  onAction,
}: {
  className?: string;
  labeled?: boolean;
  /** Desktop app rail: 36×36 icon buttons, no captions. */
  iconOnly?: boolean;
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
  const showLabels = labeled && !iconOnly;
  const railClass = iconOnly ? sidebarRailButtonClassName : null;
  const iconSize = iconOnly ? 16 : showLabels ? 14 : undefined;
  const wrapRail = (label: string, control: ReactElement) =>
    iconOnly ? <RailTooltip content={label}>{control}</RailTooltip> : control;

  return (
    <div
      className={cn(
        'flex shrink-0 items-center gap-1',
        iconOnly
          ? 'w-full flex-col items-center gap-2'
          : labeled
            ? 'w-full flex-col items-center gap-1 text-sidebar-text'
            : 'text-text-primary',
        className,
      )}
    >
      {wrapRail(
        'Docs',
        <a
          href="https://trueforge.dev"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Documentation"
          title={iconOnly ? undefined : 'Documentation'}
          className={auiButtonClass({
            variant: 'ghost',
            size: showLabels ? undefined : 'icon',
            className: cn(
              hoverClass,
              railClass,
              showLabels &&
                'h-auto flex-col gap-0.5 px-1 py-1 text-[0.625rem] font-normal leading-tight',
            ),
          })}
          onClick={() => onAction?.()}
        >
          <Icon name="book-open" size={iconSize} />
          {showLabels ? <span className="text-center">Docs</span> : null}
        </a>,
      )}
      {wrapRail(
        themeLabel,
        <button
          type="button"
          aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
          title={iconOnly ? undefined : isDark ? 'Light theme' : 'Dark theme'}
          className={auiButtonClass({
            variant: 'ghost',
            size: showLabels ? undefined : 'icon',
            className: cn(
              hoverClass,
              railClass,
              showLabels &&
                'h-auto flex-col gap-0.5 px-1 py-1 text-[0.625rem] font-normal leading-tight',
            ),
          })}
          onClick={() => {
            setTheme(isDark ? 'light' : 'dark');
            onAction?.();
          }}
        >
          <Icon name={isDark ? 'sun' : 'moon'} size={iconSize} />
          {showLabels ? <span className="text-center">{themeLabel}</span> : null}
        </button>,
      )}
      {shell != null && settingsChromeEnabled
        ? wrapRail(
            'Settings',
            <button
              type="button"
              aria-label="Settings"
              title={iconOnly ? undefined : 'Settings'}
              aria-expanded={shell.settingsOpen}
              aria-current={shell.settingsOpen ? 'page' : undefined}
              className={auiButtonClass({
                variant: 'ghost',
                size: showLabels ? undefined : 'icon',
                className: cn(
                  hoverClass,
                  railClass,
                  showLabels &&
                    'h-auto flex-col gap-0.5 px-1 py-1 text-[0.625rem] font-normal leading-tight',
                  shell.settingsOpen && shellRailSelectedClassName,
                ),
              })}
              onClick={() => {
                if (!shell.settingsOpen) track(AnalyticsEvents.Settings.OPENED);
                shell.setSettingsOpen(true);
                onAction?.();
              }}
            >
              <Icon name="settings" size={iconSize} />
              {showLabels ? <span className="text-center">Settings</span> : null}
            </button>,
          )
        : null}
      <ActionSlot />
    </div>
  );
}
