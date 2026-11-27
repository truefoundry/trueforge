'use client';

import { useTrueForgeAgentSpec, useTrueForgeUpdateAgentSpec } from '@truefoundry/trueforge-assistant-ui-runtime';
import { readDraftTrueforgeEnabled } from '@truefoundry/trueforge-assistant-ui-runtime/server';
import { useEffect, useMemo, useState } from 'react';

import { isSettingsSectionEnabled } from '../../server/serverChrome.js';
import { useOptionalCatalogServer, useServerCapabilities } from '../../server/ServerContext.js';
import { useOptionalShellMode } from '../../server/ShellModeContext.js';
import type { ConnectorState } from '../../server/types.js';
import { WEB_SEARCH_ONE_WAY_OFF_HINT, WEB_SEARCH_UNAVAILABLE_HINT, webSearchGate } from './agentCapabilities.js';
import { DraftCatalogEmptyState } from './DraftCatalogEmptyState.js';
import { useDraftCatalog } from './DraftCatalogProvider.js';
import {
  CatalogRow,
  CatalogSearchField,
  ConnectorConnectButton,
  RowNote,
  SectionHeading,
  isUnauthenticatedDcrConnector,
} from './DraftCatalogRow.js';
import type { DraftMount } from './draftMounts.js';
import { connectorsWithSelectedStubs } from './mcpConnectorStubs.js';

const WEB_SEARCH_BUILTIN_TITLE = 'Web search';
const WEB_SEARCH_BUILTIN_DESCRIPTION = 'Search the web for up-to-date answers';
const TRUEFORGE_BUILTIN_TITLE = 'TrueForge';
const TRUEFORGE_BUILTIN_DESCRIPTION = 'Create and update agents, schedules, and sandbox environments';

export type DraftConnectorsPanelProps = {
  selected: DraftMount[];
  onToggleConnector: (connector: ConnectorState) => void;
  /** Closes the enclosing menu before navigating to settings. */
  onClose: () => void;
};

