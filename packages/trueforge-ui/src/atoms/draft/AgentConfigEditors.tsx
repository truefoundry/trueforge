'use client';

import { useEffect, useMemo, useState } from 'react';

import type { AgentSkill, AgentSpec, ConnectorState, McpToolSelection, ModelSelection } from '../../server/types.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { editableMountsFromSpec } from './agentConfigMounts.js';

export type AgentConfigEditor = 'model' | 'model-settings' | 'runtime' | 'mcp' | 'skills';

export type AgentConfigEditorsProps = {
  editor: AgentConfigEditor | null;
  spec: AgentSpec;
  models: ModelSelection[];
  connectors: ConnectorState[];
  skills: AgentSkill[];
  loading: boolean;
  error: string | null;
  skillsDisabled?: boolean;
  sandboxAvailable?: boolean;
  loadMcpTools?: (connectorId: string) => Promise<McpToolSelection[]>;
  onRefreshConnectors?: () => Promise<void>;
  onChange: (spec: AgentSpec) => void;
  onClose: () => void;
};

export function AgentConfigEditors({
  editor,
  spec,
  models,
  connectors,
  skills,
  loading,
  error,
  skillsDisabled = false,
  sandboxAvailable = false,
  loadMcpTools,
  onRefreshConnectors,
  onChange,
  onClose,
}: AgentConfigEditorsProps) {
  const AgentModelConfigModal = useSlot('AgentModelConfigModal');
  const AgentResourceConfigModal = useSlot('AgentResourceConfigModal');
  const AgentRuntimeConfigModal = useSlot('AgentRuntimeConfigModal');
  const [query, setQuery] = useState('');
  const [activeConnectorId, setActiveConnectorId] = useState<string | null>(null);
  const [tools, setTools] = useState<McpToolSelection[]>([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [toolsRequestEpoch, setToolsRequestEpoch] = useState(0);
  const mounts = useMemo(() => editableMountsFromSpec(spec.mcpServers), [spec.mcpServers]);
  const activeConnectorAvailable =
    activeConnectorId !== null && connectors.some(connector => connector.id === activeConnectorId);
  const firstMountedConnectorId = mounts
    .map(mount => connectors.find(connector => connector.id === mount.id || connector.name === mount.name)?.id)
    .find((id): id is string => id !== undefined);
  const selectedConnectorId =
    (activeConnectorAvailable ? activeConnectorId : null) ?? firstMountedConnectorId ?? connectors[0]?.id ?? null;

  useEffect(() => {
    if (editor !== 'mcp' || selectedConnectorId === null || loadMcpTools === undefined) return;
    let cancelled = false;
    setTools([]);
    setToolsLoading(true);
    setToolsError(null);
    void loadMcpTools(selectedConnectorId)
      .then(nextTools => {
        if (!cancelled) setTools(nextTools);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setToolsError(reason instanceof Error ? reason.message : 'Failed to load tools.');
      })
      .finally(() => {
        if (!cancelled) setToolsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editor, loadMcpTools, selectedConnectorId, toolsRequestEpoch]);

  const close = () => {
    setQuery('');
    setActiveConnectorId(null);
    setTools([]);
    setToolsError(null);
    onClose();
  };

  const modelEditor = editor === 'model' || editor === 'model-settings' ? editor : null;
  const resourceEditor = editor === 'mcp' || editor === 'skills' ? editor : null;

  return (
    <>
      {modelEditor ? (
        <AgentModelConfigModal
          editor={modelEditor}
          spec={spec}
          models={models}
          loading={loading}
          error={error}
          query={query}
          onQueryChange={setQuery}
          onChange={onChange}
          onClose={close}
        />
      ) : null}
      {editor === 'runtime' ? (
        <AgentRuntimeConfigModal
          open
          spec={spec}
          sandboxAvailable={sandboxAvailable}
          onChange={onChange}
          onClose={close}
        />
      ) : null}
      {resourceEditor ? (
        <AgentResourceConfigModal
          editor={resourceEditor}
          spec={spec}
          connectors={connectors}
          skills={skills}
          skillsDisabled={skillsDisabled}
          query={query}
          activeConnectorId={selectedConnectorId}
          tools={tools}
          toolsLoading={toolsLoading}
          toolsError={toolsError}
          onQueryChange={setQuery}
          onSelectConnector={setActiveConnectorId}
          onRetryTools={() => setToolsRequestEpoch(epoch => epoch + 1)}
          onRefreshConnectors={onRefreshConnectors}
          onChange={onChange}
          onClose={close}
        />
      ) : null}
    </>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentConfigEditors: typeof AgentConfigEditors;
  }
}
