// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AgentSessionMetricsStrip } from '@/atoms/agent-details/AgentSessionMetricsStrip.js';
import type { SessionMetrics } from '@/utils/buildSessionMetrics.js';

const metrics: SessionMetrics = {
  totalTurns: 7,
  wallTimeMs: 120_000,
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
});
