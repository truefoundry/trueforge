import { cn } from './lib/cn.js';
import { Skeleton } from './primitives/Skeleton.js';

export type MessageListSkeletonProps = {
  className?: string;
};

export function MessageListSkeleton({ className }: MessageListSkeletonProps) {
  return (
    <div
      role="status"
      aria-label="Loading conversation"
      data-slot="aui_thread-history-skeleton"
      className={cn('mb-14 flex flex-col gap-y-6', className)}
    >
      <div className="flex justify-end">
        <Skeleton className="h-10 w-[min(85%,20rem)] rounded-xl" />
      </div>
      <div className="flex flex-col gap-2 px-2">
        <Skeleton className="h-4 w-full max-w-md" />
        <Skeleton className="h-4 w-full max-w-sm" />
        <Skeleton className="h-4 w-2/3 max-w-xs" />
      </div>
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    MessageListSkeleton: typeof MessageListSkeleton;
  }
}
