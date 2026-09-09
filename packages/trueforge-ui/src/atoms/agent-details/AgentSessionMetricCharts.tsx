'use client';

import type { ReactNode } from 'react';

import type { SessionMetricBarDatum } from '../../utils/buildSessionMetrics.js';
import { LightTooltip } from '../primitives/Tooltip.js';

const MIN_VERTICAL_BAR_HEIGHT_PERCENT = 6;

export function SessionMetricTooltipContent({
  title,
  children,
  fitWidth = false,
}: {
  title: string;
  children: ReactNode;
  fitWidth?: boolean;
}) {
  return (
    <div
      className={
        fitWidth ? 'min-w-40 w-fit px-2 py-2 text-xs text-text-primary' : 'w-72 px-2 py-2 text-xs text-text-primary'
      }
    >
      <div className="mb-3 text-xs font-medium capitalize tracking-wider text-text-secondary">{title}</div>
      {children}
    </div>
  );
}

export function StackedProportionBar({
  data,
  formatValue,
}: {
  data: SessionMetricBarDatum[];
  formatValue: (value: number) => string;
}) {
  const visibleData = data.filter(item => item.value > 0);
  const total = visibleData.reduce((sum, item) => sum + item.value, 0);
  if (visibleData.length === 0) return null;

  return (
    <div>
      <div className="mb-3 flex h-3 w-full overflow-hidden rounded-full bg-secondary-bg">
        {visibleData.map(item => (
          <span
            key={item.label}
            className="h-full"
            style={{ width: `${(item.value / total) * 100}%`, backgroundColor: item.color }}
          />
        ))}
      </div>
      <div className="space-y-2">
        {visibleData.map(item => (
          <div key={item.label} className="flex items-center gap-2">
            <span className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: item.color }} />
            <span className="min-w-0 flex-1 truncate text-text-secondary">{item.label}</span>
            <span className="font-semibold text-text-primary">{formatValue(item.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HorizontalBarRows({
  data,
  formatValue,
}: {
  data: SessionMetricBarDatum[];
  formatValue: (value: number) => string;
}) {
  const maxValue = Math.max(0, ...data.map(item => item.value)) || 1;
  return (
    <div className="grid grid-cols-[max-content_minmax(0,1fr)_max-content] items-center gap-x-2 gap-y-2">
      {data.map(item => (
        <div key={item.label} className="contents">
          <span className="max-w-28 truncate text-text-secondary">{item.label}</span>
          <div className="h-1.5 min-w-0 overflow-hidden rounded-full bg-secondary-bg">
            <div
              className="h-full rounded-full"
              style={{ width: `${(item.value / maxValue) * 100}%`, backgroundColor: item.color }}
            />
          </div>
          <span className="text-right font-semibold text-text-primary">{formatValue(item.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function VerticalBarColumns({
  data,
  formatValue,
}: {
  data: SessionMetricBarDatum[];
  formatValue: (value: number) => string;
}) {
  const maxValue = Math.max(0, ...data.map(item => item.value)) || 1;
  return (
    <div className="h-24 overflow-x-auto">
      <div className="mx-auto flex h-full w-fit items-end">
        {data.map(item => (
          <LightTooltip key={item.label} title={formatValue(item.value)} side="top">
            <div className="flex h-full w-10 shrink-0 flex-col items-center justify-end gap-1">
              <div className="flex h-[4.5rem] items-end">
                <div
                  className="w-6 rounded-t-sm"
                  style={{
                    height: `${Math.max(MIN_VERTICAL_BAR_HEIGHT_PERCENT, (item.value / maxValue) * 100)}%`,
                    backgroundColor: item.color,
                  }}
                />
              </div>
              <span className="text-[0.625rem] leading-4 text-text-secondary">{item.label}</span>
            </div>
          </LightTooltip>
        ))}
      </div>
    </div>
  );
}
