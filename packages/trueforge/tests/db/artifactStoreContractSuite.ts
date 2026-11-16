import type { Subject } from '@truefoundry/trueforge-core/agent-session';
import {
  ArtifactSlugConflictError,
  type IArtifactStore,
  type InsertArtifactVersionInput,
} from '../../src/db/artifactStore';

const TENANT = 'default';
const SUBJECT: Subject = {
  subject_id: 'user-1',
  subject_type: 'user',
  subject_display_name: 'User One',
};

function versionInput(
  overrides: Partial<InsertArtifactVersionInput> & Pick<InsertArtifactVersionInput, 'id' | 'artifact_id' | 'version'>,
): InsertArtifactVersionInput {
  return {
    tenant_id: TENANT,
    entry_path: 'index.html',
    entry_content_type: 'html',
    file_count: 1,
    total_size_bytes: 12,
    manifest_sha256: 'abc',
    session_id: 'session-1',
    turn_id: 'turn-1',
    source_root: '/workspace/report',
    note: null,
    storage_backend: 'local',
    storage_location: `default/${overrides.artifact_id}/${overrides.id}`,
    created_by_subject: SUBJECT,
    files: [{ path: 'index.html', size_bytes: 12, sha256: 'abc', media_type: 'text/html; charset=utf-8' }],
    ...overrides,
  };
}

