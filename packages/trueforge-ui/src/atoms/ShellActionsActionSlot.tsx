'use client';

import type { ReactNode } from 'react';

/**
 * Optional host chrome (e.g. logout) to the right of theme + settings in {@link ShellActions}.
 * Default is empty; override via `overrides.ShellActionsActionSlot`.
 * Layouts keep {@link ShellActions} mounted while Settings is open so host state is not remounted.
 */
export function ShellActionsActionSlot(): ReactNode {
  return null;
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ShellActionsActionSlot: typeof ShellActionsActionSlot;
  }
}
