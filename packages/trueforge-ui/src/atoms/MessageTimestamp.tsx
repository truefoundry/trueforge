'use client';

import { cn } from './lib/cn.js';
import { LightTooltip } from './primitives/Tooltip.js';

function toDate(createdAt: Date | string | undefined): Date | null {
  if (createdAt == null) {
    return null;
  }
  const date = createdAt instanceof Date ? createdAt : new Date(createdAt);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(date);
}

function formatFullDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

export type MessageTimestampProps = {
  createdAt?: Date | string;
  className?: string;
};

export function MessageTimestamp({ createdAt, className }: MessageTimestampProps) {
  const date = toDate(createdAt);

  if (date == null) {
    return null;
  }

  return (
    <LightTooltip title={formatFullDate(date)} size="fit">
      <span className={cn('text-xs font-medium cursor-pointer leading-normal shrink-0 text-text-secondary', className)}>
        {formatTime(date)}
      </span>
    </LightTooltip>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    MessageTimestamp: typeof MessageTimestamp;
  }
}
