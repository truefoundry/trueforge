'use client';

import { Icon } from '../icons/Icon.js';
import { useOptionalScheduleServer } from '../server/ServerContext.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';

export type SchedulesButtonProps = {
  className?: string;
  compact?: boolean;
};

export function SchedulesButton({ className, compact = false }: SchedulesButtonProps) {
  const shell = useOptionalShellMode();
  const scheduleServer = useOptionalScheduleServer();

  const enabled = scheduleServer != null && shell != null;
  const open = shell?.schedulesOpen === true;

  if (!enabled) return null;

  return (
    <div className={cn('relative min-w-0', compact ? 'w-8' : 'w-full', className)}>
      <button
        type="button"
        aria-label={compact ? 'Schedules' : undefined}
        title={compact ? 'Schedules' : undefined}
        aria-current={open ? 'page' : undefined}
        className={auiButtonClass({
          variant: 'ghost',
          className: cn(
            'h-8 rounded-md text-sm font-medium text-text-primary shadow-none hover:bg-ghost-button-hover hover:text-ghost-button-text',
            compact ? 'w-8 !justify-center p-0' : 'w-full !justify-start px-2.5',
            open && 'bg-dropdown-selected-item-bg text-dropdown-selected-item-text',
          ),
        })}
        onClick={() => shell.setSchedulesOpen(!open)}
      >
        <Icon name="calendar-clock" />
        {!compact ? (
          <>
            <span className="truncate">Schedules</span>
            <Icon name="chevron-right" className="ml-auto size-3.5 shrink-0 opacity-60" />
          </>
        ) : null}
      </button>
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    SchedulesButton: typeof SchedulesButton;
  }
}
