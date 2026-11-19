import { cn } from '../lib/cn.js';

export type StatusDotProps = {
  className?: string;
  colorClassName?: string;
  /** When true (default), show the ping halo used for live/needs-attention states. */
  pulse?: boolean;
};

export function StatusDot({ className, colorClassName = 'bg-warning-bg', pulse = true }: StatusDotProps) {
  return (
    <span aria-hidden className={cn('relative inline-flex size-2 shrink-0', className)}>
      {pulse ? (
        <span
          className={cn(
            'pointer-events-none absolute inline-flex size-full rounded-full opacity-75 motion-safe:animate-ping motion-reduce:animate-none',
            colorClassName,
          )}
        />
      ) : null}
      <span className={cn('relative inline-flex size-full rounded-full', colorClassName)} />
    </span>
  );
}
