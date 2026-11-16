'use client';

import { useTrackAnalytics } from '../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../analytics/events.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalScheduleServer } from '../server/ServerContext.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { isSchedulesChromeEnabled } from '../server/serverChrome.js';
import {
  auiButtonClass,
  shellRailSelectedClassName,
  sidebarButtonRadiusClassName,
  sidebarRailButtonClassName,
} from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';
import { RailTooltip } from './primitives/Tooltip.js';

export type SchedulesButtonProps = {
  className?: string;
  compact?: boolean;
};

export function SchedulesButton({ className, compact = false }: SchedulesButtonProps) {
  const shell = useOptionalShellMode();
  const scheduleServer = useOptionalScheduleServer();
  const track = useTrackAnalytics();

  const enabled = isSchedulesChromeEnabled({ schedules: scheduleServer }) && shell != null;
  const open = shell?.schedulesOpen === true;

  if (!enabled) return null;

  const button = (
    <button
      type="button"
      aria-label={compact ? 'Schedules' : undefined}
      aria-current={open ? 'page' : undefined}
      className={auiButtonClass({
        variant: 'ghost',
        className: cn(
          'font-normal shadow-none hover:bg-secondary-button-hover hover:text-ghost-button-text',
          compact
            ? cn(sidebarRailButtonClassName, 'text-inherit')
            : cn(
                sidebarButtonRadiusClassName,
                'h-8 w-full !justify-start px-2.5 text-sm text-sidebar-text',
              ),
          open && shellRailSelectedClassName,
        ),
      })}
      onClick={() => {
        if (!open) track(AnalyticsEvents.Schedule.PAGE_OPENED);
        shell.setSchedulesOpen(!open);
      }}
    >
      <Icon name="clock-7" size={compact ? 16 : undefined} />
      {compact ? null : (
        <>
          <span className="truncate">Schedules</span>
          <Icon name="chevron-right" className="ml-auto size-3.5 shrink-0 opacity-60" />
        </>
      )}
    </button>
  );

  return (
    <div className={cn('relative min-w-0', compact ? 'flex justify-center' : 'w-full', className)}>
      {compact ? <RailTooltip content="Schedules">{button}</RailTooltip> : button}
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    SchedulesButton: typeof SchedulesButton;
  }
}
