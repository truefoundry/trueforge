'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { useTrackAnalytics } from '../../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../../analytics/events.js';
import { cn } from '../../atoms/lib/cn.js';
import { auiInputClass } from '../../atoms/lib/inputClasses.js';
import { Button } from '../../atoms/primitives/Button.js';
import { SelectableList } from '../../atoms/primitives/SelectableList.js';
import { Icon } from '../../icons/Icon.js';
import { CATALOG_STALE_TIME_MS, useServerQueryClient } from '../../server/queryClient.js';
import { queryKeys } from '../../server/queryKeys.js';
import { useCatalogServer } from '../../server/ServerContext.js';
import type { CreateModelProviderRequest } from '../../server/types.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';
import { buildCreateModelProviderRequest } from '../SettingsBuilder/modelProviderRequest.js';
import { formatProviderName, providerKeyUrl } from './providerKeyLinks.js';

const inputClassName = auiInputClass('h-8 bg-secondary-bg/40 px-3.5');

type ConnectModelStepProps = {
  /** Provider type saved earlier in this flow; the form is read-only so Back never creates a duplicate. */
  connectedType: string | undefined;
  onConnected: (providerType: string) => void;
};

/** Required first step: pick a provider and save its API key (and optional endpoint). */
export function ConnectModelStep({ connectedType, onConnected }: ConnectModelStepProps) {
  const { modelCatalog } = useCatalogServer();
  const queryClient = useServerQueryClient();
  const track = useTrackAnalytics();
  const OptionLabel = useSlot('OnboardingOptionLabel');
  const StepFooter = useSlot('OnboardingStepFooter');

  const catalogQuery = useQuery(
    {
      queryKey: queryKeys.settings.modelProviderCatalog(),
      queryFn: () => modelCatalog.getModelProviderCatalog(),
      staleTime: CATALOG_STALE_TIME_MS,
    },
    queryClient,
  );
  // Custom providers need a model list, which the guided flow does not collect.
  const providers = catalogQuery.data?.filter(entry => entry.type !== 'custom');

  const [pickedType, setPickedType] = useState<string | undefined>(undefined);
  // Until the user picks, the first provider is selected; a connected provider wins when returning from step 2.
  const selectedType = connectedType ?? pickedType ?? providers?.[0]?.type;
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const saveMutation = useMutation(
    {
      mutationFn: (request: CreateModelProviderRequest) => modelCatalog.createModelProvider(request),
    },
    queryClient,
  );

  const locked = connectedType !== undefined;
  const busy = saveMutation.isPending;
  const selected = providers?.find(entry => entry.type === selectedType);
  const trimmedKey = apiKey.trim();
  const canContinue = locked || (selected !== undefined && trimmedKey !== '' && !busy);
  const keyUrl = selected === undefined ? undefined : providerKeyUrl(selected.type);
  const loadError = catalogQuery.error ? getErrorMessage(catalogQuery.error, 'Failed to load model providers') : null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (connectedType !== undefined) {
      onConnected(connectedType);
      return;
    }
    if (!canContinue || selected === undefined) return;
    setFormError(null);
    try {
      await saveMutation.mutateAsync(
        buildCreateModelProviderRequest({ entry: selected, draft: { apiKey: trimmedKey, baseUrl: baseUrl.trim() } }),
      );
      track(AnalyticsEvents.Settings.MODEL_PROVIDER_SAVED, { provider_name: selected.name, mode: 'create' });
      onConnected(selected.type);
    } catch (err) {
      setFormError(getErrorMessage(err, 'Request failed'));
    }
  };

  const fieldsDisabled = busy || locked;

  return (
    <form className="flex flex-col gap-4" onSubmit={event => void handleSubmit(event)}>
      <header>
        <h2 className="text-text-primary text-xl leading-[1.875rem] font-medium">Connect a model</h2>
        <p className="text-text-secondary text-sm leading-[1.40625rem]">
          Pick a provider and paste your API key. You can modify this later in Settings.
        </p>
      </header>

      <SelectableList
        aria-label="Model providers"
        className="border-border bg-card-bg h-56 shrink-0 rounded-[0.625rem] border p-1"
        items={providers ?? []}
        selectedKey={selectedType}
        getKey={entry => entry.type}
        onSelect={entry => {
          setPickedType(entry.type);
          setFormError(null);
        }}
        disabled={fieldsDisabled}
        noDataPlaceholder={
          <p className="text-text-secondary p-6 text-center text-sm">
            {loadError ?? (catalogQuery.isPending ? 'Loading…' : 'No model providers are available.')}
          </p>
        }
        renderOption={entry => (
          <OptionLabel
            name={formatProviderName(entry.name)}
            fallbackIcon="cpu"
            {...(entry.logo ? { logoSrc: entry.logo } : {})}
          />
        )}
      />

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="onboarding-api-key" className="text-text-primary text-sm leading-[1.21875rem] font-medium">
            API key
          </label>
          {selected !== undefined && keyUrl !== undefined ? (
            <span className="text-text-secondary text-xs">
              Need an {formatProviderName(selected.name)} account?{' '}
              <a href={keyUrl} target="_blank" rel="noreferrer" className="underline">
                Click here
              </a>
            </span>
          ) : null}
        </div>
        <input
          id="onboarding-api-key"
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={event => {
            setApiKey(event.target.value);
            setFormError(null);
          }}
          placeholder={locked ? 'API key saved' : 'Enter API key'}
          disabled={fieldsDisabled}
          className={inputClassName}
        />
      </div>

      <div className="flex flex-col gap-4">
        <button
          type="button"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen(open => !open)}
          className="text-text-secondary flex w-fit cursor-pointer items-center gap-1 text-[0.8125rem] leading-[1.21875rem] font-medium"
        >
          Advanced • custom endpoint
          <Icon name="chevron-down" className={cn('size-3 transition-transform', advancedOpen && 'rotate-180')} />
        </button>
        {advancedOpen ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="onboarding-base-url" className="text-text-primary text-sm leading-[1.21875rem] font-medium">
              Base URL
            </label>
            <input
              id="onboarding-base-url"
              type="url"
              value={baseUrl}
              onChange={event => setBaseUrl(event.target.value)}
              placeholder="https://api.openai.com/v1"
              disabled={fieldsDisabled}
              className={inputClassName}
            />
            <p className="text-text-secondary text-xs">Leave blank unless you use a regional or proxy endpoint.</p>
          </div>
        ) : null}
      </div>

      {formError ? (
        <p role="alert" className="text-failure-bg text-sm">
          {formError}
        </p>
      ) : null}

      <StepFooter
        end={
          <Button.Primary type="submit" disabled={!canContinue}>
            {busy ? 'Connecting…' : 'Continue'}
            <Icon name="chevron-right" />
          </Button.Primary>
        }
      />
    </form>
  );
}
