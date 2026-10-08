'use client';

import { useEffect, useState, type FormEvent } from 'react';

import { useTrackAnalytics } from '../../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../../analytics/events.js';
import { useToasterOptional } from '../../containers/ToasterContainer.js';
import { useSandboxEnvironmentServer } from '../../server/ServerContext.js';
import type { SandboxEnvironment } from '../../server/types.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';
import { Button } from '../primitives/Button.js';
import { SideDrawer } from '../primitives/SideDrawer.js';
import { defaultEnvironmentManifest } from './environmentDisplay.js';
import {
  EnvironmentFormFields,
  formValuesToManifest,
  manifestToFormValues,
  validateEnvironmentForm,
  type EnvironmentFormValues,
} from './EnvironmentFormFields.js';

export type EnvironmentFormDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  environment?: SandboxEnvironment;
  onSaved?: () => void;
};

export function EnvironmentFormDrawer({ open, onOpenChange, mode, environment, onSaved }: EnvironmentFormDrawerProps) {
  const environmentServer = useSandboxEnvironmentServer();
  const toaster = useToasterOptional();
  const track = useTrackAnalytics();
  const [form, setForm] = useState<EnvironmentFormValues>(() => manifestToFormValues(defaultEnvironmentManifest()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setError(null);
      setSaving(false);
      return;
    }
    const manifest = mode === 'edit' && environment != null ? environment.manifest : defaultEnvironmentManifest();
    setForm(manifestToFormValues(manifest));
    setError(null);
  }, [open, mode, environment]);

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const validationError = validateEnvironmentForm(form);
    if (validationError != null) {
      setError(validationError);
      return;
    }

    setSaving(true);
    try {
      const saved = await environmentServer.createOrUpdateEnvironment({ manifest: formValuesToManifest(form) });
      track(mode === 'create' ? AnalyticsEvents.Environment.CREATED : AnalyticsEvents.Environment.EDITED, {
        environment_name: saved.name,
        environment_id: saved.id,
      });
      toaster?.showSuccess({
        title: mode === 'create' ? 'Environment created' : 'Environment updated',
      });
      onSaved?.();
      onOpenChange(false);
    } catch (caught) {
      setError(getErrorMessage(caught, 'Failed to save environment'));
      toaster?.showError(caught);
    } finally {
      setSaving(false);
    }
  };

  const title = mode === 'create' ? 'New environment' : (environment?.name ?? 'Edit environment');

  return (
    <SideDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description="Configure the environment."
      size="xl"
      footer={
        <div className="flex justify-end gap-2">
          <Button.Secondary type="button" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button.Secondary>
          <Button.Primary type="submit" form="environment-form" disabled={saving}>
            {saving ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
          </Button.Primary>
        </div>
      }
    >
      <form
        id="environment-form"
        className="flex min-h-0 flex-1 flex-col gap-4 px-5 pt-4 pb-10"
        onSubmit={event => void handleSave(event)}
      >
        {error != null ? <p className="text-sm text-failure-bg">{error}</p> : null}
        <EnvironmentFormFields values={form} onChange={setForm} nameDisabled={mode === 'edit'} />
      </form>
    </SideDrawer>
  );
}
