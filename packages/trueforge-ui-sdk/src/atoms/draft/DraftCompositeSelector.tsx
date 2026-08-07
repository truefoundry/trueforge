'use client';

import { useTrueFoundryAgentSpec, useTrueFoundryUpdateAgentSpec } from '@truefoundry/assistant-ui-runtime';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { Icon } from '../../icons/Icon.js';
import type { AgentSkill, ConnectorState, McpServerMount, SkillMount } from '../../server/types.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { cn } from '../lib/cn.js';
import { useCompactLayout } from '../lib/CompactLayoutContext.js';
import { useIsMobile } from '../lib/useIsMobile.js';
import { BottomSheet } from '../primitives/BottomSheet.js';
import { useDraftCatalog } from './DraftCatalogProvider.js';

type AttachTab = 'connectors' | 'skills' | 'files';

const TABS: { id: AttachTab; label: string; icon: string }[] = [
  { id: 'connectors', label: 'Connectors', icon: 'plug' },
  { id: 'skills', label: 'Skills', icon: 'list-check' },
  { id: 'files', label: 'Attachment', icon: 'paperclip' },
];

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded border',
        checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background',
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
  onToggle,
}: {
  title: string;
  description?: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      className="hover:bg-accent flex w-full items-start gap-2 rounded-md px-2 py-2 text-left"
      onClick={onToggle}
    >
      <span className="bg-muted text-muted-foreground mt-0.5 flex size-7 shrink-0 items-center justify-center rounded text-xs font-semibold">
        {title.charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-foreground block truncate text-sm font-medium">{title}</span>
        {description ? <span className="text-muted-foreground line-clamp-1 text-xs">{description}</span> : null}
      </span>
      <Checkbox checked={checked} />
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
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2"
      />
      <input
        type="search"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="border-input bg-muted/50 placeholder:text-muted-foreground h-8 w-full rounded-md border-0 py-1 pr-2 pl-7 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
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
    <div className="text-muted-foreground px-3 pt-2 pb-1 text-[11px] font-medium tracking-wide uppercase">
      {label} ({count})
    </div>
  );
}

export function DraftCompositeSelector({ disabled, isRunning, onAttach }: DraftCompositeSelectorProps) {
  const { skills, connectors } = useDraftCatalog();
  const { agentSpec } = useTrueFoundryAgentSpec();
  const updateAgentSpec = useTrueFoundryUpdateAgentSpec();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<AttachTab>('connectors');
  const [query, setQuery] = useState('');
  // Section membership is snapped when the picker opens, so toggles don't jump rows mid-session.
  const [pinnedMcpIds, setPinnedMcpIds] = useState<Set<string>>(() => new Set());
  const [pinnedSkillIds, setPinnedSkillIds] = useState<Set<string>>(() => new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const isMobile = useIsMobile();
  const compactLayout = useCompactLayout();

  const selectedMcp = useMemo(
    () => (agentSpec?.mcpServers as McpServerMount[] | undefined) ?? [],
    [agentSpec?.mcpServers],
  );
  const selectedSkills = useMemo(() => (agentSpec?.skills as SkillMount[] | undefined) ?? [], [agentSpec?.skills]);

  const selectedMcpIds = useMemo(() => new Set(selectedMcp.map(m => m.id)), [selectedMcp]);
  const selectedSkillIds = useMemo(() => new Set(selectedSkills.map(s => s.id)), [selectedSkills]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Keep unavailable selections visible so users can remove them.
  // Hosts that omit auth info keep their connectors selectable.
  const selectableConnectors = useMemo(
    () => connectors.filter(c => selectedMcpIds.has(c.id) || c.authenticated || !c.requiresAuth),
    [connectors, selectedMcpIds],
  );

  const filteredConnectors = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return selectableConnectors;
    return selectableConnectors.filter(
      c => c.name.toLowerCase().includes(needle) || (c.description?.toLowerCase().includes(needle) ?? false),
    );
  }, [selectableConnectors, query]);

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
    const next = selectedMcpIds.has(connector.id)
      ? selectedMcp.filter(m => m.id !== connector.id)
      : [...selectedMcp, { id: connector.id, name: connector.name }];
    updateAgentSpec?.({ mcpServers: next });
  };

  const toggleSkill = (skill: AgentSkill) => {
    const next = selectedSkillIds.has(skill.id)
      ? selectedSkills.filter(s => s.id !== skill.id)
      : [...selectedSkills, { id: skill.id, name: skill.name }];
    updateAgentSpec?.({ skills: next });
  };

  const openPicker = () => {
    setPinnedMcpIds(new Set(selectedMcp.map(m => m.id)));
    setPinnedSkillIds(new Set(selectedSkills.map(s => s.id)));
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
                'text-muted-foreground flex flex-1 items-center justify-center gap-1.5 px-2 py-2.5 text-xs font-medium',
                active && 'text-foreground border-b-2 border-foreground',
              )}
              onClick={() => {
                setTab(t.id);
                setQuery('');
              }}
            >
              <Icon name={t.icon} className="size-3.5" />
              {t.label}
              {count != null && count > 0 ? <span className="bg-muted rounded px-1 text-[10px]">{count}</span> : null}
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
            setOpen(false);
          }}
          className={cn(
            'm-3 flex min-h-48 flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-8',
            'text-center outline-none transition-colors hover:bg-accent/40',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <Icon name="paperclip" className="text-primary size-6" />
          <span className="text-sm font-medium">Add files or photos</span>
          <span className="text-muted-foreground text-xs">Upto 5 attachments | 10 MB each</span>
        </button>
      ) : (
        <>
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder={tab === 'connectors' ? 'Search connectors...' : 'Search skills...'}
          />
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
    <div ref={containerRef} className="relative">
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
            setOpen(false);
            return;
          }
          openPicker();
        }}
      >
        <Icon name="plus" className="text-primary" />
      </button>

      {open ? (
        isMobile || compactLayout ? (
          <BottomSheet id={menuId} open onOpenChange={setOpen} aria-label="Add to composer">
            {content}
          </BottomSheet>
        ) : (
          <div
            id={menuId}
            role="dialog"
            aria-label="Add to composer"
            className="bg-popover text-popover-foreground absolute bottom-full left-0 z-50 mb-2 flex h-[22rem] w-[28rem] max-w-[min(28rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-border shadow-lg"
          >
            {content}
          </div>
        )
      ) : null}
    </div>
  );
}

export function DraftSelectionChips() {
  const { agentSpec } = useTrueFoundryAgentSpec();
  const mcpCount = agentSpec?.mcpServers?.length ?? 0;
  const skillCount = agentSpec?.skills?.length ?? 0;

  if (mcpCount === 0 && skillCount === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {mcpCount > 0 ? (
        <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs">
          <Icon name="plug" className="size-3" />
          {mcpCount} Connector{mcpCount === 1 ? '' : 's'}
        </span>
      ) : null}
      {skillCount > 0 ? (
        <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs">
          <Icon name="list-check" className="size-3" />
          {skillCount} Skill{skillCount === 1 ? '' : 's'}
        </span>
      ) : null}
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    DraftCompositeSelector: typeof DraftCompositeSelector;
  }
}
