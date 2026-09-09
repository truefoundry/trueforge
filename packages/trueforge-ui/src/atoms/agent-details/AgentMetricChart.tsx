'use client';

import {
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from 'chart.js';
import { useMemo, type ComponentType } from 'react';
import { Line } from 'react-chartjs-2';

import { useThemeMode } from '../../theme/SlotsProvider.js';
import { formatCostUsd, formatDurationMs } from '../../utils/sessionDisplayFormat.js';
import type { AgentMetricChartProps } from './types.js';

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Legend, Tooltip);

const LIGHT_COLORS = ['#6366F1', '#2563eb', '#0EA5E9'];
const DARK_COLORS = ['#6366F1', '#60a5fa', '#38BDF8'];
const numberFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 });
const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function formatValue(value: number, unit: string): string {
  if (unit === '$') return formatCostUsd(value);
  if (unit === 'ms') return formatDurationMs(value);
  return `${numberFormatter.format(value)}${unit === 'count' || unit.length === 0 ? '' : ` ${unit}`}`;
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : timestampFormatter.format(date);
}

export function AgentMetricChart({ graph, definition, error, colorIndex = 0 }: AgentMetricChartProps) {
  const mode = useThemeMode();
  const colors = mode === 'dark' ? DARK_COLORS : LIGHT_COLORS;
  const axisColor = mode === 'dark' ? '#71717a' : '#a1a1aa';
  const gridColor = mode === 'dark' ? '#27272a' : '#e4e4e7';
  const labels = useMemo(
    () =>
      graph == null
        ? []
        : [...new Set(graph.graphLines.flatMap(line => line.values.map(point => point.timestamp)))].sort(),
    [graph],
  );
  const data = useMemo<ChartData<'line', Array<number | null>, string>>(
    () => ({
      labels: labels.map(formatTimestamp),
      datasets:
        graph?.graphLines.map((line, index) => {
          const valuesByTimestamp = new Map(line.values.map(point => [point.timestamp, point.value]));
          const color = colors[(colorIndex + index) % colors.length];
          return {
            label: line.name,
            data: labels.map(timestamp => valuesByTimestamp.get(timestamp) ?? null),
            borderColor: color,
            backgroundColor: color,
            pointRadius: 0,
            pointHoverRadius: 0,
            borderWidth: 2,
            borderCapStyle: 'butt',
            borderJoinStyle: 'miter',
            tension: 0,
            spanGaps: true,
          };
        }) ?? [],
    }),
    [colorIndex, colors, graph, labels],
  );
  const options = useMemo<ChartOptions<'line'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: {
          display: (graph?.graphLines.length ?? 0) > 1,
          labels: { color: axisColor, boxWidth: 10, boxHeight: 2 },
        },
        tooltip: {
          callbacks: {
            label: context => {
              const value = context.parsed.y;
              return `${context.dataset.label ?? ''}: ${value == null ? '—' : formatValue(value, graph?.unit ?? '')}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: gridColor },
          ticks: { color: axisColor, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
        },
        y: {
          beginAtZero: true,
          grid: { color: gridColor },
          border: { display: false },
          ticks: {
            color: axisColor,
            callback: value => formatValue(Number(value), graph?.unit ?? ''),
          },
        },
      },
    }),
    [axisColor, graph, gridColor],
  );
  const hasData = graph?.graphLines.some(line => line.values.length > 0) === true;

  return (
    <section className="min-w-0 rounded-lg border border-border bg-card-bg p-4" data-slot="agent-metric-chart">
      <h3 className="text-sm font-semibold text-text-primary">{graph?.displayName ?? definition.displayName}</h3>
      <p className="mt-1 text-xs text-text-secondary">{graph?.description ?? definition.description}</p>
      <div className="mt-4 h-64">
        {error != null ? (
          <div className="flex h-full items-center justify-center text-sm text-failure-bg">{error}</div>
        ) : hasData ? (
          <Line data={data} options={options} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-text-secondary">No data</div>
        )}
      </div>
    </section>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentMetricChart: ComponentType<AgentMetricChartProps>;
  }
}
