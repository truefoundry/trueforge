'use client';

import { Icon } from '../../icons/Icon.js';
import { auiButtonClass } from '../lib/buttonClasses.js';

export function DraftCatalogEmptyState({
  loading,
  emptyLabel,
  settingsTarget,
  onOpenSettings,
}: {
  loading: boolean;
  emptyLabel: string;
  settingsTarget: string;
  onOpenSettings?: () => void;
}) {
  if (!loading && onOpenSettings) {
    return (
      <button
        type="button"
        className={auiButtonClass({
          variant: 'ghost',
          className: 'text-text-secondary w-full justify-center gap-1 py-4 text-xs',
        })}
        onClick={onOpenSettings}
      >
        Please configure {settingsTarget} in the <span className="underline">settings</span>
        <Icon name="chevron-right" className="size-3" />
      </button>
    );
  }

  return <p className="text-text-secondary px-2 py-4 text-center text-sm">{loading ? 'Loading…' : emptyLabel}</p>;
}
