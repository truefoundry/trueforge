'use client';

import { useState } from 'react';

import { Icon } from '../../icons/Icon.js';
import type { AgentSkill } from '../../server/types.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';
import { cn } from '../lib/cn.js';
import { DropdownMenu, DropdownMenuItem } from '../primitives/DropdownMenu.js';

export type SkillVersionOption = {
  id: string;
  name: string;
  description?: string;
  version: number;
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

export function skillRepoName(skill: AgentSkill): string | undefined {
  return nonEmptyString(Reflect.get(skill, 'skillRepoName'));
}

export function skillVersion(skill: AgentSkill): number | undefined {
  return positiveInteger(Reflect.get(skill, 'version'));
}

export function skillFamilyId(id: string): string {
  return id.replace(/:\d+$/, '');
}

export function versionFromSkillId(id: string): number | undefined {
  const match = /:(\d+)$/.exec(id);
  return match === null ? undefined : positiveInteger(Number(match[1]));
}

async function loadSkillVersions(skill: AgentSkill): Promise<SkillVersionOption[]> {
  const loader = Reflect.get(skill, 'loadVersions');
  if (typeof loader !== 'function') return [];
  const rows: unknown = await Reflect.apply(loader, skill, []);
  if (!Array.isArray(rows)) return [];

  return rows.flatMap(row => {
    if (typeof row !== 'object' || row === null) return [];
    const id = nonEmptyString(Reflect.get(row, 'name'));
    const name = nonEmptyString(Reflect.get(row, 'displayName'));
    const description = nonEmptyString(Reflect.get(row, 'description'));
    const version = positiveInteger(Reflect.get(row, 'version'));
    if (id === undefined || name === undefined || version === undefined) return [];
    return [{ id, name, ...(description === undefined ? {} : { description }), version }];
  });
}

export function SkillVersionSelector({
  skill,
  selectedId,
  onChange,
}: {
  skill: AgentSkill;
  selectedId?: string;
  onChange: (version: SkillVersionOption) => void;
}) {
  const latestVersion = skillVersion(skill);
  const selectedVersion = selectedId === undefined ? latestVersion : versionFromSkillId(selectedId);
  const [versions, setVersions] = useState<SkillVersionOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (latestVersion === undefined) return null;

  const load = () => {
    if (versions !== null || loading) return;
    setLoading(true);
    setError(null);
    void loadSkillVersions(skill)
      .then(setVersions)
      .catch(reason => setError(getErrorMessage(reason, 'Failed to load versions.')))
      .finally(() => setLoading(false));
  };

  return (
    <DropdownMenu
      align="end"
      onOpenChange={open => {
        if (open) load();
      }}
      className="max-h-64 min-w-40 overflow-y-auto"
      lockScroll
      trigger={
        <button
          type="button"
          aria-label={`Select version for ${skill.name}`}
          className="text-text-secondary hover:bg-ghost-button-hover flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs"
        >
          <span>v{selectedVersion ?? latestVersion}</span>
          {selectedVersion === latestVersion ? <span className="text-primary-button-bg">latest</span> : null}
          <Icon name="chevron-down" className="size-3" />
        </button>
      }
    >
      {loading ? <p className="text-text-secondary px-2 py-1.5 text-xs">Loading…</p> : null}
      {error ? (
        <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
          <p className="text-failure-bg">Failed to load versions.</p>
          <button
            type="button"
            className="text-text-secondary hover:text-text-primary shrink-0 underline"
            onClick={() => {
              void navigator.clipboard.writeText(error).catch(() => undefined);
            }}
          >
            Copy error
          </button>
        </div>
      ) : null}
      {versions?.map(option => (
        <DropdownMenuItem
          key={option.id}
          aria-selected={option.id === selectedId || (selectedId === undefined && option.version === latestVersion)}
          className={cn('justify-between', option.id === selectedId && 'font-medium')}
          onClick={() => onChange(option)}
        >
          <span>v{option.version}</span>
          {option.version === latestVersion ? <span className="text-primary-button-bg text-xs">latest</span> : null}
        </DropdownMenuItem>
      ))}
      {!loading && error === null && versions?.length === 0 ? (
        <p className="text-text-secondary px-2 py-1.5 text-xs">No versions found.</p>
      ) : null}
    </DropdownMenu>
  );
}
