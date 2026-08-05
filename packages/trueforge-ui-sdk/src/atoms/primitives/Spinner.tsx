import React from 'react';

import { cn } from '../lib/cn.js';

export type SpinnerProps = React.SVGProps<SVGSVGElement> & {
  size?: number;
};

export function Spinner({ size = 16, className, ...props }: SpinnerProps) {
  const r = (size / 2) * 0.75;
  const cx = size / 2;
  const circumference = 2 * Math.PI * r;

  return (
    <svg
      role="status"
      aria-label="Loading"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      className={cn('animate-spin', className)}
      {...props}
    >
      <circle
        cx={cx}
        cy={cx}
        r={r}
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`}
        opacity={0.8}
      />
    </svg>
  );
}
