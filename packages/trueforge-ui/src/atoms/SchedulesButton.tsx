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
    <div className={cn('relative min-w-0 w-full', className)}>
      <button
        type="button"
        aria-label={compact ? 'Schedules' : undefined}
        title={compact ? 'Schedules' : undefined}
        aria-current={open ? 'page' : undefined}
        className={auiButtonClass({
          variant: 'ghost',
          className: cn(
            'rounded-md text-sm font-medium text-text-primary shadow-none hover:bg-secondary-button-hover hover:text-ghost-button-text',
            compact
              ? 'h-auto w-full flex-col gap-0.5 whitespace-normal px-1 py-3 text-[0.625rem] leading-tight !justify-center'
              : 'h-8 w-full !justify-start px-2.5',
            open &&
              'bg-primary-button-bg text-primary-button-text hover:bg-primary-button-hover hover:text-primary-button-text',
          ),
        })}
        onClick={() => shell.setSchedulesOpen(!open)}
      >
        <Icon name="calendar-clock" size={compact ? 16 : undefined} />
        {compact ? (
          <span className="text-center">Schedules</span>
        ) : (
          <>
            <span className="truncate">Schedules</span>
            <Icon name="chevron-right" className="ml-auto size-3.5 shrink-0 opacity-60" />
          </>
        )}
      </button>
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    SchedulesButton: typeof SchedulesButton;
  }
}
