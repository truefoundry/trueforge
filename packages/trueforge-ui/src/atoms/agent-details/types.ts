import type { ReactNode } from 'react';
import type { AgentDetail, CodeSnippet } from '../../server/types.js';

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
