'use client';

import {
  useTrueFoundryAgentSpec,
  useTrueFoundryFlushAgentSpec,
  useTrueFoundryUpdateAgentSpec,
} from '@truefoundry/assistant-ui-runtime';
import { useCallback, useEffect, useState } from 'react';

import type { AgentConfigEditor } from '../atoms/draft/AgentConfigEditors.js';
import { useAgentConfigInstructions } from '../atoms/draft/AgentConfigInstructionsContext.js';
import { useDraftCatalog } from '../atoms/draft/DraftCatalogProvider.js';
import { useOptionalServer, useServerCapabilities } from '../server/ServerContext.js';
import { shellIsCreateAgent, useShellMode } from '../server/ShellModeContext.js';
import type { AgentSpec, McpToolSelection } from '../server/types.js';
import { useSlot } from '../theme/SlotsProvider.js';

export function AgentConfigDrawerContainer({ showClose = false }: { showClose?: boolean }) {
  const { agentSpec } = useTrueFoundryAgentSpec();
  const updateAgentSpec = useTrueFoundryUpdateAgentSpec();
  const flushAgentSpec = useTrueFoundryFlushAgentSpec();
  const shell = useShellMode();
  const server = useOptionalServer();
  const capabilities = useServerCapabilities();
  const catalog = useDraftCatalog();
  const AgentConfigPanel = useSlot('AgentConfigPanel');
  const AgentConfigEditors = useSlot('AgentConfigEditors');
  const [editor, setEditor] = useState<AgentConfigEditor | null>(null);
  const isBuilder = shellIsCreateAgent(shell.mode);
  const {
    draft: instructionDraft,
    onChange: onInstructionChange,
    flush: flushInstructions,
  } = useAgentConfigInstructions();
  const closeDrawer = useCallback(() => {
    flushInstructions();
    void flushAgentSpec();
    shell.setAgentConfigOpen(false);
  }, [flushAgentSpec, flushInstructions, shell]);

  useEffect(() => {
    if (isBuilder) catalog.ensureLoaded();
  }, [catalog, isBuilder]);

  useEffect(() => {
    if (!showClose || !shell.agentConfigOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && editor === null && document.querySelector('dialog[open]') === null) {
        closeDrawer();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeDrawer, editor, shell.agentConfigOpen, showClose]);

  // Flush pending edits on unmount. ChatProvider remount (runtimeKey) tears the
  // runtime down first — flush then throws; ignore so the new draft can mount.
  useEffect(
    () => () => {
      flushInstructions();
      try {
        void flushAgentSpec();
      } catch {
        // Runtime already gone.
      }
    },
    [flushAgentSpec, flushInstructions],
  );

  const updateSpec = useCallback(
    (next: AgentSpec) => {
      if (next.skills && next.skills.length > 0 && capabilities?.sandbox.enabled === true) {
        updateAgentSpec?.({
          ...next,
          instructions: instructionDraft,
          config: {
            ...next.config,
            sandbox: { ...next.config?.sandbox, enabled: true },
          },
        });
        return;
      }
      updateAgentSpec?.({ ...next, instructions: instructionDraft });
    },
    [capabilities?.sandbox.enabled, instructionDraft, updateAgentSpec],
  );

  const loadMcpTools = useCallback(
    async (connectorId: string): Promise<McpToolSelection[]> => {
      if (server?.getMcpTools === undefined) return [];
      return server.getMcpTools({ connectorId });
    },
    [server],
  );

  if (!isBuilder || agentSpec === null || (showClose && !shell.agentConfigOpen)) {
    return null;
  }

  const model = catalog.models.find(item => item.name === agentSpec.model.name);

  return (
    <>
      <AgentConfigPanel
        spec={agentSpec}
        model={model}
        skillsAvailable={capabilities?.skill.enabled === true}
        instructions={instructionDraft}
        onInstructionsChange={onInstructionChange}
        onInstructionsBlur={flushInstructions}
        onOpenEditor={setEditor}
        onChange={updateSpec}
        onClose={showClose ? closeDrawer : undefined}
      />
      <AgentConfigEditors
        editor={editor}
        spec={agentSpec}
        models={catalog.models}
        connectors={catalog.connectors}
        skills={catalog.skills}
        loading={catalog.loading}
        error={catalog.error}
        skillsDisabled={capabilities?.skill.enabled !== true}
        sandboxAvailable={capabilities?.sandbox.enabled === true}
        loadMcpTools={loadMcpTools}
        onRefreshConnectors={catalog.refreshConnectors}
        onChange={updateSpec}
        onClose={() => setEditor(null)}
      />
    </>
  );
}
