'use client';

import {
  useTrueFoundryAdoptAgentSpec,
  useTrueFoundryAgentSpec,
  useTrueFoundryFlushAgentSpec,
} from '@truefoundry/assistant-ui-runtime';
import { useMemo, useRef, useState } from 'react';

import { useSaveAgentVisible } from '../hooks/useChatChromeActionsVisible.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalServer, useServerCapabilities } from '../server/ServerContext.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import type { AgentSpec, McpToolSelection } from '../server/types.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { getErrorMessage } from '../utils/getErrorMessage.js';
import type { AgentConfigEditor } from './draft/AgentConfigEditors.js';
import { DraftCatalogProvider, useDraftCatalog } from './draft/DraftCatalogProvider.js';
import { editableMountsFromSpec, withPreload } from './draft/agentConfigMounts.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { CenteredModal } from './primitives/CenteredModal.js';

type SaveIntent = 'create' | 'update';

function cloneAgentSpec(spec: AgentSpec): AgentSpec {
  return {
    ...spec,
    model: {
      ...spec.model,
      params: spec.model.params ? { ...spec.model.params } : undefined,
    },
    mcpServers: spec.mcpServers?.map((item: object) => ({ ...item })),
    skills: spec.skills?.map((item: object) => ({ ...item })),
    config: spec.config ? { ...spec.config } : undefined,
  };
}

export type SaveAgentButtonProps = {
  disabled?: boolean;
  className?: string;
  children?: string;
  /** Unsynced drawer instructions to overlay onto the latest runtime spec. */
  instructionsOverride?: string;
};

export function SaveAgentButton({
  disabled = false,
  className,
  children = 'Save Agent',
  instructionsOverride,
}: SaveAgentButtonProps) {
  return (
    <DraftCatalogProvider>
      <SaveAgentButtonContent disabled={disabled} className={className} instructionsOverride={instructionsOverride}>
        {children}
      </SaveAgentButtonContent>
    </DraftCatalogProvider>
  );
}

