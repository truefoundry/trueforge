'use client';

import { useTrueFoundryAgentSpec, useTrueFoundryUpdateAgentSpec } from '@truefoundry/assistant-ui-runtime';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';

import { useMCPAuth } from '../../hooks/useMcpAuth.js';
import { Icon } from '../../icons/Icon.js';
import { useOptionalCatalogServer, useServerCapabilities } from '../../server/ServerContext.js';
import { useOptionalShellMode, type SettingsSection } from '../../server/ShellModeContext.js';
import type { AgentSkill, ConnectorState } from '../../server/types.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { cn } from '../lib/cn.js';
import { useCompactLayout } from '../lib/CompactLayoutContext.js';
import { auiInputClass } from '../lib/inputClasses.js';
import { useIsMobile } from '../lib/useIsMobile.js';
import { BottomSheet } from '../primitives/BottomSheet.js';
import { Tooltip } from '../primitives/Tooltip.js';
import { readAgentCapabilities, withAgentCapabilities } from './agentCapabilities.js';
import { DraftCapabilitiesPanel } from './DraftCapabilitiesPanel.js';
import { DraftCatalogEmptyState } from './DraftCatalogEmptyState.js';
import { useDraftCatalog } from './DraftCatalogProvider.js';

/** Catalog-backed mount shape used by the draft picker (runtime mounts stay opaque). */
export type DraftMount = { id: string; name: string };

/**
 * Harness wire mounts are name-keyed (`{ name }` only). Catalog rows use
 * `id === name`, so missing ids hydrate from name — otherwise save/load drops
 * mounts from the picker and the next flush can wipe them from the spec.
 */
export function draftMountsFromSpec(value: unknown): DraftMount[] {
  if (!Array.isArray(value)) return [];
  const mounts: DraftMount[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const name = Reflect.get(item, 'name');
    if (typeof name !== 'string') continue;
    const id = Reflect.get(item, 'id');
    mounts.push({ id: typeof id === 'string' ? id : name, name });
  }
  return mounts;
}
type AttachTab = 'connectors' | 'skills' | 'capabilities';

const TABS: { id: AttachTab; label: string; icon: string }[] = [
  { id: 'connectors', label: 'Connectors', icon: 'plug' },
  { id: 'skills', label: 'Skills', icon: 'lightbulb' },
  { id: 'capabilities', label: 'Capabilities', icon: 'wrench' },
];

const SPEC_FLUSH_MS = 300;

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded border',
        checked
          ? 'border-primary-button-bg bg-primary-button-bg text-primary-button-text'
          : 'border-input-border bg-input-box-bg',
      )}
      aria-hidden
    >
      {checked ? <Icon name="check" className="size-3" /> : null}
    </span>
  );
}

export function CatalogRow({
  title,
  description,
  checked,
  disabled = false,
  onToggle,
  action,
}: {
  title: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  action?: ReactNode;
}) {
  const content = (
    <>
      <span className="bg-secondary-bg text-text-secondary mt-0.5 flex size-7 shrink-0 items-center justify-center rounded text-xs font-semibold">
        {title.charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-text-primary block truncate text-sm font-medium">{title}</span>
        {description ? <span className="text-text-secondary line-clamp-1 text-xs">{description}</span> : null}
      </span>
    </>
  );

  if (action) {
    return (
      <div
        role="menuitemcheckbox"
        aria-checked={checked}
        tabIndex={0}
        className="hover:bg-ghost-button-hover flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left"
        onClick={onToggle}
        onKeyDown={event => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          onToggle();
        }}
      >
        {content}
        <span className="shrink-0">{action}</span>
        <Checkbox checked={checked} />
      </div>
    );
  }

  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      disabled={disabled}
      className="hover:bg-ghost-button-hover flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
      onClick={onToggle}
    >
      {content}
      {disabled ? <Icon name="lock" className="text-text-secondary size-3" /> : <Checkbox checked={checked} />}
    </button>
  );
}

export function isUnauthenticatedDcrConnector(connector: ConnectorState): boolean {
  const auth = Reflect.get(connector, 'auth');
  return (
    connector.authenticated === false &&
    typeof auth === 'object' &&
    auth !== null &&
    Reflect.get(auth, 'type') === 'dcr'
  );
}

