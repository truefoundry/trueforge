'use client';

import { EmptyScreen } from './EmptyScreen.js';

/** Informational empty state for surfaces that are not available below the `md` breakpoint. */
export function DesktopOnlyNotice() {
  return (
    <EmptyScreen
      title="Best viewed on desktop"
      description="This page works best on a larger screen. Open the same link on a desktop browser to continue."
    />
  );
}