function SaveAgentButtonContent({
  disabled,
  className,
  children,
  instructionsOverride,
}: {
  disabled: boolean;
  className?: string;
  children: string;
  instructionsOverride?: string;
}) {
  const { agentSpec, draftSessionId } = useTrueFoundryAgentSpec();
  const agentSpecRef = useRef(agentSpec);
  agentSpecRef.current = agentSpec;
  const flushAgentSpec = useTrueFoundryFlushAgentSpec();
  const adoptAgentSpec = useTrueFoundryAdoptAgentSpec();
  const builder = useOptionalServer();
  const shell = useOptionalShellMode();
  const catalog = useDraftCatalog();
  const serverCapabilities = useServerCapabilities();
  const AgentConfigEditors = useSlot('AgentConfigEditors');
  const SaveAgentForm = useSlot('SaveAgentForm');
  const visible = useSaveAgentVisible();
  const [open, setOpen] = useState(false);
  const [editor, setEditor] = useState<AgentConfigEditor | null>(null);
  const [intent, setIntent] = useState<SaveIntent>('create');
  const [name, setName] = useState('');
  const [draftSpec, setDraftSpec] = useState<AgentSpec | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mcpMounts = useMemo(() => editableMountsFromSpec(draftSpec?.mcpServers), [draftSpec?.mcpServers]);
  const skillMounts = useMemo(() => editableMountsFromSpec(draftSpec?.skills), [draftSpec?.skills]);
  const modelEntry = useMemo(
    () => catalog.models.find(model => model.name === draftSpec?.model.name),
    [catalog.models, draftSpec?.model.name],
  );

  const close = () => {
    if (saving) return;
    setEditor(null);
    setOpen(false);
    setDraftSpec(null);
    setError(null);
  };

  const show = async () => {
    if (agentSpecRef.current === null || builder === null) return;
    setError(null);
    catalog.ensureLoaded();
    await flushAgentSpec();
    const flushedAgentSpec = agentSpecRef.current;
    if (flushedAgentSpec === null) return;
    const latestAgentSpec =
      instructionsOverride === undefined
        ? flushedAgentSpec
        : { ...flushedAgentSpec, instructions: instructionsOverride };
    const currentName = shell?.mode.status === 'active' ? (shell.mode.agentName ?? shell.mode.agentId ?? '') : '';
    setIntent(currentName ? 'update' : 'create');
    setName(currentName);
    setDraftSpec(cloneAgentSpec(latestAgentSpec));
    setOpen(true);
  };

  const save = async () => {
    if (builder === null || draftSpec === null) return;
    const normalizedName = name.trim();
    if (!normalizedName || !draftSpec.model.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const result = await builder.saveAgent({
        agentName: normalizedName,
        agentSpec: draftSpec,
        intent,
        sessionId: draftSessionId,
      });
      adoptAgentSpec({ agentSpec: draftSpec, updatedAt: result.sessionUpdatedAt });
      shell?.bindMutableAgent({
        agentId: result.agentId ?? normalizedName,
        agentName: normalizedName,
        agentSpec: draftSpec,
      });
      shell?.invalidateAgentsList();
      setOpen(false);
      setDraftSpec(null);
      setEditor(null);
    } catch (caught) {
      setError(getErrorMessage(caught, 'Could not save agent'));
    } finally {
      setSaving(false);
    }
  };

  const toggleMcpPreload = (id: string) => {
    if (draftSpec === null) return;
    const next = mcpMounts.map(item =>
      item.id === id ? withPreload(item.value, Reflect.get(item.value, 'preload') !== true) : item.value,
    );
    setDraftSpec({ ...draftSpec, mcpServers: next });
  };

  const removeMcp = (id: string) => {
    if (draftSpec === null) return;
    setDraftSpec({
      ...draftSpec,
      mcpServers: mcpMounts.filter(item => item.id !== id).map(item => item.value),
    });
  };

  const isUpdateMode =
    shell?.mode.status === 'active' &&
    shell.mode.isMutable &&
    (shell.mode.agentName !== undefined || shell.mode.agentId !== undefined);
  const triggerLabel = isUpdateMode && children === 'Save Agent' ? 'Update Agent' : children;
  const getMcpTools = builder === null ? undefined : Reflect.get(builder, 'getMcpTools');
  const loadMcpTools =
    typeof getMcpTools === 'function'
      ? async (connectorId: string): Promise<McpToolSelection[]> => {
          const result: unknown = await getMcpTools.call(builder, { connectorId });
          return Array.isArray(result) ? result : [];
        }
      : undefined;

  if (!visible) return null;

  return (
    <>
      <button
        type="button"
        disabled={disabled || builder === null || agentSpec === null}
        className={auiButtonClass({ variant: 'outline', size: 'sm', className })}
        onClick={() => void show()}
      >
        <Icon name="save" className="size-3.5" />
        {triggerLabel}
      </button>

      <CenteredModal
        open={open}
        onOpenChange={next => !next && close()}
        title={intent === 'create' ? 'Save agent' : 'Update agent'}
        className="md:h-auto md:max-h-[85dvh] md:max-w-2xl"
        aria-label={intent === 'create' ? 'Save agent' : 'Update agent'}
      >
        {draftSpec ? (
          <SaveAgentForm
            intent={intent}
            name={name}
            spec={draftSpec}
            modelEntry={modelEntry}
            mcpMounts={mcpMounts}
            skillMounts={skillMounts}
            saving={saving}
            error={error}
            onNameChange={setName}
            onChange={setDraftSpec}
            onEdit={setEditor}
            onToggleMcpPreload={toggleMcpPreload}
            onRemoveMcp={removeMcp}
            onCancel={close}
            onSave={() => void save()}
          />
        ) : null}
      </CenteredModal>

      {draftSpec ? (
        <AgentConfigEditors
          editor={editor}
          spec={draftSpec}
          models={catalog.models}
          connectors={catalog.connectors}
          skills={catalog.skills}
          loading={catalog.loading}
          error={catalog.error}
          skillsDisabled={serverCapabilities?.skill.enabled !== true}
          sandboxAvailable={serverCapabilities?.sandbox.enabled === true}
          loadMcpTools={loadMcpTools}
          onRefreshConnectors={catalog.refreshConnectors}
          onChange={setDraftSpec}
          onClose={() => setEditor(null)}
        />
      ) : null}
    </>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    SaveAgentButton: typeof SaveAgentButton;
  }
}
