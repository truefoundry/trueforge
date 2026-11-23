'use client';

import { useEffect, useState } from 'react';

import { useTrackAnalytics } from '@/analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '@/analytics/events.js';
import { Switch } from '../../atoms/primitives/Switch.js';
import { useOptionalConfigurationServer, useOptionalRefreshServerCapabilities } from '../../server/ServerContext.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';
import { useToasterOptional } from '../ToasterContainer.js';

/** The tenant's Auto mode switch. Renders nothing without a configuration port. */
const AutoModeSetting = () => {
  const configuration = useOptionalConfigurationServer();
  const refreshCapabilities = useOptionalRefreshServerCapabilities();
  const toaster = useToasterOptional();
  const track = useTrackAnalytics();

  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!configuration) return;
    let cancelled = false;
    void configuration
      .getConfiguration()
      .then(loaded => {
        if (!cancelled) setEnabled(loaded.auto.enabled);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, 'Failed to load the Auto mode setting'));
      });
    return () => {
      cancelled = true;
    };
  }, [configuration]);

  if (!configuration) return null;

  const handleToggle = async (next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const saved = await configuration.updateConfiguration({ auto: { enabled: next } });
      setEnabled(saved.auto.enabled);
      // The model picker offers or withholds Auto with this switch.
      refreshCapabilities?.();
      toaster?.showSuccess({ title: saved.auto.enabled ? 'Auto mode turned on' : 'Auto mode turned off' });
      track(AnalyticsEvents.Settings.AUTO_MODE_TENANT_TOGGLED, { enabled: saved.auto.enabled });
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to save the Auto mode setting'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {error ? (
        <p className="mt-3 rounded-md border border-failure-bg/30 bg-failure-bg/10 px-3 py-2 text-sm text-failure-bg">
          {error}
        </p>
      ) : null}
      {enabled !== null ? (
        <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-border bg-card-bg p-3">
          <div className="min-w-0">
            <h4 className="text-sm font-medium text-text-primary">Allow Auto mode</h4>
            <p className="mt-0.5 text-xs text-text-secondary">
              {enabled
                ? 'Chats can pick Auto, which chooses a model for each turn and each subagent.'
                : 'Auto is unavailable, including in chats that already use it, and subagents run on their parent model.'}
            </p>
          </div>
          <Switch
            checked={enabled}
            disabled={busy}
            aria-label="Allow Auto mode"
            onCheckedChange={next => {
              void handleToggle(next);
            }}
          />
        </div>
      ) : null}
    </>
  );
};

export default AutoModeSetting;
