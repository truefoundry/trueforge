'use client';

import { useTrackAnalytics } from '../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../analytics/events.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalScheduleServer } from '../server/ServerContext.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { isSchedulesChromeEnabled } from '../server/serverChrome.js';
import {
  auiButtonClass,
  shellHoverClassName,
  shellNavSelectedClassName,
  shellRailSelectedClassName,
  sidebarButtonRadiusClassName,
  sidebarCompactNavButtonClassName,
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
          'font-normal shadow-none',
          compact
            ? sidebarCompactNavButtonClassName
            : cn(
                sidebarButtonRadiusClassName,
                'h-8 w-full !justify-start px-2.5 text-sm text-sidebar-text',
                shellHoverClassName,
              ),
          open && (compact ? shellRailSelectedClassName : shellNavSelectedClassName),
        ),
      })}
      onClick={() => {
        if (!open) track(AnalyticsEvents.Schedule.PAGE_OPENED);
        shell.setSchedulesOpen(!open);
      }}
    >
      <Icon name="clock-7" />
      {compact ? null : <span className="truncate">Schedules</span>}
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
