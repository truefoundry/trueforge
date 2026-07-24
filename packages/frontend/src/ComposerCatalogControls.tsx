import { useTrueFoundryAgentSpec, useTrueFoundryUpdateAgentSpec } from '@truefoundry/assistant-ui-runtime';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useServerCapabilities } from './capabilities';
import {
  listMcpServers,
  listModels,
  listSkills,
  type McpServerEntry,
  type ModelEntry,
  type SkillEntry,
} from './catalog';
import { ChevronDownIcon, SearchIcon, SparklesIcon } from './icons';
import { setSelectedSkillNames, useSelectedSkillNames } from './skillsSelection';

export type CatalogTab = 'connectors' | 'skills' | 'attachment';

type Mode = 'panel' | 'model' | 'sandbox' | 'skills-chip';

interface Props {
  mode?: Mode;
  disabled?: boolean;
  isRunning?: boolean;
  initialTab?: CatalogTab;
  onAttach?: () => void;
  onOpenPanel?: (tab: CatalogTab) => void;
}

function shortModelName(name: string): string {
  const parts = name.split('/');
  return parts[parts.length - 1] ?? name;
}

function initialFor(name: string): string {
  return shortModelName(name).slice(0, 1).toUpperCase();
}

/**
 * Composer catalog UI: model chip, skills chip, or Connectors/Skills/Attachment panel.
 * Skills selection is local-only — harness rejects agent_spec.skills for now.
 */
