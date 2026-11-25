'use client';

import { useMutation, useQuery } from '@tanstack/react-query';

import { useTrackAnalytics } from '@/analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '@/analytics/events.js';
import { Skeleton } from '../../atoms/primitives/Skeleton.js';
import { Switch } from '../../atoms/primitives/Switch.js';
import { Icon } from '../../icons/Icon.js';
import { useServerQueryClient } from '../../server/queryClient.js';
import { queryKeys } from '../../server/queryKeys.js';
import { useOptionalConfigurationServer, useOptionalRefreshServerCapabilities } from '../../server/ServerContext.js';
import type { UpdateTenantConfigurationRequest } from '../../server/types.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';
import { useToasterOptional } from '../ToasterContainer.js';
import AutoModelCandidateList from './AutoModelCandidateList.js';

/** How tiers and model choice work; written for admins picking the models. */
const AUTO_MODEL_ROUTING_DOCS_URL = 'https://trueforge.dev/auto-model-routing';

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
        // The model picker offers or withholds Auto with the switch and the allowed models.
        refreshCapabilities?.();
        const { enabled, candidateModels } = saved.autoModelRouting;
        if (change.candidateModels === undefined) {
          toaster?.showSuccess({ title: enabled ? 'Auto model routing turned on' : 'Auto model routing turned off' });
          track(AnalyticsEvents.Settings.AUTO_MODE_TENANT_TOGGLED, { enabled });
        } else {
          toaster?.showSuccess({ title: 'Auto models updated' });
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
  // The switch, its text and the model list follow the click straight away, instead of waiting for the save, so
  // nothing changes in stages. A failed save drops the pending change and the saved value shows again.
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
        <div className="mt-4 rounded-xl border border-border bg-card-bg p-3">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h4 className="text-base font-semibold text-text-primary">Auto Model Routing</h4>
              <p className="mt-0.5 text-sm text-text-secondary">
                {enabled ? (
                  <>
                    Each task is matched to a tier: routine, tool-driven, adaptive or frontier. Auto picks a suitable
                    model from the ones you select, so include at least one for every tier.{' '}
                    <a
                      href={AUTO_MODEL_ROUTING_DOCS_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary-button-bg hover:underline"
                    >
                      Learn more
                      <Icon name="external-link" className="size-3" />
                    </a>
                  </>
                ) : (
                  'Intelligently picks a suitable model for each task.'
                )}
              </p>
            </div>
            <Switch
              checked={enabled}
              disabled={saveMutation.isPending}
              // Held while saving without dimming, so the switch doesn't flash.
              className="disabled:opacity-100"
              aria-label="Auto Model Routing"
              onCheckedChange={next => {
                saveMutation.mutate({ enabled: next });
              }}
            />
          </div>
          {enabled && routing ? (
            <div className="mt-3 border-t border-border pt-3">
              <AutoModelCandidateList
                // The draft restarts from whatever is saved.
                key={JSON.stringify(routing.candidateModels)}
                candidateModels={routing.candidateModels}
                saving={saveMutation.isPending}
                onSave={next => {
                  saveMutation.mutate({ candidateModels: next });
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
};

export default AutoModeSetting;
