'use client';

import { useEffect, useState, type ComponentType } from 'react';

import { useTrackAnalytics } from '../../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../../analytics/events.js';
import { useArtifactServer } from '../../server/ServerContext.js';
import { useOptionalShellMode } from '../../server/ShellModeContext.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { Dialog, DialogContent, DialogHeader } from '../primitives/Dialog.js';
import { FileTree } from '../primitives/FileTree.js';
import { formatBytes } from './formatBytes.js';

export type PublishArtifactDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  turnId: string;
  entryPath: string;
  suggestedTitle: string;
};

export function PublishArtifactDialog({
  open,
  onOpenChange,
  sessionId,
  turnId,
  entryPath,
  suggestedTitle,
}: PublishArtifactDialogProps) {
  const artifacts = useArtifactServer();
  const shell = useOptionalShellMode();
  const track = useTrackAnalytics();
  const [title, setTitle] = useState(suggestedTitle);
  const [slug, setSlug] = useState('');
  const [note, setNote] = useState('');
  const [showFiles, setShowFiles] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof artifacts.previewBundle>> | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [existingSlug, setExistingSlug] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(suggestedTitle);
    setSlug('');
    setNote('');
    setShowFiles(false);
    setError(null);
    let cancelled = false;
    void (async () => {
      try {
        const listed = await artifacts.listArtifacts({ sessionId, limit: 25 });
        const match = listed.data.find(artifact => artifact.latestVersion?.entryPath === entryPath);
        const nextPreview = await artifacts.previewBundle({
          sessionId,
          turnId,
          entryPath,
          ...(match == null ? {} : { artifactId: match.id }),
        });
        if (cancelled) return;
        setExistingId(match?.id ?? null);
        setExistingSlug(match?.slug ?? null);
        setPreview(nextPreview);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not preview this bundle');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [artifacts, entryPath, open, sessionId, suggestedTitle, turnId]);

  const publish = () => {
    if (busy || preview == null) return;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const published =
          existingId == null
            ? await artifacts.createArtifact({
                title: title.trim(),
                ...(slug.trim() === '' ? {} : { slug: slug.trim() }),
                ...(note.trim() === '' ? {} : { note: note.trim() }),
                sessionId,
                turnId,
                entryPath,
              })
            : null;
        if (existingId != null) {
          await artifacts.createVersion({
            artifactId: existingId,
            ...(note.trim() === '' ? {} : { note: note.trim() }),
            sessionId,
            turnId,
            entryPath,
          });
        }
        track(AnalyticsEvents.Artifact.PUBLISHED, {
          mode: existingId == null ? 'create' : 'version',
          entry_content_type: preview.entryContentType,
          file_count: preview.files.length,
        });
        const slugToOpen = published?.slug ?? existingSlug;
        onOpenChange(false);
        if (slugToOpen != null) shell?.openArtifactViewer({ slug: slugToOpen, version: null });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not publish');
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} aria-label="Publish artifact">
      <DialogContent>
        <DialogHeader>
          <h2 className="text-base font-semibold">Publish artifact</h2>
          <p className="text-sm text-text-secondary">
            {preview == null
              ? 'Looking up the files this page needs…'
              : `${String(preview.files.length)} files · ${formatBytes(preview.totalSizeBytes)} will be published`}
          </p>
        </DialogHeader>
        <label className="flex flex-col gap-1 text-sm">
          Title
          <input
            value={title}
            onChange={event => setTitle(event.target.value)}
            className="rounded-md border border-border bg-primary-bg px-2 py-1.5"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Slug
          <input
            value={slug}
            onChange={event => setSlug(event.target.value)}
            placeholder="Leave blank to generate one"
            className="rounded-md border border-border bg-primary-bg px-2 py-1.5"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Note
          <input
            value={note}
            onChange={event => setNote(event.target.value)}
            className="rounded-md border border-border bg-primary-bg px-2 py-1.5"
          />
        </label>
        {preview != null && preview.missing.length > 0 ? (
          <p className="text-sm text-destructive">
            Missing {preview.missing.join(', ')}. Those references will not be in the published page.
          </p>
        ) : null}
        {preview?.changes != null ? (
          <p className="text-sm text-text-secondary">
            {String(preview.changes.added)} added, {String(preview.changes.removed)} removed,{' '}
            {String(preview.changes.changed)} changed since the latest version.
          </p>
        ) : null}
        <button type="button" className="self-start text-sm underline" onClick={() => setShowFiles(value => !value)}>
          {showFiles ? 'Hide files' : 'Show files'}
        </button>
        {showFiles && preview != null ? (
          <FileTree files={preview.files.map(file => ({ path: file.path, detail: formatBytes(file.sizeBytes) }))} />
        ) : null}
        {error != null ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" className={auiButtonClass({ variant: 'ghost' })} onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button
            type="button"
            className={auiButtonClass({ variant: 'primary' })}
            disabled={busy || preview == null || title.trim() === ''}
            onClick={publish}
          >
            {busy ? 'Publishing…' : existingId == null ? 'Publish' : 'Publish version'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    PublishArtifactDialog: ComponentType<PublishArtifactDialogProps>;
  }
}
