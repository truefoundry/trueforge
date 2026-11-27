'use client';

import { useEffect } from 'react';

import { Icon } from '../../icons/Icon.js';
import { CatalogLogo } from '../primitives/CatalogLogo.js';
import { useDraftCatalog } from './DraftCatalogProvider.js';
import type { DraftMount } from './draftMounts.js';

// Chips beyond this collapse into one "+N" chip so the composer row stays on one line.
const MAX_CONNECTOR_CHIPS = 3;

const CHIP_CLASS =
  'inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-primary-button-bg/20 bg-primary-button-bg/10 px-1.5 text-xs font-medium text-text-primary';

export type DraftSelectionChipsProps = {
  connectors: DraftMount[];
  skills: DraftMount[];
};

/** Summary of the selected connectors and skills, shown beside the plus button. */
export function DraftSelectionChips({ connectors, skills }: DraftSelectionChipsProps) {
  const { connectorLogos, ensureLoaded } = useDraftCatalog();
  const hasSelection = connectors.length > 0 || skills.length > 0;

  // Logos come from the catalog, which only loads on request; load it once something is selected.
  useEffect(() => {
    if (hasSelection) ensureLoaded();
  }, [hasSelection, ensureLoaded]);

  if (!hasSelection) return null;

  const visible = connectors.slice(0, MAX_CONNECTOR_CHIPS);
  const hiddenCount = connectors.length - visible.length;

  return (
    <>
      {visible.map(connector => {
        const logo = connectorLogos[connector.name];
        return (
          <span key={connector.id} role="img" aria-label={connector.name} title={connector.name} className={CHIP_CLASS}>
            {logo ? (
              <CatalogLogo src={logo} className="size-4 shrink-0" />
            ) : (
              <span aria-hidden="true">{connector.name.charAt(0).toUpperCase()}</span>
            )}
          </span>
        );
      })}
      {hiddenCount > 0 ? (
        <span role="img" aria-label={`${hiddenCount} more connectors`} className={CHIP_CLASS}>
          <span aria-hidden="true">+{hiddenCount}</span>
        </span>
      ) : null}
      {skills.length > 0 ? (
        <span className={CHIP_CLASS}>
          <Icon name="scroll-text" className="text-text-secondary size-3.5 shrink-0" />
          <span>{skills.length === 1 ? '1 Skill' : `${skills.length} Skills`}</span>
        </span>
      ) : null}
    </>
  );
}
