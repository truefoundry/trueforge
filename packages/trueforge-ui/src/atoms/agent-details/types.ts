import type { ReactNode } from 'react';
import type { AgentDetail, CodeSnippet } from '../../server/types.js';
import type { SessionMetrics } from '../../utils/buildSessionMetrics.js';
import type { SessionEventTimelineSegment, SessionEventType } from '../../utils/sessionEventTimeline.js';
import type { SessionTurnView } from '../../utils/sessionTurnViews.js';

export type AgentSessionsProps = {
  agentId: string;
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
  agentId: string;
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

export type AgentDetailsTab = 'overview' | 'sessions' | 'code';

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
