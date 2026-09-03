import type { ReactNode } from 'react';
import type {
  AgentDetail,
  AgentMetricChartDefinition,
  AgentMetricGraph,
  AgentMetricMeter,
  CodeSnippet,
} from '../../server/types.js';
import type { SessionMetrics } from '../../utils/buildSessionMetrics.js';
import type { SessionEventTimelineSegment, SessionEventType } from '../../utils/sessionEventTimeline.js';
import type { LibraryAgentTab, SessionTimeRange } from '../../utils/sessionShareUrl.js';
import type { SessionTurnView } from '../../utils/sessionTurnViews.js';

export type AgentSessionsProps = {
  /** Library tab locks the list to this agent. Omit on the all-user Sessions page. */
  agentId?: string;
  startTimestamp?: string;
  endTimestamp?: string;
  /** When `sessions`, selection writes `view=sessions` and pins `s_sts`/`s_ets`. */
  shareView?: 'sessions' | null;
};

export type AgentSessionListRowProps = {
  title: string;
  agentName?: string;
  lastActivityAt: string;
  metrics: {
    totalTurns: number;
    totalCostInUsd: number;
    totalDurationMs: number;
  };
  active: boolean;
  onSelect: () => void;
};

export type AgentSessionDetailHeaderProps = {
  title: string;
  sessionId: string;
  agentId?: string;
  createdAt?: string;
  view?: 'sessions' | null;
  onClose: () => void;
};

export type AgentSessionTurnHeaderProps = {
  turnNumber: number;
  totalTokens?: number;
  durationMs?: number;
  totalCostInUsd?: number;
};

export type AgentSessionMetricsStripProps = {
  metrics: SessionMetrics;
};

export type AgentSessionEventTimelineProps = {
  turns: SessionTurnView[];
  segments: SessionEventTimelineSegment[];
  onSelectTurn?: (index: number) => void;
};

export type AgentSessionEventTimelineChartProps = {
  turns: SessionTurnView[];
  segments: SessionEventTimelineSegment[];
  hiddenTypes: ReadonlySet<SessionEventType>;
  onSelectTurn?: (index: number) => void;
};

export type AgentDetailsTab = LibraryAgentTab;

export type AgentDetailsPageProps = {
  agentId: string;
};

export type AgentDetailsHeaderProps = {
  agentId: string;
  detail?: AgentDetail;
  onBack: () => void;
};

export type AgentDetailsTabsProps = {
  activeTab: AgentDetailsTab;
  onTabChange: (tab: AgentDetailsTab) => void;
  showMetrics?: boolean;
};

export type AgentMetricsProps = {
  agentId: string;
};

export type AgentMetricChartResult = {
  definition: AgentMetricChartDefinition;
  graphs?: AgentMetricGraph[];
  error?: string;
};

export type AgentMetricsViewProps = {
  meters?: AgentMetricMeter[];
  meterError?: string;
  charts: AgentMetricChartResult[];
  chartsLoading: boolean;
  chartsError?: string;
  timeRange: SessionTimeRange;
  onTimeRangeChange: (range: SessionTimeRange) => void;
};

export type AgentMetricsTimeRangeFilterProps = {
  timeRange: SessionTimeRange;
  onTimeRangeChange: (range: SessionTimeRange) => void;
};

export type AgentMetricCardProps = {
  meter: AgentMetricMeter;
};

export type AgentMetricChartProps = {
  graph?: AgentMetricGraph;
  definition: AgentMetricChartDefinition;
  error?: string;
};

export type AgentOverviewProps = {
  detail: AgentDetail;
};

export type AgentOverviewCardProps = {
  title: string;
  icon: string;
  count?: number;
  children: ReactNode;
};

export type AgentCodeSnippetsProps = {
  snippets: CodeSnippet[];
};

export type AgentCodeBlockProps = {
  code: string;
  language: string;
};

export type AgentDetailsUnavailableProps = {
  onBack: () => void;
  reason?: string;
};
