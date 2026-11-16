'use client';

import { Fragment, useEffect, useState, type ComponentType } from 'react';

import { useTrackAnalytics } from '../../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../../analytics/events.js';
import { useArtifactServer } from '../../server/ServerContext.js';
import { useShellMode } from '../../server/ShellModeContext.js';
import type { Artifact, ArtifactVersion } from '../../server/types.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { formatBytes } from './formatBytes.js';

export type ArtifactsPageProps = {
  className?: string;
};

export function ArtifactsPage({ className }: ArtifactsPageProps) {
  const artifacts = useArtifactServer();
  const shell = useShellMode();
  const track = useTrackAnalytics();
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<Artifact[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [versions, setVersions] = useState<ArtifactVersion[]>([]);

  useEffect(() => {
    let cancelled = false;
    void artifacts
      .listArtifacts({ ...(query.trim() === '' ? {} : { query: query.trim() }), limit: 25 })
      .then(page => {
        if (!cancelled) setRows(page.data);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load artifacts');
      });
    return () => {
      cancelled = true;
    };
  }, [artifacts, query]);

  const openVersions = (artifact: Artifact) => {
    setExpandedId(current => (current === artifact.id ? null : artifact.id));
    void artifacts.listVersions({ artifactId: artifact.id, limit: 25 }).then(page => setVersions(page.data));
  };

  return (
    <div className={className ?? 'flex h-full min-h-0 flex-col gap-4 p-6'}>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Artifacts</h1>
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search title or slug"
          aria-label="Search artifacts"
          className="w-64 rounded-md border border-border bg-primary-bg px-2 py-1.5 text-sm"
        />
      </div>
      {error != null ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="text-text-secondary">
            <tr>
              <th className="px-2 py-2 font-medium">Title</th>
              <th className="px-2 py-2 font-medium">Slug</th>
              <th className="px-2 py-2 font-medium">Version</th>
              <th className="px-2 py-2 font-medium">Updated</th>
              <th className="px-2 py-2 font-medium">Session</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(artifact => (
              <Fragment key={artifact.id}>
                <tr
                  className="cursor-pointer border-t border-border hover:bg-secondary-button-hover"
                  onClick={() => shell.openArtifactViewer({ slug: artifact.slug, version: null })}
                >
                  <td className="px-2 py-2">{artifact.title}</td>
                  <td className="px-2 py-2 font-mono">{artifact.slug}</td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      className="underline"
                      onClick={event => {
                        event.stopPropagation();
                        openVersions(artifact);
                      }}
                    >
                      {artifact.latestVersion == null ? '—' : `v${String(artifact.latestVersion.version)}`}
                    </button>
                  </td>
                  <td className="px-2 py-2">{new Date(artifact.updatedAt).toLocaleString()}</td>
                  <td className="px-2 py-2">
                    {artifact.latestVersion == null ? null : (
                      <button
                        type="button"
                        className={auiButtonClass({ variant: 'ghost', size: 'small' })}
                        onClick={event => {
                          event.stopPropagation();
                          const sessionId = artifact.latestVersion?.sessionId;
                          if (sessionId == null) return;
                          track(AnalyticsEvents.Artifact.SESSION_OPENED);
                          shell.openHistorySession({ sessionId });
                        }}
                      >
                        Open session
                      </button>
                    )}
                  </td>
                </tr>
                {expandedId === artifact.id
                  ? versions.map(version => (
                      <tr key={version.version} className="border-t border-border bg-secondary-bg text-text-secondary">
                        <td className="px-2 py-2" colSpan={2}>
                          v{String(version.version)} · {version.note ?? 'No note'} ·{' '}
                          {formatBytes(version.totalSizeBytes)}
                        </td>
                        <td className="px-2 py-2" colSpan={2}>
                          {version.entryPath}
                        </td>
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            className={auiButtonClass({ variant: 'ghost', size: 'small' })}
                            onClick={() => {
                              track(AnalyticsEvents.Artifact.SESSION_OPENED);
                              shell.openHistorySession({ sessionId: version.sessionId });
                            }}
                          >
                            Open session
                          </button>
                        </td>
                      </tr>
                    ))
                  : null}
              </Fragment>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && error == null ? (
          <p className="px-2 py-6 text-sm text-text-secondary">No artifacts yet.</p>
        ) : null}
      </div>
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    ArtifactsPage: ComponentType<ArtifactsPageProps>;
  }
}
