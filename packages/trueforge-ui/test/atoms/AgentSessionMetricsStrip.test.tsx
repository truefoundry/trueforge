// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CostBreakdownRows } from '@/atoms/agent-details/AgentSessionMetricCharts.js';
import { AgentSessionMetricsStrip } from '@/atoms/agent-details/AgentSessionMetricsStrip.js';
import type { SessionMetrics } from '@/utils/buildSessionMetrics.js';

const metrics: SessionMetrics = {
  totalTurns: 7,
  wallTimeMs: 188_000,
  totalCostUsd: 2.6229,
  totalTokens: 280_000,
  contextTokens: 280_000,
  toolCalls: 9,
  subAgents: 0,
  errors: 0,
  timeBreakdown: [
    { label: 'model', value: 80_000, color: '#3b82f6' },
    { label: 'tools', value: 20_000, color: '#f59e0b' },
    { label: 'waiting on human', value: 0, color: '#f472b6' },
    { label: 'overhead', value: 20_000, color: '#94a3b8' },
  ],
  costPerTurn: [
    { label: 'T1', value: 2, color: '#f59e0b' },
    { label: 'T2', value: 0.6, color: '#f59e0b' },
  ],
  tokenBreakdown: [
    { label: 'input', value: 200_000, color: '#3b82f6' },
    { label: 'output', value: 80_000, color: '#34d399' },
    { label: 'cached', value: 0, color: '#c084fc' },
  ],
  contextByTurn: [
    { label: 'T1', value: 200_000, color: '#3b82f6' },
    { label: 'T2', value: 280_000, color: '#3b82f6' },
  ],
  toolCallFrequency: [{ label: 'search', value: 9, color: '#f59e0b' }],
};

describe('AgentSessionMetricsStrip', () => {
  it('renders the session metric tiles', () => {
    render(<AgentSessionMetricsStrip metrics={metrics} />);
    expect(screen.getByText('Turns')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('3m 8s')).toBeInTheDocument();
    expect(screen.getByText('Cost')).toBeInTheDocument();
    expect(screen.getByText('$2.6229')).toBeInTheDocument();
    expect(screen.getByText('Tokens')).toBeInTheDocument();
    expect(screen.getByText('Tool calls')).toBeInTheDocument();
    expect(screen.getByText('Sub-agents')).toBeInTheDocument();
    expect(screen.getByText('Errors')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="agent-session-metrics-strip"]')).toHaveClass('@container');
    expect(document.querySelector('[data-slot="agent-session-metrics-strip"]')).not.toHaveClass('rounded-md');
    expect(document.querySelector('[data-slot="agent-session-metrics-strip"] > div')).toHaveClass(
      'grid-cols-3',
      '@min-[24rem]:grid-cols-4',
      '@min-[48rem]:grid-cols-8',
    );
    expect(document.querySelector('[data-slot="session-metric-wall-time"]')).toHaveClass('w-full');
  });

  it('omits the cost tile when cost is unavailable', () => {
    const { totalCostUsd, ...metricsWithoutCost } = metrics;
    void totalCostUsd;

    render(<AgentSessionMetricsStrip metrics={metricsWithoutCost} />);
    expect(screen.queryByText('Cost')).not.toBeInTheDocument();
    expect(document.querySelector('[data-slot="agent-session-metrics-strip"] > div')).toHaveClass(
      '@min-[48rem]:grid-cols-7',
    );
  });

  it.each(['wall-time', 'cost', 'tokens', 'context', 'tool-calls'] as const)(
    'renders the %s tooltip with interactive pointer-events when hovered',
    tileId => {
      render(<AgentSessionMetricsStrip metrics={metrics} />);
      const tile = document.querySelector(`[data-slot="session-metric-${tileId}"]`);
      expect(tile).not.toBeNull();
      fireEvent.mouseEnter(tile!);
      const tooltip = document.querySelector('[role="tooltip"]');
      expect(tooltip).not.toBeNull();
      expect(tooltip!.className).toMatch(/pointer-events-auto/);
    },
  );

  it('shows lineage / session total with explanation when session total exceeds lineage', () => {
    render(<AgentSessionMetricsStrip metrics={{ ...metrics, totalTurns: 2, sessionTotalTurns: 4 }} />);
    const turnsTile = document.querySelector('[data-slot="session-metric-turns"]');
    expect(turnsTile).not.toBeNull();
    expect(turnsTile).toHaveTextContent('2');
    expect(turnsTile).toHaveTextContent('/ 4');
    expect(screen.getByTestId('icon-circle-exclamation')).toBeInTheDocument();
    expect(screen.queryByText('7')).not.toBeInTheDocument();

    fireEvent.mouseEnter(turnsTile!);
    const tooltip = document.querySelector('[role="tooltip"]');
    expect(tooltip).not.toBeNull();
    expect(tooltip).toHaveTextContent(
      'Some turns in this session were edited or retried. Showing only the latest lineage of the session',
    );
  });

  it('omits lineage split and warning when session total matches lineage', () => {
    render(<AgentSessionMetricsStrip metrics={{ ...metrics, totalTurns: 2, sessionTotalTurns: undefined }} />);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.queryByText('/ 2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('icon-circle-exclamation')).not.toBeInTheDocument();
  });
});

describe('CostBreakdownRows', () => {
  it('renders a row for each datum with label and formatted cost', () => {
    render(
      <CostBreakdownRows
        data={[
          { label: 'T1', value: 2, color: '#f59e0b' },
          { label: 'T2', value: 0.6, color: '#f59e0b' },
        ]}
      />,
    );

    expect(screen.getByText('T1')).toBeInTheDocument();
    expect(screen.getByText('T2')).toBeInTheDocument();
    expect(screen.getByText('$2.0000')).toBeInTheDocument();
    expect(screen.getByText('$0.6000')).toBeInTheDocument();
  });

  it('renders nothing for an empty dataset', () => {
    const { container } = render(<CostBreakdownRows data={[]} />);
    expect(container.firstChild).toBeEmptyDOMElement();
  });
});
