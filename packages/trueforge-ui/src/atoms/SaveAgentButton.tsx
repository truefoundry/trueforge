'use client';

import {
  useTrueFoundryAdoptAgentSpec,
  useTrueFoundryAgentSpec,
  useTrueFoundryFlushAgentSpec,
} from '@truefoundry/assistant-ui-runtime';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { displayModelLabel, DraftModelCatalogPanel, ProviderMark } from './draft/DraftModelCatalogPanel.js';
import { modelPatchWithReasoningEffort } from './draft/reasoningEffort.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';
import { auiInputClass } from './lib/inputClasses.js';
import { CenteredModal } from './primitives/CenteredModal.js';
import { Tooltip } from './primitives/Tooltip.js';

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

function ConfigSection({
  label,
  onEdit,
  disabled,
  children,
}: {
  label: string;
  onEdit: () => void;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-text-secondary text-xs font-semibold tracking-wide uppercase">{label}</span>
        <button
          type="button"
          aria-label={`Edit ${label}`}
          disabled={disabled}
          className={auiButtonClass({ variant: 'ghost', size: 'icon', className: 'size-7' })}
          onClick={onEdit}
        >
          <Icon name="pencil" className="size-3.5" />
        </button>
      </div>
      {children}
    </div>
  );
}

const PRELOAD_TOOLS_COPY = {
  header: 'Preload tools',
  on: 'Tool definitions load into context upfront. No discovery step, but uses more context.',
  off: 'The agent discovers tools on demand. Lighter context upfront, but a discovery step the first time it needs a tool.',
} as const;

function PreloadToggle({ on, disabled, onToggle }: { on: boolean; disabled: boolean; onToggle: () => void }) {
  const label = `${PRELOAD_TOOLS_COPY.header} · ${on ? 'ON' : 'OFF'}`;
  const body = on ? PRELOAD_TOOLS_COPY.on : PRELOAD_TOOLS_COPY.off;
  return (
    <Tooltip
      className="max-w-[17rem] whitespace-normal"
      content={
        <div className="text-left">
          <p className="mb-1 text-[11px] font-semibold tracking-wide uppercase">{label}</p>
          <p className="text-xs leading-snug">{body}</p>
        </div>
      }
    >
      <button
        type="button"
        aria-label={label}
        aria-pressed={on}
        disabled={disabled}
        onClick={onToggle}
        className={cn(
          'flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md border',
          'transition-[color,background-color,border-color,transform] active:scale-90',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/40',
          'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
          on
            ? 'border-primary-button-bg/40 bg-primary-button-bg/10 text-primary-button-bg hover:border-primary-button-bg/70 hover:bg-primary-button-bg/20'
            : 'border-border text-text-secondary hover:border-text-secondary/50 hover:bg-text-secondary/10 hover:text-text-primary',
        )}
      >
        <Icon name="book-open" className="size-3.5" />
      </button>
    </Tooltip>
  );
}

function MountChips({
  mounts,
  disabled,
  emptyLabel,
  onTogglePreload,
}: {
  mounts: EditableMount[];
  disabled: boolean;
  emptyLabel: string;
  onTogglePreload?: (id: string) => void;
}) {
  if (mounts.length === 0) {
    return <p className="text-text-secondary text-xs">{emptyLabel}</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {mounts.map(mount => {
        const on = Boolean((mount.value as { preload?: boolean }).preload);
        return (
          <span
            key={mount.id}
            className={cn(
              'border-border flex items-center gap-2 rounded-lg border py-1 pr-2.5',
              onTogglePreload ? 'pl-1.5' : 'pl-2.5',
            )}
          >
            {onTogglePreload ? (
              <PreloadToggle on={on} disabled={disabled} onToggle={() => onTogglePreload(mount.id)} />
            ) : null}
            <span className="text-text-primary text-sm">{mount.name}</span>
          </span>
        );
      })}
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
  const errorRef = useRef<HTMLParagraphElement>(null);

  const mcpMounts = useMemo(() => editableMountsFromSpec(draftSpec?.mcpServers), [draftSpec?.mcpServers]);
  const skillMounts = useMemo(() => editableMountsFromSpec(draftSpec?.skills), [draftSpec?.skills]);
  const modelEntry = useMemo(
    () => catalog.models.find(model => model.name === draftSpec?.model.name),
    [catalog.models, draftSpec?.model.name],
  );

  useEffect(() => {
    if (error === null) return;
    // scrollIntoView is unimplemented in jsdom; guard so tests don't throw.
    errorRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [error]);

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

  const toggleMcpPreload = (id: string) => {
    if (draftSpec === null) return;
    const next = (draftSpec.mcpServers ?? []).map(item => {
      const record = item as Record<string, unknown>;
      const itemId = typeof record.id === 'string' ? record.id : (record.name as string);
      return itemId === id ? ({ ...record, preload: record.preload !== true } as typeof item) : item;
    });
    setDraftSpec({ ...draftSpec, mcpServers: next });
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
          <div className="flex min-h-0 w-full flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
              <label className="mb-3 block">
                <span className="mb-1.5 block text-sm font-medium">Agent name</span>
                <input
                  value={name}
                  disabled={saving || intent === 'update'}
                  onChange={event => setName(event.target.value)}
                  placeholder="release-notes"
                  className={auiInputClass('h-9 disabled:opacity-60')}
                />
              </label>

              <label className="mb-3 block">
                <span className="mb-1.5 block text-sm font-medium">Instructions</span>
                <textarea
                  value={draftSpec.instructions ?? ''}
                  disabled={saving}
                  onChange={event => setDraftSpec({ ...draftSpec, instructions: event.target.value })}
                  rows={5}
                  placeholder="You are a release notes writer for a platform team."
                  className={auiInputClass('resize-y py-2 disabled:opacity-60')}
                />
              </label>

              <ConfigSection label="Model" onEdit={() => setEditor('model')} disabled={saving}>
                {draftSpec.model.name ? (
                  <span className="border-border inline-flex items-center gap-2 rounded-lg border py-1 pr-2.5 pl-2">
                    <ProviderMark
                      logo={modelEntry?.provider.logo}
                      label={modelEntry?.provider.name ?? draftSpec.model.name}
                      className="size-5 text-[10px]"
                    />
                    <span className="text-text-primary text-sm">{displayModelLabel(draftSpec.model.name)}</span>
                  </span>
                ) : (
                  <p className="text-text-secondary text-xs">No model selected.</p>
                )}
              </ConfigSection>

              <ConfigSection label="Connectors" onEdit={() => setEditor('mcp')} disabled={saving}>
                <MountChips
                  mounts={mcpMounts}
                  disabled={saving}
                  emptyLabel="No connectors added."
                  onTogglePreload={toggleMcpPreload}
                />
              </ConfigSection>

              <ConfigSection label="Skills" onEdit={() => setEditor('skills')} disabled={saving}>
                <MountChips mounts={skillMounts} disabled={saving} emptyLabel="No skills added." />
              </ConfigSection>

              <div>
                <p className="text-text-secondary mb-1.5 text-xs font-semibold tracking-wide uppercase">Capabilities</p>
                <DraftCapabilitiesPanel
                  layout="cards"
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
                <p
                  ref={errorRef}
                  role="alert"
                  className="text-failure-bg mt-3 text-sm wrap-break-word whitespace-pre-wrap tab-4"
                >
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