export function ConnectorConnectButton({
  connector,
  onConnected,
}: {
  connector: ConnectorState;
  onConnected: () => Promise<void>;
}) {
  const { handleAuthorize, isOAuthLoading } = useMCPAuth();

  return (
    <button
      type="button"
      aria-label={`Connect ${connector.name}`}
      disabled={isOAuthLoading}
      className={auiButtonClass({ variant: 'secondary', size: 'sm' })}
      onKeyDown={event => {
        event.stopPropagation();
      }}
      onClick={event => {
        event.stopPropagation();
        void handleAuthorize(connector.id, isSuccess => {
          if (isSuccess) void onConnected();
        });
      }}
    >
      {isOAuthLoading ? 'Connecting...' : 'Connect'}
    </button>
  );
}

function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="relative mx-3 my-2 block">
      <Icon
        name="search"
        className="text-text-secondary pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2"
      />
      <input
        type="search"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={auiInputClass('h-8 bg-secondary-bg py-1 pr-2 pl-7 dark:bg-primary-bg')}
      />
    </label>
  );
}

export type DraftCompositeSelectorProps = {
  disabled?: boolean;
  isRunning?: boolean;
  onAttach?: () => void;
};

function SectionHeading({ label, count }: { label: string; count: number }) {
  return (
    <div className="text-text-secondary px-3 pt-2 pb-1 text-[11px] font-medium tracking-wide uppercase">
      {label} ({count})
    </div>
  );
}

