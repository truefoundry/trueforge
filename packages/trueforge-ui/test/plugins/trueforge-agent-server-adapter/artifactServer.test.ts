import { describe, expect, it } from 'vitest';

import { createArtifactServer } from '@/plugins/trueforge-agent-server-adapter/artifacts/artifactServer.js';

const subject = { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'Ada' };

const versionSummary = {
  artifact_id: 'art-1',
  version: 2,
  note: null,
  entry_path: 'index.html',
  entry_content_type: 'html',
  file_count: 1,
  total_size_bytes: 12,
  session_id: 'session-1',
  turn_id: 'turn-1',
  source_root: '/workspace/site',
  storage_backend: 'local',
  created_by_subject: subject,
  created_at: '2026-11-16T12:00:00.000Z',
};

describe('createArtifactServer', () => {
  it('reads created_by_subject and a files-free latest version', async () => {
    const fetchMock: typeof fetch = async input => {
      const url = String(input);
      if (url.endsWith('/api/v1/artifacts')) {
        return Response.json({
          data: [
            {
              id: 'art-1',
              slug: 'site',
              title: 'Site',
              description: null,
              url: '/artifacts/site',
              latest_version: versionSummary,
              created_by_subject: subject,
              created_at: '2026-11-16T12:00:00.000Z',
              updated_at: '2026-11-16T12:00:00.000Z',
            },
          ],
          pagination: {},
        });
      }
      if (url.endsWith('/api/v1/artifacts/art-1/versions/2')) {
        return Response.json({
          data: {
            ...versionSummary,
            files: [{ path: 'index.html', size_bytes: 12, sha256: 'abc', media_type: 'text/html' }],
          },
        });
      }
      return Response.json({ error: { message: `unexpected ${url}` } }, { status: 500 });
    };

    const artifacts = createArtifactServer({ fetch: fetchMock, baseUrl: 'http://localhost' });
    const listed = await artifacts.listArtifacts();
    const artifact = listed.data[0];
    expect(artifact?.latestVersion).toEqual({
      artifactId: 'art-1',
      version: 2,
      note: null,
      entryPath: 'index.html',
      entryContentType: 'html',
      fileCount: 1,
      totalSizeBytes: 12,
      sessionId: 'session-1',
      turnId: 'turn-1',
      sourceRoot: '/workspace/site',
      storageBackend: 'local',
      createdBySubject: { subjectId: 'user-1', subjectType: 'user', subjectDisplayName: 'Ada' },
      createdAt: '2026-11-16T12:00:00.000Z',
    });
    expect(artifact?.createdBySubject.subjectId).toBe('user-1');

    const version = await artifacts.getVersion({ artifactId: 'art-1', version: 2 });
    expect(version.files).toEqual([{ path: 'index.html', sizeBytes: 12, sha256: 'abc', mediaType: 'text/html' }]);
  });
});
