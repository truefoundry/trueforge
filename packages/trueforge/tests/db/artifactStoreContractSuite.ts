import type { Subject } from '@truefoundry/trueforge-core/agent-session';
import { ArtifactSlugConflictError, type ArtifactFileRecord, type IArtifactStore } from '../../src/db/artifactStore';

const TENANT = 'default';
const OTHER_TENANT = 'other';
const SESSION = 'session-1';
const SUBJECT: Subject = { subject_id: 'tester', subject_type: 'user', subject_display_name: 'tester' };

function file(path: string, size_bytes: number): ArtifactFileRecord {
  return {
    path,
    size_bytes,
    content_type: path.endsWith('.html') ? 'text/html' : 'text/css',
    storage_key: `artifacts/${TENANT}/${path}`,
    sha256: 'a'.repeat(64),
  };
}

export function runArtifactStoreContractSuite(getStore: () => IArtifactStore): void {
  async function createArtifact(slug = 'q3-report', tenant_id = TENANT) {
    return getStore().createArtifact({
      tenant_id,
      slug,
      title: 'Q3 report',
      kind: 'html',
      created_by_subject: SUBJECT,
      created_by_session_id: SESSION,
    });
  }

  async function pushVersion(artifact_id: string) {
    const version = await getStore().createVersion({
      tenant_id: TENANT,
      artifact_id,
      entrypoint: 'index.html',
      files: [file('index.html', 100), file('style.css', 20)],
      created_by_subject: SUBJECT,
      created_by_session_id: SESSION,
      created_by_turn_id: 'turn-1',
    });
    if (version === undefined) {
      throw new Error('Expected version to be created');
    }
    return version;
  }

  it('creates, reads, updates, and deletes an artifact', async () => {
    const store = getStore();
    const created = await createArtifact();
    expect(created).toEqual(
      expect.objectContaining({ tenant_id: TENANT, slug: 'q3-report', latest_version: 0, created_by_subject: SUBJECT }),
    );
    expect(await store.getArtifact({ tenant_id: TENANT, slug: 'q3-report' })).toEqual(created);
    expect(await store.getArtifact({ tenant_id: OTHER_TENANT, slug: 'q3-report' })).toBeUndefined();

    const updated = await store.updateArtifact({ tenant_id: TENANT, slug: 'q3-report', title: 'Renamed' });
    expect(updated?.title).toBe('Renamed');

    expect(await store.deleteArtifact({ tenant_id: TENANT, slug: 'q3-report' })).toBe(created.id);
    expect(await store.getArtifact({ tenant_id: TENANT, slug: 'q3-report' })).toBeUndefined();
    expect(await store.deleteArtifact({ tenant_id: TENANT, slug: 'q3-report' })).toBeUndefined();
  });

  it('scopes slug uniqueness to the tenant', async () => {
    await createArtifact();
    await expect(createArtifact()).rejects.toBeInstanceOf(ArtifactSlugConflictError);
    await expect(createArtifact('q3-report', OTHER_TENANT)).resolves.toEqual(
      expect.objectContaining({ tenant_id: OTHER_TENANT }),
    );
  });

  it('lists by recency with session and kind filters', async () => {
    const store = getStore();
    const first = await createArtifact('first');
    const second = await store.createArtifact({
      tenant_id: TENANT,
      slug: 'second',
      title: 'Second',
      kind: 'markdown',
      created_by_subject: SUBJECT,
      created_by_session_id: 'session-2',
    });
    await createArtifact('elsewhere', OTHER_TENANT);
    // Distinct updated_at so recency, not the id tie-break, decides the order.
    await new Promise(resolve => setTimeout(resolve, 5));
    await store.updateArtifact({ tenant_id: TENANT, slug: 'first', title: 'Touched' });

    const all = await store.listArtifacts({ tenant_id: TENANT, limit: undefined, page_token: undefined });
    expect(all.data.map(a => a.id)).toEqual([first.id, second.id]);

    const page = await store.listArtifacts({ tenant_id: TENANT, limit: 1, page_token: undefined });
    expect(page.data.map(a => a.id)).toEqual([first.id]);
    const next = await store.listArtifacts({
      tenant_id: TENANT,
      limit: 1,
      page_token: page.pagination.next_page_token,
    });
    expect(next.data.map(a => a.id)).toEqual([second.id]);

    const bySession = await store.listArtifacts({
      tenant_id: TENANT,
      created_by_session_id: 'session-2',
      limit: undefined,
      page_token: undefined,
    });
    expect(bySession.data.map(a => a.id)).toEqual([second.id]);

    const byKind = await store.listArtifacts({
      tenant_id: TENANT,
      kind: 'html',
      limit: undefined,
      page_token: undefined,
    });
    expect(byKind.data.map(a => a.id)).toEqual([first.id]);
  });

  it('allocates monotonic versions and commits them', async () => {
    const store = getStore();
    const artifact = await createArtifact();
    const v1 = await pushVersion(artifact.id);
    const v2 = await pushVersion(artifact.id);
    expect([v1.version, v2.version]).toEqual([1, 2]);
    expect(v1).toEqual(
      expect.objectContaining({
        status: 'pending',
        total_bytes: 120,
        entrypoint: 'index.html',
        created_by_turn_id: 'turn-1',
      }),
    );
    expect(v1.files.map(f => f.path).sort()).toEqual(['index.html', 'style.css']);

    const afterV2 = await store.commitVersion({
      tenant_id: TENANT,
      artifact_id: artifact.id,
      version: 2,
      kind: 'mixed',
    });
    expect(afterV2).toEqual(expect.objectContaining({ latest_version: 2, kind: 'mixed' }));
    // Committing an older version must not move the pointer backwards.
    const afterV1 = await store.commitVersion({
      tenant_id: TENANT,
      artifact_id: artifact.id,
      version: 1,
      kind: 'html',
    });
    expect(afterV1?.latest_version).toBe(2);
    // Already committed → no pending row matched.
    expect(
      await store.commitVersion({ tenant_id: TENANT, artifact_id: artifact.id, version: 2, kind: 'html' }),
    ).toBeUndefined();

    const fetched = await store.getVersion({ tenant_id: TENANT, artifact_id: artifact.id, version: 2 });
    expect(fetched).toEqual(expect.objectContaining({ status: 'committed', files: v2.files }));
    expect((await store.listVersions({ tenant_id: TENANT, artifact_id: artifact.id })).map(v => v.version)).toEqual([
      2, 1,
    ]);
  });

  it('fails pending versions without moving latest_version', async () => {
    const store = getStore();
    const artifact = await createArtifact();
    const v1 = await pushVersion(artifact.id);
    const failed = await store.failVersion({ tenant_id: TENANT, artifact_id: artifact.id, version: v1.version });
    expect(failed?.status).toBe('failed');
    expect(
      await store.commitVersion({ tenant_id: TENANT, artifact_id: artifact.id, version: v1.version, kind: 'html' }),
    ).toBeUndefined();
    expect((await store.getArtifact({ tenant_id: TENANT, slug: artifact.slug }))?.latest_version).toBe(0);
  });

  it('hides versions from other tenants and cascades on delete', async () => {
    const store = getStore();
    const artifact = await createArtifact();
    await pushVersion(artifact.id);
    expect(
      await store.createVersion({
        tenant_id: OTHER_TENANT,
        artifact_id: artifact.id,
        entrypoint: 'index.html',
        files: [file('index.html', 1)],
        created_by_subject: SUBJECT,
        created_by_session_id: SESSION,
        created_by_turn_id: null,
      }),
    ).toBeUndefined();
    expect(await store.getVersion({ tenant_id: OTHER_TENANT, artifact_id: artifact.id, version: 1 })).toBeUndefined();
    expect(await store.listVersions({ tenant_id: OTHER_TENANT, artifact_id: artifact.id })).toEqual([]);
    expect(
      await store.commitVersion({ tenant_id: OTHER_TENANT, artifact_id: artifact.id, version: 1, kind: 'html' }),
    ).toBeUndefined();

    await store.deleteArtifact({ tenant_id: TENANT, slug: artifact.slug });
    expect(await store.getVersion({ tenant_id: TENANT, artifact_id: artifact.id, version: 1 })).toBeUndefined();
  });
}