export function ComposerCatalogControls({
  mode = 'panel',
  disabled = false,
  initialTab = 'connectors',
  onAttach,
  onOpenPanel,
}: Props) {
  const capabilities = useServerCapabilities();
  const { agentSpec } = useTrueFoundryAgentSpec();
  const updateAgentSpec = useTrueFoundryUpdateAgentSpec();
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerEntry[]>([]);
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<CatalogTab>(initialTab);
  const selectedSkillNames = useSelectedSkillNames();
  const sandboxSelected = agentSpec?.config?.sandbox?.enabled === true;
  const sandboxAvailable = capabilities.sandbox.enabled;
  const skillsDisabled = disabled || !sandboxSelected;
  const [modelOpen, setModelOpen] = useState(false);
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const modelRootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const state = { cancelled: false };
    void (async () => {
      try {
        const [nextModels, nextMcp, nextSkills] = await Promise.all([listModels(), listMcpServers(), listSkills()]);
        if (state.cancelled) return;
        setModels(nextModels);
        setMcpServers(nextMcp);
        setSkills(nextSkills);
        setError(null);
      } catch (err) {
        if (!state.cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load catalogs');
        }
      }
    })();
    return () => {
      state.cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!modelOpen && !reasoningOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!modelRootRef.current?.contains(event.target as Node)) {
        setModelOpen(false);
        setReasoningOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [modelOpen, reasoningOpen]);

  // Fall back to connectors when sandbox is turned off while the skills tab is open.
  const activeTab: CatalogTab = !sandboxSelected && tab === 'skills' ? 'connectors' : tab;

  const selectedModel = agentSpec?.model.name ?? '';
  const selectedMcp = useMemo(
    () => new Set((agentSpec?.mcpServers ?? []).map(server => server.name)),
    [agentSpec?.mcpServers],
  );

  const filteredMcp = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return mcpServers;
    return mcpServers.filter(server => server.name.toLowerCase().includes(q) || server.url.toLowerCase().includes(q));
  }, [mcpServers, query]);

  const filteredSkills = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(skill => skill.name.toLowerCase().includes(q) || skill.description.toLowerCase().includes(q));
  }, [skills, query]);

  const applyMcpSelection = (nextNames: Set<string>) => {
    updateAgentSpec({
      mcpServers: [...nextNames].map(name => ({
        type: 'truefoundry-mcp-registry' as const,
        name,
        enableTools: ['@all' as const],
      })),
    });
  };

  if (mode === 'sandbox') {
    const unavailableReason = 'Sandbox is not configured on this server.';
    return (
      <button
        type="button"
        className="chip-btn chip-btn-outline"
        disabled={disabled}
        aria-disabled={!sandboxAvailable || undefined}
        data-disabled={!sandboxAvailable || undefined}
        data-active={sandboxSelected || undefined}
        title={!sandboxAvailable ? unavailableReason : sandboxSelected ? 'Disable sandbox' : 'Enable sandbox'}
        onClick={() => {
          if (!sandboxAvailable) return;
          const enabled = !sandboxSelected;
          updateAgentSpec({
            config: {
              ...agentSpec?.config,
              sandbox: {
                ...agentSpec?.config?.sandbox,
                enabled,
              },
            },
          });
          if (!enabled) setSelectedSkillNames(new Set());
        }}
      >
        <span className="sandbox-status" aria-hidden />
        <span>Sandbox</span>
      </button>
    );
  }

  if (mode === 'model') {
    const model = models.find(entry => entry.name === selectedModel);
    const reasoningEfforts = model?.reasoning_efforts ?? [];
    const configuredReasoningEffort = agentSpec?.model.params?.reasoningEffort;
    const selectedReasoningEffort =
      configuredReasoningEffort && reasoningEfforts.includes(configuredReasoningEffort)
        ? configuredReasoningEffort
        : reasoningEfforts[0];

    return (
      <div ref={modelRootRef} className="model-controls">
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className="chip-btn"
            disabled={disabled || models.length === 0}
            data-open={modelOpen || undefined}
            onClick={() => {
              setReasoningOpen(false);
              setModelOpen(open => !open);
            }}
          >
            <SparklesIcon />
            <span>{selectedModel ? shortModelName(selectedModel) : 'Model'}</span>
            <ChevronDownIcon />
          </button>
          {modelOpen ? (
            <div className="popover popover-right" role="listbox" aria-label="Models">
              <div className="model-menu">
                {models.map(entry => {
                  const nextReasoningEffort = entry.reasoning_efforts?.[0];
                  const nextParams = { ...agentSpec?.model.params };
                  if (nextReasoningEffort) nextParams.reasoningEffort = nextReasoningEffort;
                  else delete nextParams.reasoningEffort;
                  return (
                    <button
                      key={entry.name}
                      type="button"
                      data-active={entry.name === selectedModel || undefined}
                      onClick={() => {
                        updateAgentSpec({
                          model: {
                            name: entry.name,
                            params: nextParams,
                          },
                        });
                        setModelOpen(false);
                      }}
                    >
                      {shortModelName(entry.name)}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
        {selectedReasoningEffort ? (
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="chip-btn reasoning-chip"
              disabled={disabled}
              data-open={reasoningOpen || undefined}
              onClick={() => {
                setModelOpen(false);
                setReasoningOpen(open => !open);
              }}
            >
              <span>{selectedReasoningEffort}</span>
              <ChevronDownIcon />
            </button>
            {reasoningOpen ? (
              <div className="popover popover-right reasoning-popover" role="listbox" aria-label="Reasoning effort">
                <div className="model-menu">
                  {reasoningEfforts.map(effort => (
                    <button
                      key={effort}
                      type="button"
                      data-active={effort === selectedReasoningEffort || undefined}
                      onClick={() => {
                        updateAgentSpec({
                          model: {
                            params: {
                              ...agentSpec?.model.params,
                              reasoningEffort: effort,
                            },
                          },
                        });
                        setReasoningOpen(false);
                      }}
                    >
                      {effort}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  if (mode === 'skills-chip') {
    const selectedCount = selectedSkillNames.size;
    // Disabling sandbox clears skill selection, so a visible chip implies sandbox is on.
    if (selectedCount === 0) return null;
    return (
      <button
        type="button"
        className="chip-btn chip-btn-outline"
        disabled={disabled}
        onClick={() => {
          onOpenPanel?.('skills');
        }}
      >
        <span className="chip-doc-icon" aria-hidden />
        <span>{`${String(selectedCount)} Skills`}</span>
      </button>
    );
  }

  const mcpAllSelected = filteredMcp.length > 0 && filteredMcp.every(server => selectedMcp.has(server.name));
  const skillsAllSelected =
    filteredSkills.length > 0 && filteredSkills.every(skill => selectedSkillNames.has(skill.name));

  return (
    <>
      <div className="popover-tabs">
        <button
          type="button"
          className="popover-tab"
          data-active={activeTab === 'connectors' || undefined}
          onClick={() => {
            setTab('connectors');
            setQuery('');
          }}
        >
          Connectors{mcpServers.length > 0 ? ` ${String(mcpServers.length)}` : ''}
        </button>
        <button
          type="button"
          className="popover-tab"
          data-active={activeTab === 'skills' || undefined}
          disabled={skillsDisabled}
          title={!sandboxSelected ? 'Enable sandbox to use skills.' : undefined}
          onClick={() => {
            setTab('skills');
            setQuery('');
          }}
        >
          Skills{skills.length > 0 ? ` ${String(skills.length)}` : ''}
        </button>
        <button
          type="button"
          className="popover-tab"
          data-active={activeTab === 'attachment' || undefined}
          disabled={!onAttach}
          onClick={() => {
            setTab('attachment');
            onAttach?.();
          }}
        >
          Attachment
        </button>
      </div>

      <div className="popover-body">
        {!sandboxSelected ? (
          <div className="popover-capability-note" role="note">
            Enable sandbox to use skills.
          </div>
        ) : null}

        {activeTab === 'connectors' ? (
          <>
            <label className="popover-search">
              <SearchIcon width={16} height={16} />
              <input
                value={query}
                onChange={event => {
                  setQuery(event.target.value);
                }}
                placeholder="Search connectors..."
                disabled={disabled}
              />
            </label>
            <div className="popover-meta">
              <span>SELECTED ({selectedMcp.size})</span>
              <label>
                <input
                  type="checkbox"
                  checked={mcpAllSelected}
                  disabled={disabled || filteredMcp.length === 0}
                  onChange={event => {
                    const next = new Set(selectedMcp);
                    if (event.target.checked) {
                      for (const server of filteredMcp) next.add(server.name);
                    } else {
                      for (const server of filteredMcp) next.delete(server.name);
                    }
                    applyMcpSelection(next);
                  }}
                />
                Select all
              </label>
            </div>
            <div className="popover-list">
              {filteredMcp.length === 0 ? (
                <div className="popover-list-empty">{error ?? 'No connectors yet.'}</div>
              ) : (
                filteredMcp.map(server => (
                  <label key={server.name} className="popover-row">
                    <span className="popover-avatar">{initialFor(server.name)}</span>
                    <span className="popover-row-text">
                      <strong>{server.name}</strong>
                      <span>{server.url}</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={selectedMcp.has(server.name)}
                      disabled={disabled}
                      onChange={event => {
                        const next = new Set(selectedMcp);
                        if (event.target.checked) next.add(server.name);
                        else next.delete(server.name);
                        applyMcpSelection(next);
                      }}
                    />
                  </label>
                ))
              )}
            </div>
          </>
        ) : null}

        {activeTab === 'skills' ? (
          <>
            <label className="popover-search">
              <SearchIcon width={16} height={16} />
              <input
                value={query}
                onChange={event => {
                  setQuery(event.target.value);
                }}
                placeholder="Search skills..."
                disabled={skillsDisabled}
              />
            </label>
            <div className="popover-meta">
              <span>AVAILABLE ({skills.length})</span>
              <label>
                <input
                  type="checkbox"
                  checked={skillsAllSelected}
                  disabled={skillsDisabled || filteredSkills.length === 0}
                  onChange={event => {
                    const next = new Set(selectedSkillNames);
                    if (event.target.checked) {
                      for (const skill of filteredSkills) next.add(skill.name);
                    } else {
                      for (const skill of filteredSkills) next.delete(skill.name);
                    }
                    setSelectedSkillNames(next);
                  }}
                />
                Select all
              </label>
            </div>
            <div className="popover-list">
              {filteredSkills.length === 0 ? (
                <div className="popover-list-empty">{error ?? 'No skills yet.'}</div>
              ) : (
                filteredSkills.map(skill => (
                  <label key={skill.name} className="popover-row" data-disabled={skillsDisabled || undefined}>
                    <span className="popover-avatar popover-avatar-doc" aria-hidden />
                    <span className="popover-row-text">
                      <strong>{skill.name}</strong>
                      <span>{skill.description}</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={selectedSkillNames.has(skill.name)}
                      disabled={skillsDisabled}
                      onChange={event => {
                        const next = new Set(selectedSkillNames);
                        if (event.target.checked) next.add(skill.name);
                        else next.delete(skill.name);
                        setSelectedSkillNames(next);
                      }}
                    />
                  </label>
                ))
              )}
            </div>
          </>
        ) : null}

        {activeTab === 'attachment' ? (
          <p className="popover-hint">Attachments open the file picker when available.</p>
        ) : null}
      </div>
    </>
  );
}
