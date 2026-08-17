import React from 'react';

import { cn } from '../lib/cn.js';

export type SkeletonProps = React.HTMLAttributes<HTMLDivElement>;

export function Skeleton({ className, ...props }: SkeletonProps) {
  return <div className={cn('animate-pulse rounded-md bg-secondary-bg', className)} {...props} />;
}
