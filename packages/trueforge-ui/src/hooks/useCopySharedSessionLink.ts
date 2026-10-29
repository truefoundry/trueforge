'use client';

import { useCallback, useEffect, useState } from 'react';

import { buildSharedSessionHref } from '../routing/paths.js';
import { useOptionalResolvedRoutes } from '../routing/ResolvedRoutesContext.js';

export function useCopySharedSessionLink(sessionId: string | null | undefined): {
  copied: boolean;
  /** Resolves true when the link reached the clipboard. */
  copySharedSessionLink: () => Promise<boolean>;
} {
  const routes = useOptionalResolvedRoutes();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copySharedSessionLink = useCallback(async () => {
    if (sessionId == null) return false;
    try {
      await navigator.clipboard.writeText(buildSharedSessionHref({ sessionId, routes }));
      setCopied(true);
      return true;
    } catch {
      // Clipboard access depends on the host browser and document permissions.
      return false;
    }
  }, [routes, sessionId]);

  return { copied, copySharedSessionLink };
}
