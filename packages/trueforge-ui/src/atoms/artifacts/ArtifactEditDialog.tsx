'use client';

import type { QueryClient } from '@tanstack/react-query';
import { useState, type MutableRefObject } from 'react';

import { AnalyticsEvents } from '../../analytics/events.js';
import type { TrackAnalytics } from '../../analytics/types.js';
import type { useToasterOptional } from '../../containers/ToasterContainer.js';
import { queryKeys } from '../../server/queryKeys.js';
import type { Artifact, ArtifactServer } from '../../server/types.js';
import { auiInputClass } from '../lib/inputClasses.js';
import { Button } from '../primitives/Button.js';
import ConfirmDeleteDialog from '../primitives/ConfirmDeleteDialog.js';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../primitives/Dialog.js';
import { artifactPreviewKey } from './artifactDisplay.js';

export function ArtifactEditDialog({
  artifact,
  onCancel,
  onSave,
}: {
  artifact: Artifact;
  onCancel: () => void;
  onSave: (title: string) => void;
}) {
  const [title, setTitle] = useState(artifact.title);
  const trimmed = title.trim();

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
            value={title}
            aria-label="Artifact name"
            className={auiInputClass('h-8')}
            onChange={event => setTitle(event.target.value)}
          />
        </label>
      </DialogContent>
      <DialogFooter>
        <Button.Secondary type="button" onClick={onCancel}>
          Cancel
        </Button.Secondary>
        <Button.Primary
          type="button"
          disabled={trimmed.length === 0 || trimmed === artifact.title}
          onClick={() => onSave(trimmed)}
        >
          Save
        </Button.Primary>
      </DialogFooter>
    </Dialog>
  );
}

export function ArtifactDeleteDialog({
  artifact,
  onCancel,
  onConfirm,
}: {
  artifact: Artifact;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDeleteDialog
      title="Delete artifact"
      description={
        <>
          Delete <span className="font-medium text-text-primary">{artifact.title}</span>? This cannot be undone.
        </>
      }
      confirmLabel="Delete"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

export function artifactMutations({
  artifactServer,
  queryClient,
  toaster,
  track,
  previewTurnId,
  closePreview,
  setArtifactRef,
  openedRef,
}: {
  artifactServer: ArtifactServer;
  queryClient: QueryClient;
  toaster: ReturnType<typeof useToasterOptional>;
  track: TrackAnalytics;
  previewTurnId: string | undefined;
  closePreview: () => void;
  setArtifactRef: ((ref: string | null) => void) | undefined;
  openedRef: MutableRefObject<string | null>;
}) {
  const saveTitle = async ({ artifact, title }: { artifact: Artifact; title: string }) => {
    try {
      await artifactServer.updateArtifact({ id: artifact.id, title });
      track(AnalyticsEvents.Artifact.EDITED, { artifact_slug: artifact.slug });
      toaster?.showSuccess({ title: 'Artifact updated' });
      void queryClient.invalidateQueries({ queryKey: queryKeys.artifacts.all() });
      return true;
    } catch (caught) {
      toaster?.showError(caught);
      return false;
    }
  };

  const deleteArtifact = async (artifact: Artifact) => {
    try {
      await artifactServer.deleteArtifact({ id: artifact.id });
      if (artifactPreviewKey(artifact) === previewTurnId) {
        openedRef.current = null;
        closePreview();
        setArtifactRef?.(null);
      }
      track(AnalyticsEvents.Artifact.DELETED, { artifact_slug: artifact.slug });
      toaster?.showSuccess({ title: 'Artifact deleted' });
      void queryClient.invalidateQueries({ queryKey: queryKeys.artifacts.all() });
    } catch (caught) {
      toaster?.showError(caught);
    }
  };

  return { saveTitle, deleteArtifact };
}
