'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import type { AgentSkill, AgentSpec, ConnectorState, McpToolSelection, ModelSelection } from '../../server/types.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';
import type { AgentInstructionsDraft } from './AgentInstructionsDrawer.js';
import { initialUserMessagesFromSpec, withInitialUserMessages } from './agentConfigMessages.js';
import { editableMountsFromSpec } from './agentConfigMounts.js';
import { connectorsWithSelectedStubs } from './mcpConnectorStubs.js';

export type AgentConfigEditor = 'instructions' | 'model' | 'model-settings' | 'runtime' | 'mcp' | 'skills';

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
  instructions?: string;
  onInstructionsSave?: (draft: AgentInstructionsDraft) => void;
  loadMcpConnector?: (connectorId: string) => Promise<ConnectorState | undefined>;
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
  instructions,
  onInstructionsSave,
  loadMcpConnector,
  loadMcpTools,
  onRefreshConnectors,
  onChange,
  onClose,
}: AgentConfigEditorsProps) {
  const AgentModelConfigModal = useSlot('AgentModelConfigModal');
  const AgentResourceConfigModal = useSlot('AgentResourceConfigModal');
  const AgentRuntimeConfigDrawer = useSlot('AgentRuntimeConfigDrawer');
  const AgentInstructionsDrawer = useSlot('AgentInstructionsDrawer');
  const [query, setQuery] = useState('');
  const [activeConnectorId, setActiveConnectorId] = useState<string | null>(null);
  const [activeConnector, setActiveConnector] = useState<ConnectorState | undefined>();
  const [connectorLoading, setConnectorLoading] = useState(false);
  const [connectorError, setConnectorError] = useState<string | null>(null);
  const [tools, setTools] = useState<McpToolSelection[]>([]);
  const [toolsByConnector, setToolsByConnector] = useState<Record<string, McpToolSelection[]>>({});
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [toolsRequestEpoch, setToolsRequestEpoch] = useState(0);
  // Connector ids whose tool listing is cached or in flight, so mounts are listed once.
  const requestedToolConnectorsRef = useRef<Set<string>>(new Set());
  const mounts = useMemo(() => editableMountsFromSpec(spec.mcpServers), [spec.mcpServers]);
  const catalogConnectors = useMemo(
    () => connectorsWithSelectedStubs({ connectors, selected: mounts }),
    [connectors, mounts],
  );
  const catalogConnectorsRef = useRef(catalogConnectors);
  catalogConnectorsRef.current = catalogConnectors;
  const activeConnectorAvailable =
    activeConnectorId !== null && catalogConnectors.some(connector => connector.id === activeConnectorId);
  const firstMountedConnectorId = mounts
    .map(mount => catalogConnectors.find(connector => connector.id === mount.id || connector.name === mount.name)?.id)
    .find((id): id is string => id !== undefined);
  const selectedConnectorId =
    (activeConnectorAvailable ? activeConnectorId : null) ??
    firstMountedConnectorId ??
    catalogConnectors[0]?.id ??
    null;
  const selectedListedAuthenticated =
    selectedConnectorId === null
      ? undefined
      : catalogConnectors.find(connector => connector.id === selectedConnectorId)?.authenticated;
  const resolvedConnectors = useMemo(
    () =>
      activeConnector === undefined
        ? catalogConnectors
        : catalogConnectors.map(connector =>
            connector.id === activeConnector.id ? { ...connector, ...activeConnector } : connector,
          ),
    [activeConnector, catalogConnectors],
  );

  useEffect(() => {
    if (editor !== 'mcp' || selectedConnectorId === null) return;
    let cancelled = false;
    const listedConnector = catalogConnectorsRef.current.find(connector => connector.id === selectedConnectorId);
    setActiveConnector(undefined);
    setConnectorLoading(loadMcpConnector !== undefined);
    setConnectorError(null);
    setTools([]);
    setToolsLoading(false);
    setToolsError(null);
    void (async () => {
      let connector = listedConnector;
      if (loadMcpConnector !== undefined) {
        try {
          connector = (await loadMcpConnector(selectedConnectorId)) ?? listedConnector;
          if (cancelled) return;
          setActiveConnector(connector);
        } catch (reason: unknown) {
          if (!cancelled) setConnectorError(getErrorMessage(reason, 'Failed to load MCP server.'));
          return;
        } finally {
          if (!cancelled) setConnectorLoading(false);
        }
      }
      if (cancelled || connector?.authenticated === false || loadMcpTools === undefined) return;
      setToolsLoading(true);
      try {
        const nextTools = await loadMcpTools(selectedConnectorId);
        // Cache by id even when this run was cancelled, so the mark always has tools behind it.
        requestedToolConnectorsRef.current.add(selectedConnectorId);
        setToolsByConnector(previous => ({ ...previous, [selectedConnectorId]: nextTools }));
        if (!cancelled) setTools(nextTools);
      } catch (reason: unknown) {
        if (!cancelled) setToolsError(getErrorMessage(reason, 'Failed to load tools.'));
      } finally {
        if (!cancelled) setToolsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editor, loadMcpConnector, loadMcpTools, selectedConnectorId, selectedListedAuthenticated, toolsRequestEpoch]);

  // Selected servers other than the open one need their tools listed too, so the Selected Tools
  // summary can resolve `@write` / `@destructive` approval selectors against tool annotations.
  useEffect(() => {
    if (editor !== 'mcp' || loadMcpTools === undefined) return;
    const requested = requestedToolConnectorsRef.current;
    const pending = mounts.flatMap(mount => {
      const connector = catalogConnectorsRef.current.find(item => item.id === mount.id || item.name === mount.name);
      if (connector === undefined || connector.authenticated !== true) return [];
      if (connector.id === selectedConnectorId || requested.has(connector.id)) return [];
      return [connector.id];
    });
    if (pending.length === 0) return;
    for (const connectorId of pending) requested.add(connectorId);
    const settled = new Set<string>();
    void Promise.all(
      pending.map(async connectorId => {
        try {
          const nextTools = await loadMcpTools(connectorId);
          setToolsByConnector(previous => ({ ...previous, [connectorId]: nextTools }));
        } catch {
          // Approval badges fall back to name-only matching when a server cannot list its tools.
        } finally {
          settled.add(connectorId);
        }
      }),
    );
    return () => {
      // Listings still in flight lose their mark so a later run can retry them.
      for (const connectorId of pending) {
        if (!settled.has(connectorId)) requested.delete(connectorId);
      }
    };
  }, [editor, loadMcpTools, mounts, selectedConnectorId]);

  const close = () => {
    setQuery('');
    setActiveConnectorId(null);
    setActiveConnector(undefined);
    setConnectorError(null);
    setTools([]);
    setToolsByConnector({});
    requestedToolConnectorsRef.current.clear();
    setToolsError(null);
    onClose();
  };

  const modelEditor = editor === 'model' || editor === 'model-settings' ? editor : null;
  const resourceEditor = editor === 'mcp' || editor === 'skills' ? editor : null;
  const saveInstructions = (draft: AgentInstructionsDraft) => {
    if (onInstructionsSave !== undefined) {
      onInstructionsSave(draft);
      return;
    }
    onChange(
      withInitialUserMessages({
        spec: { ...spec, instructions: draft.instructions || undefined },
        messages: draft.messages,
      }),
    );
  };

  return (
    <>
      {editor === 'instructions' ? (
        <AgentInstructionsDrawer
          open
          instructions={instructions ?? spec.instructions ?? ''}
          messages={initialUserMessagesFromSpec(spec)}
          onSave={saveInstructions}
          onClose={close}
        />
      ) : null}
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
        <AgentRuntimeConfigDrawer
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
          connectors={resolvedConnectors}
          skills={skills}
          skillsDisabled={skillsDisabled}
          query={query}
          activeConnectorId={selectedConnectorId}
          tools={tools}
          toolsByConnector={toolsByConnector}
          connectorLoading={
            connectorLoading ||
            (loadMcpConnector !== undefined && activeConnector?.id !== selectedConnectorId && connectorError === null)
          }
          connectorError={connectorError}
          toolsLoading={toolsLoading}
          toolsError={toolsError}
          onQueryChange={setQuery}
          onSelectConnector={setActiveConnectorId}
          onRetryTools={() => setToolsRequestEpoch(epoch => epoch + 1)}
          {...(loadMcpConnector !== undefined
            ? { onRefreshConnector: () => setToolsRequestEpoch(epoch => epoch + 1) }
            : onRefreshConnectors !== undefined
              ? {
                  onRefreshConnector: () => {
                    void onRefreshConnectors().then(() => {
                      setToolsRequestEpoch(epoch => epoch + 1);
                    });
                  },
                }
              : {})}
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