export function DraftConnectorsPanel({ selected, onToggleConnector, onClose }: DraftConnectorsPanelProps) {
  const { connectors, connectorLogos, loading, ensureLoaded, refreshConnectors } = useDraftCatalog();
  const capabilities = useServerCapabilities();
  const settingsCatalog = useOptionalCatalogServer();
  const shell = useOptionalShellMode();
  const { agentSpec } = useTrueForgeAgentSpec();
  const updateAgentSpec = useTrueForgeUpdateAgentSpec();
  const [query, setQuery] = useState('');
  // The panel mounts on open, so this snapshot keeps rows from jumping between sections mid-session.
  const [pinnedMcpIds] = useState(() => new Set(selected.map(m => m.id)));
  const selectedMcpIds = useMemo(() => new Set(selected.map(m => m.id)), [selected]);

  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  const webSearchDisabledReason = capabilities?.webSearch?.reason ?? WEB_SEARCH_UNAVAILABLE_HINT;
  const webSearchEnabled = agentSpec?.config?.webSearch?.enabled ?? capabilities?.webSearch?.enabled === true;
  // A chat that already searches the web keeps it until the user turns it off; only
  // turning it back on needs the capability.
  const { locked: webSearchLocked, offIsFinal: webSearchOffIsFinal } = webSearchGate({
    capabilities,
    enabled: webSearchEnabled,
  });
  const canToggleWebSearch = !webSearchLocked;
  const trueforgeEnabled = readDraftTrueforgeEnabled(agentSpec?.config) !== false;
  const canConfigureConnectors =
    isSettingsSectionEnabled({ settings: capabilities?.settings, section: 'mcpServers' }) &&
    settingsCatalog?.connectorCatalog != null;

  const toggleWebSearch = () => {
    if (!canToggleWebSearch || agentSpec == null) return;
    const nextEnabled = !webSearchEnabled;
    const nextSpec = {
      ...agentSpec,
      config: { ...agentSpec.config, webSearch: { enabled: nextEnabled } },
    };
    updateAgentSpec?.({ config: nextSpec.config });
    // Flush seed immediately — New Chat can run before the preference bridge effect.
    shell?.rememberDraftSpec(nextSpec, 'chat');
  };

  const toggleTrueforge = () => {
    if (agentSpec == null) return;
    const nextSpec = {
      ...agentSpec,
      config: { ...agentSpec.config, trueforge: { enabled: !trueforgeEnabled } },
    };
    updateAgentSpec?.({ config: nextSpec.config });
    // Flush seed immediately — New Chat can run before the preference bridge effect.
    shell?.rememberDraftSpec(nextSpec, 'chat');
  };

  const needle = query.trim().toLowerCase();
  const matchesBuiltinQuery = (title: string, description: string) =>
    !needle || title.toLowerCase().includes(needle) || description.toLowerCase().includes(needle);
  const showWebSearchBuiltin = matchesBuiltinQuery(WEB_SEARCH_BUILTIN_TITLE, WEB_SEARCH_BUILTIN_DESCRIPTION);
  const showTrueforgeBuiltin = matchesBuiltinQuery(TRUEFORGE_BUILTIN_TITLE, TRUEFORGE_BUILTIN_DESCRIPTION);

  const catalogConnectors = useMemo(
    () => connectorsWithSelectedStubs({ connectors, selected }),
    [connectors, selected],
  );
  const filteredConnectors = useMemo(() => {
    const matches = needle
      ? catalogConnectors.filter(
          c => c.name.toLowerCase().includes(needle) || (c.description?.toLowerCase().includes(needle) ?? false),
        )
      : catalogConnectors;
    return [...matches].sort(
      (left, right) => Number(isUnauthenticatedDcrConnector(left)) - Number(isUnauthenticatedDcrConnector(right)),
    );
  }, [catalogConnectors, needle]);
  const pinnedSelectedConnectors = filteredConnectors.filter(c => pinnedMcpIds.has(c.id));
  const pinnedAvailableConnectors = filteredConnectors.filter(c => !pinnedMcpIds.has(c.id));

  const openSettings = () => {
    onClose();
    shell?.setSettingsOpen(true, 'connectors');
  };

  const renderConnector = (connector: ConnectorState) => (
    <CatalogRow
      key={connector.id}
      title={connector.name}
      logo={connectorLogos[connector.name]}
      fallbackIcon="mcp-server"
      checked={selectedMcpIds.has(connector.id)}
      action={
        isUnauthenticatedDcrConnector(connector) ? (
          <ConnectorConnectButton connector={connector} onConnected={refreshConnectors} />
        ) : undefined
      }
      onToggle={() => onToggleConnector(connector)}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CatalogSearchField value={query} onChange={setQuery} placeholder="Search connectors..." />
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {showTrueforgeBuiltin || showWebSearchBuiltin ? (
          <>
            <SectionHeading label="Built-in" />
            {showTrueforgeBuiltin ? (
              <CatalogRow
                title={TRUEFORGE_BUILTIN_TITLE}
                description={TRUEFORGE_BUILTIN_DESCRIPTION}
                fallbackIcon="bot"
                checked={trueforgeEnabled}
                onToggle={toggleTrueforge}
              />
            ) : null}
            {showWebSearchBuiltin ? (
              <>
                <CatalogRow
                  title={WEB_SEARCH_BUILTIN_TITLE}
                  description={WEB_SEARCH_BUILTIN_DESCRIPTION}
                  fallbackIcon="searchGlobe"
                  checked={webSearchEnabled}
                  disabled={!canToggleWebSearch}
                  disabledReason={webSearchDisabledReason}
                  onToggle={toggleWebSearch}
                />
                {canToggleWebSearch ? null : <RowNote>{webSearchDisabledReason}</RowNote>}
                {webSearchOffIsFinal ? <RowNote icon="info">{WEB_SEARCH_ONE_WAY_OFF_HINT}</RowNote> : null}
              </>
            ) : null}
          </>
        ) : null}
        {pinnedSelectedConnectors.length > 0 ? (
          <>
            <SectionHeading label="Selected" count={pinnedSelectedConnectors.length} />
            {pinnedSelectedConnectors.map(renderConnector)}
          </>
        ) : null}
        {pinnedAvailableConnectors.length > 0 ? (
          <>
            <SectionHeading label="Available" count={pinnedAvailableConnectors.length} />
            {pinnedAvailableConnectors.map(renderConnector)}
          </>
        ) : null}
        {filteredConnectors.length === 0 && connectors.length > 0 && !showWebSearchBuiltin ? (
          <DraftCatalogEmptyState loading={loading} emptyLabel="No connectors" settingsTarget="Connectors" />
        ) : null}
        {connectors.length === 0 ? (
          <DraftCatalogEmptyState
            loading={loading}
            emptyLabel="No connectors"
            settingsTarget="Connectors"
            onOpenSettings={shell && canConfigureConnectors ? openSettings : undefined}
          />
        ) : null}
      </div>
    </div>
  );
}
