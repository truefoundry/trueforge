'use client';

import {
  useTrueFoundryAdoptAgentSpec,
  useTrueFoundryAgentSpec,
  useTrueFoundryFlushAgentSpec,
} from '@truefoundry/assistant-ui-runtime';
import { useRef, useState } from 'react';

import { useSaveAgentVisible } from '../hooks/useChatChromeActionsVisible.js';
import { useResourcePermissions } from '../hooks/useResourcePermissions.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalServer } from '../server/ServerContext.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import type { AgentSpec } from '../server/types.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { getErrorMessage } from '../utils/getErrorMessage.js';
import { useOptionalAgentConfigInstructions } from './draft/AgentConfigInstructionsContext.js';
import { Button } from './primitives/Button.js';
import { SideDrawer } from './primitives/SideDrawer.js';

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
    <SaveAgentButtonContent disabled={disabled} className={className} instructionsOverride={instructionsOverride}>
      {children}
    </SaveAgentButtonContent>
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
  const agentId = shell?.mode.status === 'active' ? shell.mode.agentId : undefined;
  const { allows } = useResourcePermissions({
    resourceType: 'agent',
    resourceIds: agentId == null ? [] : [agentId],
  });
  const canManageAgent = allows(agentId, 'MANAGE');
  const configInstructions = useOptionalAgentConfigInstructions();
  const SaveAgentForm = useSlot('SaveAgentForm');
  const PermissionGuard = useSlot('PermissionGuard');
  const visible = useSaveAgentVisible();
  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState<SaveIntent>('create');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [draftSpec, setDraftSpec] = useState<AgentSpec | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (saving) return;
    setOpen(false);
    setDescription('');
    setDraftSpec(null);
    setError(null);
  };

  const show = async () => {
    if (agentSpecRef.current === null || builder === null) return;
    if (agentId != null && !canManageAgent) return;
    setError(null);
    configInstructions?.flush();
    await flushAgentSpec();
    const flushedAgentSpec = agentSpecRef.current;
    if (flushedAgentSpec === null) return;
    const instructionsDraft = instructionsOverride ?? configInstructions?.draft;
    const latestAgentSpec =
      instructionsDraft === undefined ? flushedAgentSpec : { ...flushedAgentSpec, instructions: instructionsDraft };
    const currentName = shell?.mode.status === 'active' ? (shell.mode.agentName ?? shell.mode.agentId ?? '') : '';
    setIntent(currentName ? 'update' : 'create');
    setName(currentName);
    setDescription(currentName && shell?.mode.status === 'active' ? (shell.mode.description ?? '') : '');
    setDraftSpec(cloneAgentSpec(latestAgentSpec));
    setOpen(true);
  };

  const save = async () => {
    if (builder === null || draftSpec === null) return;
    if (intent === 'update' && !canManageAgent) return;
    const normalizedName = name.trim();
    if (!normalizedName || !draftSpec.model.name.trim()) return;
    const normalizedDescription = description.trim();
    if (!normalizedDescription) return;
    setSaving(true);
    setError(null);
    try {
      const result = await builder.saveAgent({
        agentName: normalizedName,
        ...(normalizedDescription ? { description: normalizedDescription } : {}),
        agentSpec: draftSpec,
        intent,
        sessionId: draftSessionId,
      });
      adoptAgentSpec({ agentSpec: draftSpec, updatedAt: result.sessionUpdatedAt });
      shell?.bindMutableAgent({
        agentId: result.agentId ?? normalizedName,
        agentName: normalizedName,
        ...(normalizedDescription ? { description: normalizedDescription } : {}),
        agentSpec: draftSpec,
      });
      shell?.invalidateAgentsList();
      setOpen(false);
      setDescription('');
      setDraftSpec(null);
    } catch (caught) {
      setError(getErrorMessage(caught, 'Could not save agent'));
    } finally {
      setSaving(false);
    }
  };

  const isUpdateMode =
    shell?.mode.status === 'active' &&
    shell.mode.isMutable &&
    (shell.mode.agentName !== undefined || shell.mode.agentId !== undefined);
  const triggerLabel = isUpdateMode && children === 'Save Agent' ? 'Update Agent' : children;

  if (!visible) return null;

  return (
    <>
      <PermissionGuard allowed={canManageAgent}>
        <Button.Primary
          type="button"
          size="large"
          disabled={disabled || builder === null || agentSpec === null}
          className={className}
          onClick={() => void show()}
        >
          <Icon name="save" className="size-3.5" />
          {triggerLabel}
        </Button.Primary>
      </PermissionGuard>

      <SideDrawer
        open={open}
        onOpenChange={next => !next && close()}
        title={intent === 'create' ? 'Save agent' : 'Update agent'}
        anchor="right"
        size="md"
        aria-label={intent === 'create' ? 'Save agent' : 'Update agent'}
      >
        {draftSpec ? (
          <SaveAgentForm
            intent={intent}
            name={name}
            description={description}
            spec={draftSpec}
            saving={saving}
            error={error}
            onNameChange={setName}
            onDescriptionChange={setDescription}
            onCancel={close}
            onSave={() => void save()}
          />
        ) : null}
      </SideDrawer>
    </>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    SaveAgentButton: typeof SaveAgentButton;
  }
}
