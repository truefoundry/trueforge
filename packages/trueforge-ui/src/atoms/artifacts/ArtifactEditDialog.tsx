'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { useTrackAnalytics } from '../../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../../analytics/events.js';
import { useToasterOptional } from '../../containers/ToasterContainer.js';
import { useServerQueryClient } from '../../server/queryClient.js';
import { queryKeys } from '../../server/queryKeys.js';
import { useArtifactServer } from '../../server/ServerContext.js';
import type { Artifact } from '../../server/types.js';
import { auiInputClass } from '../lib/inputClasses.js';
import { Button } from '../primitives/Button.js';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../primitives/Dialog.js';

export function ArtifactEditDialog({
  artifact,
  saving,
  onCancel,
  onSave,
}: {
  artifact: Artifact;
  saving: boolean;
  onCancel: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(artifact.name);
  const trimmed = name.trim();

  return (
    <Dialog
      open
      onOpenChange={next => {
        if (!next) onCancel();
      }}
      aria-label="Edit artifact"
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit artifact</DialogTitle>
        </DialogHeader>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-text-secondary">Name</span>
          <input
            value={name}
            aria-label="Artifact name"
            className={auiInputClass('h-8')}
            onChange={event => setName(event.target.value)}
          />
        </label>
      </DialogContent>
      <DialogFooter>
        <Button.Secondary type="button" onClick={onCancel}>
          Cancel
        </Button.Secondary>
        <Button.Primary
          type="button"
          disabled={saving || trimmed.length === 0 || trimmed === artifact.name}
          onClick={() => onSave(trimmed)}
        >
          Save
        </Button.Primary>
      </DialogFooter>
    </Dialog>
  );
}

export function useRenameArtifact() {
  const artifactServer = useArtifactServer();
  const queryClient = useServerQueryClient();
  const toaster = useToasterOptional();
  const track = useTrackAnalytics();

  return useMutation(
    {
      mutationFn: ({ artifact, name }: { artifact: Artifact; name: string }) =>
        artifactServer.updateArtifact({ id: artifact.id, name }),
      onSuccess: (_updated, { artifact }) => {
        track(AnalyticsEvents.Artifact.EDITED, { artifact_id: artifact.id });
        toaster?.showSuccess({ title: 'Artifact updated' });
        void queryClient.invalidateQueries({ queryKey: queryKeys.artifacts.all() });
      },
      onError: caught => toaster?.showError(caught),
    },
    queryClient,
  );
}
