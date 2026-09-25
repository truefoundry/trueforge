'use client';

import { useCallback, useEffect, useState } from 'react';

import { buildSharedSessionHref } from '../routing/paths.js';
import { useOptionalResolvedRoutes } from '../routing/ResolvedRoutesContext.js';

export function useCopySharedSessionLink(sessionId: string | null | undefined): {
  copied: boolean;
  copySharedSessionLink: () => Promise<void>;
} {
  const routes = useOptionalResolvedRoutes();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copySharedSessionLink = useCallback(async () => {
    if (sessionId == null) return;
    try {
      await navigator.clipboard.writeText(buildSharedSessionHref({ sessionId, routes }));
      setCopied(true);
    } catch {
      // Clipboard access depends on the host browser and document permissions.
    }
  }, [routes, sessionId]);

  return { copied, copySharedSessionLink };
}