export function DraftCompositeSelector({ disabled, isRunning, onAttach }: DraftCompositeSelectorProps) {
  const { skills, connectors, loading, ensureLoaded, refreshConnectors } = useDraftCatalog();
  const capabilities = useServerCapabilities();
  const settingsCatalog = useOptionalCatalogServer();
  const shell = useOptionalShellMode();
  const { agentSpec } = useTrueFoundryAgentSpec();
  const updateAgentSpec = useTrueFoundryUpdateAgentSpec();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<AttachTab>('connectors');
  const [query, setQuery] = useState('');
  // Section membership is snapped when the picker opens, so toggles don't jump rows mid-session.
  const [pinnedMcpIds, setPinnedMcpIds] = useState<Set<string>>(() => new Set());
  const [pinnedSkillIds, setPinnedSkillIds] = useState<Set<string>>(() => new Set());
  // Local working copy while open — flush to AgentSpec on debounce / close.
  const [localMcp, setLocalMcp] = useState<DraftMount[]>([]);
  const [localSkills, setLocalSkills] = useState<DraftMount[]>([]);
  const dirtyRef = useRef(false);
  const flushTimerRef = useRef<number | null>(null);
  const localMcpRef = useRef(localMcp);
  const localSkillsRef = useRef(localSkills);
  localMcpRef.current = localMcp;
  localSkillsRef.current = localSkills;

  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const isMobile = useIsMobile();
  const compactLayout = useCompactLayout();
  const skillsDisabled = capabilities?.skill.enabled !== true;
  const skillsDisabledReason = capabilities?.skill.reason;
  const needsSandbox = capabilities?.sandbox.enabled === false;
  const settingsEnabled = capabilities?.settings?.enabled !== false;
  const canConfigureConnectors = settingsEnabled && settingsCatalog?.connectorCatalog != null;
  const canConfigureSkills = settingsEnabled && settingsCatalog?.skillCatalog != null;
  const canConfigureSandbox = settingsEnabled && settingsCatalog?.sandboxCatalog != null;

  const specMcp = useMemo(() => draftMountsFromSpec(agentSpec?.mcpServers), [agentSpec?.mcpServers]);
  const specSkills = useMemo(() => draftMountsFromSpec(agentSpec?.skills), [agentSpec?.skills]);

  const selectedMcp = open ? localMcp : specMcp;
  const selectedSkills = open ? localSkills : specSkills;
  const selectedMcpIds = useMemo(() => new Set(selectedMcp.map(m => m.id)), [selectedMcp]);
  const selectedSkillIds = useMemo(() => new Set(selectedSkills.map(s => s.id)), [selectedSkills]);
  const hasValidModel = Boolean(agentSpec?.model?.name.trim());
  const toolsCount = selectedMcp.length + selectedSkills.length;
  const toolsTooltip = useMemo(() => {
    const formatNames = (items: Array<{ name: string }>) => {
      const names = items.map(item => item.name);
      if (names.length <= 4) return names.join(', ');
      return `${names.slice(0, 4).join(', ')} +${names.length - 4}`;
    };
    const lines: string[] = [];
    if (selectedMcp.length > 0) {
      lines.push(`Connectors: ${formatNames(selectedMcp)}`);
    }
    if (selectedSkills.length > 0) {
      lines.push(`Skills: ${formatNames(selectedSkills)}`);
    }
    return lines.length > 0 ? lines.join('\n') : 'No connectors or skills selected';
  }, [selectedMcp, selectedSkills]);

  const clearFlushTimer = useCallback(() => {
    if (flushTimerRef.current != null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  const flushSpec = useCallback(() => {
    clearFlushTimer();
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    updateAgentSpec?.({
      mcpServers: localMcpRef.current,
      skills: localSkillsRef.current,
    });
  }, [clearFlushTimer, updateAgentSpec]);

  const scheduleFlush = useCallback(() => {
    clearFlushTimer();
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      flushSpec();
    }, SPEC_FLUSH_MS);
  }, [clearFlushTimer, flushSpec]);

  const setOpenAndFlush = useCallback(
    (next: boolean) => {
      if (!next) flushSpec();
      setOpen(next);
    },
    [flushSpec],
  );

  useEffect(() => {
    if (open) ensureLoaded();
  }, [open, ensureLoaded]);

  useEffect(() => {
    if (open && !hasValidModel) {
      setOpenAndFlush(false);
    }
  }, [hasValidModel, open, setOpenAndFlush]);

  useEffect(() => {
    if (!open) return;
    // Flush on pointer or keyboard focus leaving the picker so Save Agent (and
    // other outside actions) see the latest local connector/skill toggles.
    const handler = (e: Event) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenAndFlush(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('focusin', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('focusin', handler);
    };
  }, [open, setOpenAndFlush]);

  useEffect(() => () => clearFlushTimer(), [clearFlushTimer]);

  const filteredConnectors = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = needle
      ? connectors.filter(
          c => c.name.toLowerCase().includes(needle) || (c.description?.toLowerCase().includes(needle) ?? false),
        )
      : connectors;
    return [...matches].sort(
      (left, right) => Number(isUnauthenticatedDcrConnector(left)) - Number(isUnauthenticatedDcrConnector(right)),
    );
  }, [connectors, query]);

  const filteredSkills = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return skills;
    return skills.filter(
      s => s.name.toLowerCase().includes(needle) || (s.description?.toLowerCase().includes(needle) ?? false),
    );
  }, [skills, query]);

  const pinnedSelectedConnectors = useMemo(
    () => filteredConnectors.filter(c => pinnedMcpIds.has(c.id)),
    [filteredConnectors, pinnedMcpIds],
  );
  const pinnedAvailableConnectors = useMemo(
    () => filteredConnectors.filter(c => !pinnedMcpIds.has(c.id)),
    [filteredConnectors, pinnedMcpIds],
  );
  const pinnedSelectedSkills = useMemo(
    () => filteredSkills.filter(s => pinnedSkillIds.has(s.id)),
    [filteredSkills, pinnedSkillIds],
  );
  const pinnedAvailableSkills = useMemo(
    () => filteredSkills.filter(s => !pinnedSkillIds.has(s.id)),
    [filteredSkills, pinnedSkillIds],
  );

  const toggleConnector = (connector: ConnectorState) => {
    setLocalMcp(prev =>
      prev.some(m => m.id === connector.id)
        ? prev.filter(m => m.id !== connector.id)
        : [...prev, { id: connector.id, name: connector.name }],
    );
    dirtyRef.current = true;
    scheduleFlush();
  };

  const toggleSkill = (skill: AgentSkill) => {
    setLocalSkills(prev =>
      prev.some(s => s.id === skill.id)
        ? prev.filter(s => s.id !== skill.id)
        : [...prev, { id: skill.id, name: skill.name }],
    );
    dirtyRef.current = true;
    scheduleFlush();
  };

  const openPicker = (nextTab?: AttachTab) => {
    if (nextTab != null) {
      setTab(nextTab);
      setQuery('');
    }
    if (open) return;
    setLocalMcp(specMcp);
    setLocalSkills(specSkills);
    dirtyRef.current = false;
    clearFlushTimer();
    setPinnedMcpIds(new Set(specMcp.map(m => m.id)));
    setPinnedSkillIds(new Set(specSkills.map(s => s.id)));
    setOpen(true);
  };

  const openSettings = (section: SettingsSection) => {
    setOpenAndFlush(false);
    setQuery('');
    shell?.setSettingsOpen(true, section);
  };

  const content = (
    <>
      <div className="flex shrink-0 border-b border-border">
        {TABS.map(t => {
          const count = t.id === 'connectors' ? selectedMcp.length : t.id === 'skills' ? selectedSkills.length : null;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              className={cn(
                'text-text-secondary flex flex-1 items-center justify-center gap-1.5 px-2 py-2.5 text-xs font-medium',
                active && 'text-primary-button-bg border-b-2 border-primary-button-bg',
              )}
              onClick={() => {
                setTab(t.id);
                setQuery('');
              }}
            >
              <Icon name={t.icon} className="size-3.5" />
              {t.label}
              {count != null && count > 0 ? (
                <span className="bg-secondary-bg rounded px-1 text-[10px]">{count}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {tab === 'capabilities' ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <DraftCapabilitiesPanel
            value={readAgentCapabilities(agentSpec?.config)}
            disabled={disabled || isRunning}
            onChange={values => {
              // Capability writes bypass the mount debounce. Fold in any dirty
              // local mounts in the same update so a pending connector/skill
              // toggle is not overwritten by a config-only sync.
              clearFlushTimer();
              const includeLocalMounts = dirtyRef.current;
              if (includeLocalMounts) {
                dirtyRef.current = false;
              }
              updateAgentSpec?.({
                ...(includeLocalMounts ? { mcpServers: localMcpRef.current, skills: localSkillsRef.current } : {}),
                config: withAgentCapabilities({ config: agentSpec?.config, values }),
              });
            }}
          />
        </div>
      ) : (
        <>
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder={tab === 'connectors' ? 'Search connectors...' : 'Search skills...'}
          />
          {tab === 'skills' && skillsDisabled && skillsDisabledReason ? (
            <div
              role="status"
              className="border-primary-button-bg/30 bg-primary-button-bg/5 text-text-primary mx-3 mb-2 flex items-center gap-2 rounded-lg border p-3"
            >
              <Icon name="lock" className="text-primary-button-bg size-3 shrink-0" />
              <span className="text-xs leading-none">{skillsDisabledReason}</span>
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
            {tab === 'connectors' ? (
              <>
                {pinnedSelectedConnectors.length > 0 ? (
                  <>
                    <SectionHeading label="Selected" count={pinnedSelectedConnectors.length} />
                    {pinnedSelectedConnectors.map(c => (
                      <CatalogRow
                        key={c.id}
                        title={c.name}
                        description={c.description}
                        checked={selectedMcpIds.has(c.id)}
                        action={
                          isUnauthenticatedDcrConnector(c) ? (
                            <ConnectorConnectButton connector={c} onConnected={refreshConnectors} />
                          ) : undefined
                        }
                        onToggle={() => toggleConnector(c)}
                      />
                    ))}
                  </>
                ) : null}
                {pinnedAvailableConnectors.length > 0 ? (
                  <>
                    <SectionHeading label="Available" count={pinnedAvailableConnectors.length} />
                    {pinnedAvailableConnectors.map(c => (
                      <CatalogRow
                        key={c.id}
                        title={c.name}
                        description={c.description}
                        checked={selectedMcpIds.has(c.id)}
                        action={
                          isUnauthenticatedDcrConnector(c) ? (
                            <ConnectorConnectButton connector={c} onConnected={refreshConnectors} />
                          ) : undefined
                        }
                        onToggle={() => toggleConnector(c)}
                      />
                    ))}
                  </>
                ) : null}
                {filteredConnectors.length === 0 ? (
                  <DraftCatalogEmptyState
                    loading={loading}
                    emptyLabel="No connectors"
                    settingsTarget="Connectors"
                    onOpenSettings={
                      connectors.length === 0 && shell && canConfigureConnectors
                        ? () => openSettings('connectors')
                        : undefined
                    }
                  />
                ) : null}
              </>
            ) : (
              <>
                {pinnedSelectedSkills.length > 0 ? (
                  <>
                    <SectionHeading label="Selected" count={pinnedSelectedSkills.length} />
                    {pinnedSelectedSkills.map(s => (
                      <CatalogRow
                        key={s.id}
                        title={s.name}
                        description={s.description}
                        checked={selectedSkillIds.has(s.id)}
                        disabled={skillsDisabled && !selectedSkillIds.has(s.id)}
                        onToggle={() => toggleSkill(s)}
                      />
                    ))}
                  </>
                ) : null}
                {pinnedAvailableSkills.length > 0 ? (
                  <>
                    <SectionHeading label="Available" count={pinnedAvailableSkills.length} />
                    {pinnedAvailableSkills.map(s => (
                      <CatalogRow
                        key={s.id}
                        title={s.name}
                        description={s.description}
                        checked={selectedSkillIds.has(s.id)}
                        disabled={skillsDisabled && !selectedSkillIds.has(s.id)}
                        onToggle={() => toggleSkill(s)}
                      />
                    ))}
                  </>
                ) : null}
                {filteredSkills.length === 0 ? (
                  <DraftCatalogEmptyState
                    loading={loading}
                    emptyLabel="No skills"
                    settingsTarget={needsSandbox ? 'a Sandbox' : 'Skills'}
                    onOpenSettings={
                      skills.length === 0 && shell && (needsSandbox ? canConfigureSandbox : canConfigureSkills)
                        ? () => openSettings(needsSandbox ? 'sandbox' : 'skills')
                        : undefined
                    }
                  />
                ) : null}
              </>
            )}
          </div>
        </>
      )}
    </>
  );

  return (
    <div ref={containerRef} className="relative flex flex-wrap items-center gap-1.5">
      {hasValidModel ? (
        <Tooltip content={toolsTooltip} className="max-w-xs whitespace-pre-line text-left" side="top">
          <button
            type="button"
            disabled={disabled || isRunning}
            aria-label={`Tools (${toolsCount})`}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
            className={auiButtonClass({
              variant: 'ghost',
              size: 'sm',
              className: 'h-8 gap-1.5 rounded-md px-2 text-xs',
            })}
            onClick={() => {
              if (open) {
                setOpenAndFlush(false);
                return;
              }
              openPicker();
            }}
          >
            <Icon name="wrench" className="size-3.5" />
            <span>Tools</span>
            <span className="bg-primary-button-bg/10 text-primary-button-bg rounded px-1.5 py-0.5 text-[10px] font-semibold">
              {toolsCount}
            </span>
          </button>
        </Tooltip>
      ) : null}

      {onAttach ? (
        <Tooltip content="Attach a file">
          <button
            type="button"
            disabled={disabled || isRunning}
            aria-label="Attach a file"
            className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
            onClick={onAttach}
          >
            <Icon name="paperclip" />
          </button>
        </Tooltip>
      ) : null}

      {open && hasValidModel ? (
        isMobile || compactLayout ? (
          <BottomSheet id={menuId} open onOpenChange={setOpenAndFlush} aria-label="Add to composer">
            {content}
          </BottomSheet>
        ) : (
          <div
            id={menuId}
            role="dialog"
            aria-label="Add to composer"
            className="bg-card-bg text-text-primary absolute bottom-full left-0 z-50 mb-2 flex h-[22rem] w-[28rem] max-w-[min(28rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-border shadow-lg"
          >
            {content}
          </div>
        )
      ) : null}
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    DraftCompositeSelector: typeof DraftCompositeSelector;
  }
}
