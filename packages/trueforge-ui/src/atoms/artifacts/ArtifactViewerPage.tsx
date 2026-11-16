'use client';

import { useEffect, useState, type ComponentType } from 'react';

import { useTrackAnalytics } from '../../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../../analytics/events.js';
import { useArtifactServer } from '../../server/ServerContext.js';
import { useShellMode } from '../../server/ShellModeContext.js';
import type { Artifact, ArtifactContentToken, ArtifactVersion } from '../../server/types.js';
import { triggerBrowserDownload } from '../../utils/triggerBrowserDownload.js';
import { RenderedDocument } from '../RenderedDocument.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { FileTree } from '../primitives/FileTree.js';
import { formatBytes } from './formatBytes.js';

export type ArtifactViewerPageProps = {
  slug: string;
  version: number | null;
};

export function ArtifactViewerPage({ slug, version }: ArtifactViewerPageProps) {
  const artifacts = useArtifactServer();
  const shell = useShellMode();
  const track = useTrackAnalytics();
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [versions, setVersions] = useState<ArtifactVersion[]>([]);
  const [selected, setSelected] = useState<ArtifactVersion | null>(null);
  const [token, setToken] = useState<ArtifactContentToken | null>(null);
  const [markdown, setMarkdown] = useState<string>('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    track(AnalyticsEvents.Artifact.VIEWER_OPENED, { slug });
  }, [slug, track]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const page = await artifacts.listArtifacts({ slug, limit: 1 });
        const found = page.data[0];
        if (found == null) {
          if (!cancelled) setError('Artifact not found');
          return;
        }
        const resolved = await artifacts.getVersion({
          artifactId: found.id,
          version: version ?? found.latestVersion.version,
        });
        const [contentToken, versionPage] = await Promise.all([
          artifacts.getContentToken({ artifactId: found.id, version: resolved.version }),
          artifacts.listVersions({ artifactId: found.id, limit: 25 }),
        ]);
        if (cancelled) return;
        setArtifact(found);
        setVersions(versionPage.data);
        setSelected(resolved);
        setToken(contentToken);
        setSelectedPath(resolved.entryPath);
        setError(null);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not open artifact');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [artifacts, slug, version]);

  useEffect(() => {
    const path = selectedPath ?? selected?.entryPath;
    if (token == null || path == null || !(path.endsWith('.md') || path.endsWith('.markdown'))) return;
    let cancelled = false;
    void fetch(`${token.baseUrl}${path}`)
      .then(response => response.text())
      .then(text => {
        if (!cancelled) setMarkdown(text);
      })
      .catch(() => {
        if (!cancelled) setMarkdown('');
      });
    return () => {
      cancelled = true;
    };
  }, [selected, selectedPath, token]);

  const contentPath = selectedPath ?? selected?.entryPath ?? '';
  const contentUrl = token == null ? undefined : `${token.baseUrl}${contentPath}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <button
          type="button"
          className={auiButtonClass({ variant: 'ghost', size: 'small' })}
          onClick={() => shell.setArtifactsOpen(true)}
        >
          Artifacts
        </button>
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{artifact?.title ?? slug}</h1>
        {selected != null && artifact != null ? (
          <label className="flex items-center gap-2 text-sm">
            Version
            <select
              value={String(selected.version)}
              onChange={event => shell.openArtifactViewer({ slug, version: Number(event.target.value) })}
              className="rounded-md border border-border bg-primary-bg px-2 py-1"
            >
              {versions.map(item => (
                <option key={item.version} value={String(item.version)}>
                  v{String(item.version)}
                  {artifact.latestVersion.version === item.version ? ' latest' : ''}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button
          type="button"
          className={auiButtonClass({ variant: 'ghost', size: 'small' })}
          onClick={() => {
            const link =
              artifact == null ? '' : version == null ? artifact.url : `${artifact.url}?version=${String(version)}`;
            void navigator.clipboard.writeText(link);
            track(AnalyticsEvents.Artifact.LINK_COPIED);
          }}
        >
          Copy link
        </button>
        {selected != null ? (
          <button
            type="button"
            className={auiButtonClass({ variant: 'ghost', size: 'small' })}
            onClick={() => {
              track(AnalyticsEvents.Artifact.SESSION_OPENED);
              shell.openHistorySession({ sessionId: selected.sessionId });
            }}
          >
            Open session
          </button>
        ) : null}
        {artifact != null && selected != null ? (
          <button
            type="button"
            className={auiButtonClass({ variant: 'ghost', size: 'small' })}
            onClick={() => {
              void artifacts.downloadVersion({ artifactId: artifact.id, version: selected.version }).then(blob => {
                const entryName = selected.entryPath.split('/').pop() ?? artifact.slug;
                track(AnalyticsEvents.Artifact.DOWNLOADED);
                triggerBrowserDownload(
                  blob,
                  selected.fileCount > 1 ? `${artifact.slug}-v${String(selected.version)}.zip` : entryName,
                );
              });
            }}
          >
            Download
          </button>
        ) : null}
        {artifact != null ? (
          <button
            type="button"
            className={auiButtonClass({ variant: 'ghost', size: 'small' })}
            onClick={() => {
              void artifacts.deleteArtifact({ id: artifact.id }).then(() => {
                track(AnalyticsEvents.Artifact.DELETED);
                shell.setArtifactsOpen(true);
              });
            }}
          >
            Delete
          </button>
        ) : null}
      </header>
      {error != null ? <p className="p-4 text-sm text-destructive">{error}</p> : null}
      <div className="flex min-h-0 flex-1">
        {selected != null && selected.files.length > 1 ? (
          <aside className="w-64 shrink-0 overflow-auto border-r border-border p-2">
            <FileTree
              files={selected.files.map(file => ({ path: file.path, detail: formatBytes(file.sizeBytes) }))}
              {...(selectedPath != null ? { selectedPath } : {})}
              onSelect={path => {
                track(AnalyticsEvents.Artifact.FILE_SELECTED, { path });
                setSelectedPath(path);
              }}
            />
          </aside>
        ) : null}
        <div className="relative min-h-0 min-w-0 flex-1">
          {contentUrl != null && (contentPath.endsWith('.html') || contentPath.endsWith('.htm')) ? (
            <RenderedDocument name={artifact?.title ?? slug} kind="html" contentUrl={contentUrl} />
          ) : null}
          {contentPath.endsWith('.md') || contentPath.endsWith('.markdown') ? (
            <RenderedDocument name={artifact?.title ?? slug} kind="markdown" text={markdown} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    ArtifactViewerPage: ComponentType<ArtifactViewerPageProps>;
  }
}
