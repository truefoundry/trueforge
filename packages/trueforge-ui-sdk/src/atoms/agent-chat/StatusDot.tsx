import { cn } from '../lib/cn.js';

export type StatusDotProps = {
  className?: string;
  colorClassName?: string;
};

export function StatusDot({ className, colorClassName = 'bg-warning-bg' }: StatusDotProps) {
  return (
    <span aria-hidden className={cn('relative inline-flex h-2 w-2 shrink-0', className)}>
      <span
        className={cn(
          'pointer-events-none absolute inline-flex h-full w-full rounded-full opacity-75 motion-safe:animate-ping motion-reduce:animate-none',
          colorClassName,
        )}
      />
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', colorClassName)} />
    </span>
  );
}
