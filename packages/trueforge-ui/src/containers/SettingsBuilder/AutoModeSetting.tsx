'use client';

import { useMutation, useQuery } from '@tanstack/react-query';

import { useTrackAnalytics } from '@/analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '@/analytics/events.js';
import { Skeleton } from '../../atoms/primitives/Skeleton.js';
import { Switch } from '../../atoms/primitives/Switch.js';
import { useServerQueryClient } from '../../server/queryClient.js';
import { queryKeys } from '../../server/queryKeys.js';
import { useOptionalConfigurationServer, useOptionalRefreshServerCapabilities } from '../../server/ServerContext.js';
import type { UpdateTenantConfigurationRequest } from '../../server/types.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';
import { useToasterOptional } from '../ToasterContainer.js';
import AutoModelCandidateList from './AutoModelCandidateList.js';
import { AUTO_ROUTING_TIERS } from './autoRoutingTiers.js';

const TIER_LIST = new Intl.ListFormat('en', { type: 'disjunction' }).format(AUTO_ROUTING_TIERS);

type AutoModelRoutingChange = NonNullable<UpdateTenantConfigurationRequest['autoModelRouting']>;

/** The tenant's Auto mode switch. Renders nothing without a configuration port. */
const AutoModeSetting = () => {
  const configuration = useOptionalConfigurationServer();
  const refreshCapabilities = useOptionalRefreshServerCapabilities();
  const queryClient = useServerQueryClient();
  const toaster = useToasterOptional();
  const track = useTrackAnalytics();

  const configurationQuery = useQuery(
    {
      queryKey: queryKeys.settings.configuration(),
      queryFn: () =>
        configuration == null
          ? Promise.reject(new Error('Configuration server is not configured.'))
          : configuration.getConfiguration(),
      enabled: configuration != null,
    },
    queryClient,
  );

  const saveMutation = useMutation(
    {
      mutationFn: (change: AutoModelRoutingChange) =>
        configuration == null
          ? Promise.reject(new Error('Configuration server is not configured.'))
          : configuration.updateConfiguration({ autoModelRouting: change }),
      onSuccess: (saved, change) => {
        queryClient.setQueryData(queryKeys.settings.configuration(), saved);
        // Auto's availability depends on this setting.
        refreshCapabilities?.();
        const { enabled, candidateModels } = saved.autoModelRouting;
        if (change.candidateModels === undefined) {
          toaster?.showSuccess({ title: enabled ? 'Auto model routing turned on' : 'Auto model routing turned off' });
          track(AnalyticsEvents.Settings.AUTO_MODE_TENANT_TOGGLED, { enabled });
        } else {
          toaster?.showSuccess({ title: 'Models updated' });
          track(AnalyticsEvents.Settings.AUTO_MODE_CANDIDATE_MODELS_SAVED, { model_count: candidateModels.length });
        }
      },
    },
    queryClient,
  );

  if (!configuration) return null;

  const errorMessage = saveMutation.isError
    ? getErrorMessage(saveMutation.error, 'Failed to save the Auto mode setting')
    : configurationQuery.isError
      ? getErrorMessage(configurationQuery.error, 'Failed to load the Auto mode setting')
      : null;
  const routing = configurationQuery.data?.autoModelRouting;
  // The UI follows the click immediately; a failed save reverts to the saved value.
  const pendingEnabled = saveMutation.isPending ? saveMutation.variables.enabled : undefined;
  const enabled = pendingEnabled ?? routing?.enabled;

  return (
    <>
      {errorMessage ? (
        <p className="mt-3 rounded-md border border-failure-bg/30 bg-failure-bg/10 px-3 py-2 text-sm text-failure-bg">
          {errorMessage}
        </p>
      ) : null}
      {configurationQuery.isPending ? (
        <Skeleton data-testid="auto-mode-setting-skeleton" className="mt-4 h-16 w-full rounded-xl" />
      ) : null}
      {enabled !== undefined ? (
        <div className="mt-4">
          <div className="rounded-xl border border-border bg-card-bg">
            <div className="flex items-start justify-between gap-6 p-6">
              <div className="flex min-w-0 max-w-[42.5rem] flex-col gap-1.5">
                <h4 className="text-lg font-semibold text-text-primary">Auto model routing</h4>
                <p className="text-pretty text-sm leading-[1.375rem] text-text-secondary">
                  {enabled
                    ? `Each task is matched to a tier: ${TIER_LIST}. Auto picks a suitable model from the ones you select, so include at least one for every tier.`
                    : 'Intelligently picks a suitable model for each task.'}
                </p>
              </div>
              <Switch
                size="md"
                checked={enabled}
                disabled={saveMutation.isPending}
                // Held while saving without dimming, so the switch doesn't flash.
                className="disabled:opacity-100"
                aria-label="Auto model routing"
                onCheckedChange={next => {
                  saveMutation.mutate({ enabled: next });
                }}
              />
            </div>
            {enabled && routing ? (
              <AutoModelCandidateList
                // Restarts the draft when the saved list changes.
                key={JSON.stringify(routing.candidateModels)}
                candidateModels={routing.candidateModels}
                saving={saveMutation.isPending}
                onSave={next => {
                  saveMutation.mutate({ candidateModels: next });
                }}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
};

export default AutoModeSetting;
