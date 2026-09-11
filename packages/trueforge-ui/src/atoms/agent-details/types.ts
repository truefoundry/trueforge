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
  sourceType?: 'schedule';
  lastActivityAt: string;
  metrics: {
    totalTurns: number;
    totalCostInUsd?: number;
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
  /**
   * When set with `resumeLabel`, shows Resume Chat / Resume Agent building as a
   * new-tab link (session deep link). Preferred over `onResume` when both are set.
   */
  resumeHref?: string;
  /** In-shell resume fallback when no session deep link is available. */
  onResume?: () => void;
  /** Label for the resume action. */
  resumeLabel?: string;
  /** Whether the current user may resume this session. */
  canResume?: boolean;
};

export type AgentSessionTurnHeaderProps = {
  turnNumber: number;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
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
  showSchedules?: boolean;
  end?: ReactNode;
};

export type AgentMetricsProps = {
  agentId: string;
  showTimeRangeFilter?: boolean;
} & (
  | {
      timeRange: SessionTimeRange;
      onTimeRangeChange: (range: SessionTimeRange) => void;
    }
  | {
      timeRange?: undefined;
      onTimeRangeChange?: undefined;
    }
);

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
  showTimeRangeFilter?: boolean;
};

export type AgentMetricStatisticsProps = {
  meters: AgentMetricMeter[];
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
  colorIndex?: number;
};

export type AgentOverviewProps = {
  detail: AgentDetail;
};

export type AgentOverviewCardProps = {
  title: string;
  icon?: string;
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
