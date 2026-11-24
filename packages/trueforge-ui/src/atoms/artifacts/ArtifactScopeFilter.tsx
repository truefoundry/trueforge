'use client';

import { Icon } from '../../icons/Icon.js';
import type { ListArtifactsParams } from '../../server/types.js';
import { auiSelectTriggerClass } from '../lib/selectClasses.js';
import { DropdownMenu, DropdownMenuItem } from '../primitives/DropdownMenu.js';

export type ArtifactScope = NonNullable<ListArtifactsParams['scope']>;

const SCOPE_OPTIONS: readonly { value: ArtifactScope; label: string }[] = [
  { value: 'all', label: 'All artifacts' },
  { value: 'created_by_me', label: 'Created by me' },
  { value: 'shared_with_me', label: 'Shared with me' },
];

export function ArtifactScopeFilter({
  scope,
  onChange,
}: {
  scope: ArtifactScope;
  onChange: (next: ArtifactScope) => void;
}) {
  const label = SCOPE_OPTIONS.find(option => option.value === scope)?.label ?? 'All artifacts';

  return (
    <DropdownMenu
      align="start"
      className="w-56"
      containerClassName="w-56"
      trigger={
        <button
          type="button"
          aria-label="Filter artifacts"
          className={auiSelectTriggerClass('h-8 w-full px-3 text-sm')}
        >
          <span className="truncate">{label}</span>
          <Icon name="chevron-down" size="1rem" className="text-text-secondary shrink-0" />
        </button>
      }
    >
      {SCOPE_OPTIONS.map(option => (
        <DropdownMenuItem
          key={option.value}
          aria-selected={option.value === scope}
          onClick={() => onChange(option.value)}
        >
          <span className="flex-1">{option.label}</span>
          {option.value === scope ? <Icon name="check" size="0.875rem" /> : null}
        </DropdownMenuItem>
      ))}
    </DropdownMenu>
  );
}
