'use client';

import type { AgentSkill, AgentSpec, ConnectorState, McpToolSelection } from '../../server/types.js';
import { useSlot } from '../../theme/SlotsProvider.js';

export type AgentResourceEditorContentProps = {
  editor: 'mcp' | 'skills';
  spec: AgentSpec;
  connectors: ConnectorState[];
  skills: AgentSkill[];
  skillsDisabled: boolean;
  query: string;
  activeConnectorId: string | null;
  tools: McpToolSelection[];
  toolsLoading: boolean;
  toolsError: string | null;
  onQueryChange: (query: string) => void;
  onSelectConnector: (connectorId: string) => void;
  onRetryTools: () => void;
  onRefreshConnectors?: () => Promise<void>;
  onChange: (spec: AgentSpec) => void;
};

export function AgentResourceEditorContent(props: AgentResourceEditorContentProps) {
  const AgentMcpEditorContent = useSlot('AgentMcpEditorContent');
  const AgentSkillsEditorContent = useSlot('AgentSkillsEditorContent');

  if (props.editor === 'skills') {
    return (
      <AgentSkillsEditorContent
        spec={props.spec}
        skills={props.skills}
        skillsDisabled={props.skillsDisabled}
        query={props.query}
        onQueryChange={props.onQueryChange}
        onChange={props.onChange}
      />
    );
  }

  return (
    <AgentMcpEditorContent
      spec={props.spec}
      connectors={props.connectors}
      query={props.query}
      activeConnectorId={props.activeConnectorId}
      tools={props.tools}
      toolsLoading={props.toolsLoading}
      toolsError={props.toolsError}
      onQueryChange={props.onQueryChange}
      onSelectConnector={props.onSelectConnector}
      onRetryTools={props.onRetryTools}
      onRefreshConnectors={props.onRefreshConnectors}
      onChange={props.onChange}
    />
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentResourceEditorContent: typeof AgentResourceEditorContent;
  }
}
