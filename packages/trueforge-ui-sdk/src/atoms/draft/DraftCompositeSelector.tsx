'use client';

import { useTrueFoundryAgentSpec, useTrueFoundryUpdateAgentSpec } from '@truefoundry/assistant-ui-runtime';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';

import { useMCPAuth } from '../../hooks/useMcpAuth.js';
import { Icon } from '../../icons/Icon.js';
import { useServerCapabilities } from '../../server/ServerContext.js';
import type { AgentSkill, ConnectorState } from '../../server/types.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { cn } from '../lib/cn.js';
import { useCompactLayout } from '../lib/CompactLayoutContext.js';
import { useIsMobile } from '../lib/useIsMobile.js';
import { BottomSheet } from '../primitives/BottomSheet.js';
import { Tooltip } from '../primitives/Tooltip.js';
import { useDraftCatalog } from './DraftCatalogProvider.js';

/** Catalog-backed mount shape used by the draft picker (runtime mounts stay opaque). */
type DraftMount = { id: string; name: string };

/**
 * Harness wire mounts are name-keyed (`{ name }` only). Catalog rows use
 * `id === name`, so missing ids hydrate from name — otherwise save/load drops
 * mounts from the picker and the next flush can wipe them from the spec.
 */
function draftMountsFromSpec(value: unknown): DraftMount[] {
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
type AttachTab = 'connectors' | 'skills' | 'files';

const TABS: { id: AttachTab; label: string; icon: string }[] = [
  { id: 'connectors', label: 'Connectors', icon: 'plug' },
  { id: 'skills', label: 'Skills', icon: 'lightbulb' },
  { id: 'files', label: 'Attachment', icon: 'paperclip' },
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

function CatalogRow({
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

function isUnauthenticatedDcrConnector(connector: ConnectorState): boolean {
  const auth = Reflect.get(connector, 'auth');
  return (
    connector.authenticated === false &&
    typeof auth === 'object' &&
    auth !== null &&
    Reflect.get(auth, 'type') === 'dcr'
  );
}

function ConnectorConnectButton({
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
        className="border-input-border bg-secondary-bg/40 text-text-primary placeholder:text-text-secondary h-8 w-full rounded-md border-0 py-1 pr-2 pl-7 text-sm outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/40"
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
  const { skills, connectors, ensureLoaded, refreshConnectors } = useDraftCatalog();
  const capabilities = useServerCapabilities();
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

  const specMcp = useMemo(() => draftMountsFromSpec(agentSpec?.mcpServers), [agentSpec?.mcpServers]);
  const specSkills = useMemo(() => draftMountsFromSpec(agentSpec?.skills), [agentSpec?.skills]);

  const selectedMcp = open ? localMcp : specMcp;
  const selectedSkills = open ? localSkills : specSkills;
  const selectedMcpIds = useMemo(() => new Set(selectedMcp.map(m => m.id)), [selectedMcp]);
  const selectedSkillIds = useMemo(() => new Set(selectedSkills.map(s => s.id)), [selectedSkills]);

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
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenAndFlush(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
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
                active && 'text-text-primary border-b-2 border-text-primary',
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

      {tab === 'files' ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            onAttach?.();
            setOpenAndFlush(false);
          }}
          className={cn(
            'm-3 flex min-h-48 flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-8',
            'text-center outline-none transition-colors hover:bg-ghost-button-hover',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <Icon name="paperclip" className="text-primary-button-bg size-6" />
          <span className="text-sm font-medium">Add files or photos</span>
          <span className="text-text-secondary text-xs">Upto 5 attachments | 10 MB each</span>
        </button>
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
              </>
            )}
          </div>
        </>
      )}
    </>
  );

  return (
    <div ref={containerRef} className="relative flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        disabled={disabled || isRunning}
        aria-label="Add connectors, skills, or attachments"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
        onClick={() => {
          if (open) {
            setOpenAndFlush(false);
            return;
          }
          openPicker();
        }}
      >
        <Icon name="plus" className="text-primary-button-bg" />
      </button>

      <DraftSelectionChips
        disabled={disabled || isRunning}
        onOpenTab={tabId => {
          openPicker(tabId);
        }}
      />

      {open ? (
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

export type DraftSelectionChipsProps = {
  disabled?: boolean;
  onOpenTab?: (tab: 'connectors' | 'skills') => void;
};

function SelectionChipTooltipList({ mounts }: { mounts: DraftMount[] }) {
  return (
    <ul className="m-0 flex max-w-48 list-none flex-col gap-0.5 p-0 text-left">
      {mounts.map(mount => (
        <li key={mount.id} className="truncate" title={mount.name}>
          {mount.name}
        </li>
      ))}
    </ul>
  );
}

export function DraftSelectionChips({ disabled, onOpenTab }: DraftSelectionChipsProps = {}) {
  const { agentSpec } = useTrueFoundryAgentSpec();
  const mcpMounts = useMemo(() => draftMountsFromSpec(agentSpec?.mcpServers), [agentSpec?.mcpServers]);
  const skillMounts = useMemo(() => draftMountsFromSpec(agentSpec?.skills), [agentSpec?.skills]);

  if (mcpMounts.length === 0 && skillMounts.length === 0) return null;

  const chipClassName = cn(
    'bg-secondary-bg text-text-secondary inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs outline-none',
    'focus-visible:ring-1 focus-visible:ring-focus-ring',
    disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-ghost-button-hover cursor-pointer',
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {mcpMounts.length > 0 ? (
        <Tooltip content={<SelectionChipTooltipList mounts={mcpMounts} />} className="max-w-48 whitespace-normal">
          <button
            type="button"
            disabled={disabled}
            aria-label={`View ${mcpMounts.length} selected connector${mcpMounts.length === 1 ? '' : 's'}`}
            className={chipClassName}
            onClick={() => onOpenTab?.('connectors')}
          >
            <Icon name="plug" className="size-3" />
            {mcpMounts.length} Connector{mcpMounts.length === 1 ? '' : 's'}
          </button>
        </Tooltip>
      ) : null}
      {skillMounts.length > 0 ? (
        <Tooltip content={<SelectionChipTooltipList mounts={skillMounts} />} className="max-w-48 whitespace-normal">
          <button
            type="button"
            disabled={disabled}
            aria-label={`View ${skillMounts.length} selected skill${skillMounts.length === 1 ? '' : 's'}`}
            className={chipClassName}
            onClick={() => onOpenTab?.('skills')}
          >
            <Icon name="lightbulb" className="size-3" />
            {skillMounts.length} Skill{skillMounts.length === 1 ? '' : 's'}
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    DraftCompositeSelector: typeof DraftCompositeSelector;
  }
}
