'use client';

import {
  useTrueFoundryAdoptAgentSpec,
  useTrueFoundryAgentSpec,
  useTrueFoundryFlushAgentSpec,
} from '@truefoundry/assistant-ui-runtime';
import { useId, useMemo, useRef, useState } from 'react';
import { useSaveAgentVisible } from '../hooks/useChatChromeActionsVisible.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalServer, useServerCapabilities } from '../server/ServerContext.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import type { AgentSpec } from '../server/types.js';
import { getErrorMessage } from '../utils/getErrorMessage.js';
import { readAgentCapabilities, withAgentCapabilities } from './draft/agentCapabilities.js';
import { DraftCapabilitiesPanel } from './draft/DraftCapabilitiesPanel.js';
import { DraftCatalogProvider, useDraftCatalog } from './draft/DraftCatalogProvider.js';
import { CatalogRow, ConnectorConnectButton, isUnauthenticatedDcrConnector } from './draft/DraftCompositeSelector.js';
import { displayModelLabel, DraftModelCatalogPanel } from './draft/DraftModelCatalogPanel.js';
import { modelPatchWithReasoningEffort } from './draft/reasoningEffort.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { auiInputClass } from './lib/inputClasses.js';
import { CenteredModal } from './primitives/CenteredModal.js';

type SaveIntent = 'create' | 'update';
type Editor = 'model' | 'mcp' | 'skills';
type EditableMount = { id: string; name: string; value: object };

function editableMountsFromSpec(value: unknown): EditableMount[] {
  if (!Array.isArray(value)) return [];
  const mounts: EditableMount[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const name = Reflect.get(item, 'name');
    if (typeof name !== 'string') continue;
    const id = Reflect.get(item, 'id');
    mounts.push({ id: typeof id === 'string' ? id : name, name, value: item });
  }
  return mounts;
}

function SummarySection({
  icon,
  title,
  value,
  onEdit,
  disabled,
}: {
  icon: string;
  title: string;
  value: string;
  onEdit: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-5 py-3.5 last:border-b-0">
      <Icon name={icon} className="text-text-secondary size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-text-primary text-sm font-medium">{title}</p>
        <p className="text-text-secondary mt-0.5 truncate text-xs">{value}</p>
      </div>
      <button
        type="button"
        aria-label={`Edit ${title}`}
        disabled={disabled}
        className={auiButtonClass({ variant: 'ghost', size: 'icon', className: 'size-8' })}
        onClick={onEdit}
      >
        <Icon name="pencil" className="size-3.5" />
      </button>
    </div>
  );
}

export type SaveAgentButtonProps = {
  disabled?: boolean;
  className?: string;
  children?: string;
};

export function SaveAgentButton({ disabled = false, className, children = 'Save Agent' }: SaveAgentButtonProps) {
  return (
    <DraftCatalogProvider>
      <SaveAgentButtonContent disabled={disabled} className={className}>
        {children}
      </SaveAgentButtonContent>
    </DraftCatalogProvider>
  );
}

