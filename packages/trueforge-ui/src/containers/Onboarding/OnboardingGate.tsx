'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { useServerQueryClient } from '../../server/queryClient.js';
import { queryKeys } from '../../server/queryKeys.js';
import {
  useOptionalCatalogServer,
  useOptionalRefreshServerCapabilities,
  useServerCapabilities,
  useServerCapabilitiesSettled,
} from '../../server/ServerContext.js';
import { useOptionalShellMode } from '../../server/ShellModeContext.js';
import { useSlot } from '../../theme/SlotsProvider.js';

/**
 * Shows first-run onboarding when the caller may manage model providers but none exist yet.
 * Callers who cannot manage providers (platform-managed models) never see it.
 */
export function OnboardingGate() {
  const Onboarding = useSlot('Onboarding');
  const queryClient = useServerQueryClient();
  const shell = useOptionalShellMode();
  const catalog = useOptionalCatalogServer();
  const capabilities = useServerCapabilities();
  const capabilitiesSettled = useServerCapabilitiesSettled();
  const refreshCapabilities = useOptionalRefreshServerCapabilities();
  const [dismissed, setDismissed] = useState(false);

  const modelProviders = capabilities?.settings?.modelProviders;
  const modelCatalog = catalog?.modelCatalog;
  const eligible =
    catalog !== null &&
    capabilitiesSettled &&
    modelProviders?.enabled === true &&
    modelProviders.manageProviders === true &&
    modelCatalog !== undefined;

  // A failed lookup is an error state, not an empty list, so it never blocks the app behind this flow.
  const providersQuery = useQuery(
    {
      queryKey: queryKeys.settings.modelProviders(),
      queryFn: () =>
        modelCatalog === undefined
          ? Promise.reject(new Error('Model catalog is not configured.'))
          : modelCatalog.listModelProviders(),
      enabled: eligible,
    },
    queryClient,
  );

  const setSettingsOpen = shell?.setSettingsOpen;
  const handleComplete = useCallback(() => {
    // The draft model picker and capability-gated chrome both depend on the provider that was just added.
    void queryClient.invalidateQueries({ queryKey: queryKeys.catalog.all() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.settings.modelProviders() });
    refreshCapabilities?.();
    // Onboarding can open over a Settings page; finish on the new chat instead.
    setSettingsOpen?.(false);
    setDismissed(true);
  }, [queryClient, refreshCapabilities, setSettingsOpen]);

  const open = eligible && !dismissed && providersQuery.isSuccess && providersQuery.data.length === 0;
  if (!open) return null;
  return <Onboarding onComplete={handleComplete} />;
}