export function runArtifactStoreContractSuite(getStore: () => IArtifactStore): void {
  it('inserts an artifact, a version, and its files, then lists them', async () => {
    const store = getStore();
    const created = await store.insertArtifact({
      id: 'art-1',
      tenant_id: TENANT,
      slug: 'q3-report',
      title: 'Q3 report',
      description: null,
      created_by_subject: SUBJECT,
    });
    expect(created.latest_version).toBe(0);
    expect(created.created_by_subject).toEqual(SUBJECT);

    await store.insertVersion(
      versionInput({
        id: 'ver-1',
        artifact_id: 'art-1',
        version: 1,
        files: [
          { path: 'index.html', size_bytes: 12, sha256: 'aaa', media_type: 'text/html; charset=utf-8' },
          { path: 'assets/app.css', size_bytes: 4, sha256: 'bbb', media_type: 'text/css; charset=utf-8' },
        ],
        file_count: 2,
        total_size_bytes: 16,
      }),
    );

    const artifact = await store.getArtifact({ tenant_id: TENANT, id: 'art-1' });
    expect(artifact?.latest_version).toBe(1);
    expect(await store.getArtifactBySlug({ tenant_id: TENANT, slug: 'q3-report' })).toEqual(artifact);
    const files = await store.listFiles({ tenant_id: TENANT, artifact_version_id: 'ver-1' });
    expect(files.map(file => file.path)).toEqual(['assets/app.css', 'index.html']);
    expect(await store.listVersionLocations({ tenant_id: TENANT, artifact_id: 'art-1' })).toEqual([
      { storage_backend: 'local', storage_location: 'default/art-1/ver-1' },
    ]);
  });

  it('rejects a duplicate slug in the same tenant and allows it in another', async () => {
    const store = getStore();
    await store.insertArtifact({
      id: 'art-1',
      tenant_id: TENANT,
      slug: 'shared',
      title: 'One',
      description: null,
      created_by_subject: SUBJECT,
    });
    await expect(
      store.insertArtifact({
        id: 'art-2',
        tenant_id: TENANT,
        slug: 'shared',
        title: 'Two',
        description: null,
        created_by_subject: SUBJECT,
      }),
    ).rejects.toBeInstanceOf(ArtifactSlugConflictError);
    await store.insertArtifact({
      id: 'art-3',
      tenant_id: 'other',
      slug: 'shared',
      title: 'Other',
      description: null,
      created_by_subject: SUBJECT,
    });
    expect((await store.getArtifactBySlug({ tenant_id: 'other', slug: 'shared' }))?.id).toBe('art-3');
  });

  it('filters the list by slug, creator, session, and query, and frees the slug on delete', async () => {
    const store = getStore();
    await store.insertArtifact({
      id: 'art-1',
      tenant_id: TENANT,
      slug: 'revenue-report',
      title: 'Revenue',
      description: null,
      created_by_subject: SUBJECT,
    });
    await store.insertVersion(versionInput({ id: 'ver-1', artifact_id: 'art-1', version: 1, session_id: 'session-9' }));
    const other: Subject = { ...SUBJECT, subject_id: 'user-2' };
    await store.insertArtifact({
      id: 'art-2',
      tenant_id: TENANT,
      slug: 'notes',
      title: 'Notes',
      description: null,
      created_by_subject: other,
    });

    const bySlug = await store.listArtifacts({
      tenant_id: TENANT,
      limit: 25,
      page_token: undefined,
      slug: 'revenue-report',
      session_id: undefined,
      created_by_subject_id: undefined,
      query: undefined,
    });
    expect(bySlug.data.map(row => row.id)).toEqual(['art-1']);

    const bySession = await store.listArtifacts({
      tenant_id: TENANT,
      limit: 25,
      page_token: undefined,
      slug: undefined,
      session_id: 'session-9',
      created_by_subject_id: undefined,
      query: undefined,
    });
    expect(bySession.data.map(row => row.id)).toEqual(['art-1']);

    const byCreator = await store.listArtifacts({
      tenant_id: TENANT,
      limit: 25,
      page_token: undefined,
      slug: undefined,
      session_id: undefined,
      created_by_subject_id: 'user-2',
      query: undefined,
    });
    expect(byCreator.data.map(row => row.id)).toEqual(['art-2']);

    const byQuery = await store.listArtifacts({
      tenant_id: TENANT,
      limit: 25,
      page_token: undefined,
      slug: undefined,
      session_id: undefined,
      created_by_subject_id: undefined,
      query: 'rev',
    });
    expect(byQuery.data.map(row => row.id)).toEqual(['art-1']);
    const escaped = await store.listArtifacts({
      tenant_id: TENANT,
      limit: 25,
      page_token: undefined,
      slug: undefined,
      session_id: undefined,
      created_by_subject_id: undefined,
      query: 'rev_en%',
    });
    expect(escaped.data).toEqual([]);

    expect(await store.deleteArtifact({ tenant_id: TENANT, id: 'art-1' })).toBe(true);
    expect(await store.getArtifactBySlug({ tenant_id: TENANT, slug: 'revenue-report' })).toBeUndefined();
    await store.insertArtifact({
      id: 'art-3',
      tenant_id: TENANT,
      slug: 'revenue-report',
      title: 'Again',
      description: null,
      created_by_subject: SUBJECT,
    });
  });

  it('keeps an omitted description and clears it with null', async () => {
    const store = getStore();
    await store.insertArtifact({
      id: 'art-1',
      tenant_id: TENANT,
      slug: 'report',
      title: 'Report',
      description: 'kept',
      created_by_subject: SUBJECT,
    });
    await store.updateArtifact({ tenant_id: TENANT, id: 'art-1', title: 'Renamed', description: undefined });
    expect((await store.getArtifact({ tenant_id: TENANT, id: 'art-1' }))?.description).toBe('kept');
    await store.updateArtifact({ tenant_id: TENANT, id: 'art-1', title: 'Renamed', description: null });
    expect((await store.getArtifact({ tenant_id: TENANT, id: 'art-1' }))?.description).toBeNull();
  });

  it('returns only the latest version of each artifact in one call', async () => {
    const store = getStore();
    for (const id of ['art-1', 'art-2', 'art-3']) {
      await store.insertArtifact({
        id,
        tenant_id: TENANT,
        slug: id,
        title: id,
        description: null,
        created_by_subject: SUBJECT,
      });
    }
    await store.insertVersion(versionInput({ id: 'ver-1a', artifact_id: 'art-1', version: 1 }));
    await store.insertVersion(versionInput({ id: 'ver-1b', artifact_id: 'art-1', version: 2 }));
    await store.insertVersion(versionInput({ id: 'ver-2a', artifact_id: 'art-2', version: 1 }));

    const latest = await store.listLatestVersions({
      tenant_id: TENANT,
      artifact_ids: ['art-1', 'art-2', 'art-3'],
    });
    expect(latest.map(version => version.id).sort()).toEqual(['ver-1b', 'ver-2a']);
    expect(await store.listLatestVersions({ tenant_id: TENANT, artifact_ids: [] })).toEqual([]);
    expect(await store.listLatestVersions({ tenant_id: 'other', artifact_ids: ['art-1'] })).toEqual([]);
  });

  it('sums version bytes per tenant across artifacts', async () => {
    const store = getStore();
    expect(await store.sumVersionBytes({ tenant_id: TENANT })).toBe(0);
    for (const id of ['art-1', 'art-2']) {
      await store.insertArtifact({
        id,
        tenant_id: TENANT,
        slug: id,
        title: id,
        description: null,
        created_by_subject: SUBJECT,
      });
    }
    await store.insertVersion(versionInput({ id: 'ver-1a', artifact_id: 'art-1', version: 1, total_size_bytes: 100 }));
    await store.insertVersion(versionInput({ id: 'ver-1b', artifact_id: 'art-1', version: 2, total_size_bytes: 50 }));
    await store.insertVersion(versionInput({ id: 'ver-2a', artifact_id: 'art-2', version: 1, total_size_bytes: 7 }));
    expect(await store.sumVersionBytes({ tenant_id: TENANT })).toBe(157);
    expect(await store.sumVersionBytes({ tenant_id: 'other' })).toBe(0);
  });
}