function SaveAgentButtonContent({
  disabled,
  className,
  children,
}: {
  disabled: boolean;
  className?: string;
  children: string;
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
  const modelListId = useId();
  const visible = useSaveAgentVisible();
  const [open, setOpen] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [intent, setIntent] = useState<SaveIntent>('create');
  const [name, setName] = useState('');
  const [draftSpec, setDraftSpec] = useState<AgentSpec | null>(null);
  const [modelQuery, setModelQuery] = useState('');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mcpMounts = useMemo(() => editableMountsFromSpec(draftSpec?.mcpServers), [draftSpec?.mcpServers]);
  const skillMounts = useMemo(() => editableMountsFromSpec(draftSpec?.skills), [draftSpec?.skills]);

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
    const latestAgentSpec = agentSpecRef.current;
    if (latestAgentSpec === null) return;
    const currentName = shell?.mode.status === 'active' ? (shell.mode.agentName ?? shell.mode.agentId ?? '') : '';
    setIntent(currentName ? 'update' : 'create');
    setName(currentName);
    setDraftSpec({
      ...latestAgentSpec,
      model: {
        ...latestAgentSpec.model,
        params: latestAgentSpec.model.params ? { ...latestAgentSpec.model.params } : undefined,
      },
      mcpServers: latestAgentSpec.mcpServers?.map(item => ({ ...item })),
      skills: latestAgentSpec.skills?.map(item => ({ ...item })),
      config: latestAgentSpec.config ? { ...latestAgentSpec.config } : undefined,
    });
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

  const filteredConnectors = catalog.connectors.filter(item =>
    `${item.name} ${item.description ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const filteredSkills = catalog.skills.filter(item =>
    `${item.name} ${item.description ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const isUpdateMode =
    shell?.mode.status === 'active' &&
    shell.mode.isMutable &&
    (shell.mode.agentName !== undefined || shell.mode.agentId !== undefined);
  const triggerLabel = isUpdateMode && children === 'Save Agent' ? 'Update Agent' : children;

  if (!visible) return null;

  return (
    <>
      <button
        type="button"
        disabled={disabled || builder === null || agentSpec === null}
        className={auiButtonClass({ variant: 'outline', size: 'sm', className })}
        onClick={() => void show()}
      >
        {triggerLabel}
      </button>

      <CenteredModal
        open={open}
        onOpenChange={next => !next && close()}
        title={intent === 'create' ? 'Save agent' : 'Update agent'}
        description="Review the configuration before saving."
        className="md:max-w-lg"
        aria-label={intent === 'create' ? 'Save agent' : 'Update agent'}
      >
        {draftSpec ? (
          <div className="flex min-h-0 w-[min(32rem,calc(100vw-2rem))] flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <label className="mb-4 block">
                <span className="mb-1.5 block text-sm font-medium">Agent name</span>
                <input
                  value={name}
                  disabled={saving || intent === 'update'}
                  onChange={event => setName(event.target.value)}
                  placeholder="release-notes"
                  className={auiInputClass('h-9 disabled:opacity-60')}
                />
              </label>

              <label className="mb-4 block">
                <span className="mb-1.5 block text-sm font-medium">Instructions</span>
                <textarea
                  value={draftSpec.instructions ?? ''}
                  disabled={saving}
                  onChange={event => setDraftSpec({ ...draftSpec, instructions: event.target.value })}
                  rows={4}
                  placeholder="You are a release notes writer for a platform team."
                  className={auiInputClass('resize-y py-2 disabled:opacity-60')}
                />
              </label>

              <div className="mb-4">
                <h3 className="mb-2 text-sm font-medium">Configuration</h3>
                <div className="overflow-hidden rounded-xl border border-border">
                  <SummarySection
                    icon="cpu"
                    title="Model"
                    value={draftSpec.model.name ? displayModelLabel(draftSpec.model.name) : 'Not selected'}
                    disabled={saving}
                    onEdit={() => setEditor('model')}
                  />
                  <SummarySection
                    icon="plug"
                    title="Connectors"
                    value={`${mcpMounts.length} selected`}
                    disabled={saving}
                    onEdit={() => setEditor('mcp')}
                  />
                  <SummarySection
                    icon="lightbulb"
                    title="Skills"
                    value={`${skillMounts.length} selected`}
                    disabled={saving}
                    onEdit={() => setEditor('skills')}
                  />
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-medium">Capabilities</h3>
                <DraftCapabilitiesPanel
                  divided
                  value={readAgentCapabilities(draftSpec.config)}
                  disabled={saving}
                  onChange={values =>
                    setDraftSpec({
                      ...draftSpec,
                      config: withAgentCapabilities({ config: draftSpec.config, values }),
                    })
                  }
                />
              </div>

              {error ? (
                <p role="alert" className="text-failure-bg mt-3 text-sm">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="bg-card-bg sticky bottom-0 z-10 flex shrink-0 justify-end gap-2 border-t border-border px-5 py-4">
              <button
                type="button"
                disabled={saving}
                className={auiButtonClass({ variant: 'secondary' })}
                onClick={close}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving || !name.trim() || !draftSpec.model.name.trim()}
                className={auiButtonClass({ variant: 'default' })}
                onClick={() => void save()}
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        ) : null}
      </CenteredModal>

      <CenteredModal
        open={editor !== null}
        onOpenChange={next => {
          if (!next) {
            setEditor(null);
            setSearch('');
            setModelQuery('');
          }
        }}
        title={editor === 'model' ? 'Select model' : editor === 'mcp' ? 'Connectors' : 'Skills'}
        className="md:max-w-md"
        contentSized
        aria-label={editor === 'model' ? 'Edit model' : editor === 'mcp' ? 'Edit Connectors' : 'Edit skills'}
      >
        {draftSpec && editor ? (
          <div className="flex h-[min(28rem,calc(100dvh-10rem))] w-[min(28rem,calc(100vw-2rem))] flex-col">
            {editor === 'model' ? (
              <>
                {catalog.error ? (
                  <p role="alert" className="text-failure-bg px-3 pt-3 text-sm">
                    {catalog.error}
                  </p>
                ) : null}
                <DraftModelCatalogPanel
                  models={catalog.models}
                  loading={catalog.loading}
                  selectedName={draftSpec.model.name}
                  query={modelQuery}
                  onQueryChange={setModelQuery}
                  listboxId={modelListId}
                  showHeading={false}
                  onSelect={nextModel => {
                    setDraftSpec({
                      ...draftSpec,
                      model: modelPatchWithReasoningEffort(
                        nextModel.name,
                        draftSpec.model.params,
                        nextModel.properties.reasoningEfforts,
                      ),
                    });
                  }}
                />
              </>
            ) : (
              <>
                {catalog.error ? (
                  <p role="alert" className="text-failure-bg px-3 pt-3 text-sm">
                    {catalog.error}
                  </p>
                ) : null}
                <div className="border-b border-border p-3">
                  <label className="relative block">
                    <Icon
                      name="search"
                      className="text-text-secondary pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2"
                    />
                    <input
                      value={search}
                      onChange={event => setSearch(event.target.value)}
                      placeholder={editor === 'mcp' ? 'Search connectors' : 'Search skills'}
                      className={auiInputClass('h-8 pr-2 pl-7')}
                      autoFocus
                    />
                  </label>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                  {editor === 'mcp'
                    ? filteredConnectors.map(connector => {
                        const checked = mcpMounts.some(item => item.id === connector.id);
                        const needsConnect = isUnauthenticatedDcrConnector(connector);
                        return (
                          <CatalogRow
                            key={connector.id}
                            title={connector.name}
                            description={connector.description}
                            checked={checked}
                            disabled={!connector.authenticated && !checked}
                            action={
                              needsConnect ? (
                                <ConnectorConnectButton connector={connector} onConnected={catalog.refreshConnectors} />
                              ) : undefined
                            }
                            onToggle={() => {
                              if (!connector.authenticated && !checked) return;
                              const next = checked
                                ? mcpMounts.filter(item => item.id !== connector.id)
                                : [
                                    ...mcpMounts,
                                    {
                                      id: connector.id,
                                      name: connector.name,
                                      value: { id: connector.id, name: connector.name },
                                    },
                                  ];
                              setDraftSpec({
                                ...draftSpec,
                                mcpServers: next.map(item => item.value),
                              });
                            }}
                          />
                        );
                      })
                    : filteredSkills.map(skill => {
                        const checked = skillMounts.some(item => item.id === skill.id);
                        const disabledSkill = serverCapabilities?.skill.enabled !== true;
                        return (
                          <CatalogRow
                            key={skill.id}
                            title={skill.name}
                            description={skill.description}
                            checked={checked}
                            disabled={disabledSkill && !checked}
                            onToggle={() => {
                              if (disabledSkill && !checked) return;
                              const next = checked
                                ? skillMounts.filter(item => item.id !== skill.id)
                                : [
                                    ...skillMounts,
                                    {
                                      id: skill.id,
                                      name: skill.name,
                                      value: { id: skill.id, name: skill.name },
                                    },
                                  ];
                              setDraftSpec({
                                ...draftSpec,
                                skills: next.map(item => item.value),
                              });
                            }}
                          />
                        );
                      })}
                </div>
              </>
            )}
            <div className="bg-card-bg sticky bottom-0 z-10 flex shrink-0 justify-end border-t border-border px-5 py-4">
              <button
                type="button"
                className={auiButtonClass({ variant: 'default' })}
                onClick={() => {
                  setEditor(null);
                  setSearch('');
                  setModelQuery('');
                }}
              >
                Continue
              </button>
            </div>
          </div>
        ) : null}
      </CenteredModal>
    </>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    SaveAgentButton: typeof SaveAgentButton;
  }
}
