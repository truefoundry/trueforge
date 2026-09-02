'use client';

import { Icon } from '../../icons/Icon.js';
import { Button } from '../primitives/Button.js';

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
      <Button.Ghost
        type="button"
        className="h-auto w-full justify-center gap-1 py-4 text-xs text-text-secondary"
        onClick={onOpenSettings}
      >
        Please configure {settingsTarget} in the <span className="underline">settings</span>
        <Icon name="chevron-right" className="size-3" />
      </Button.Ghost>
    );
  }

  return <p className="text-text-secondary px-2 py-4 text-center text-sm">{loading ? 'Loading…' : emptyLabel}</p>;
}
