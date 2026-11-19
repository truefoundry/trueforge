import type { Subject } from '@truefoundry/trueforge-core/agent-session';
import {
  ArtifactSlugConflictError,
  type CommitArtifactVersionInput,
  type IArtifactStore,
} from '../../src/db/artifactStore';

const TENANT = 'default';
const OTHER_TENANT = 'other';
const SUBJECT: Subject = { subject_id: 'tester', subject_type: 'user', subject_display_name: 'tester' };

function file(path: string, version: number): CommitArtifactVersionInput['files'][number] {
  return {
    path,
    size_bytes: 100,
    storage_key: `artifacts/${TENANT}/a/${String(version)}/${path}`,
    sha256: 'a'.repeat(64),
  };
}

export function runArtifactStoreContractSuite(getStore: () => IArtifactStore): void {
  async function createArtifact(tenant_id = TENANT) {
    return getStore().createArtifact({
      tenant_id,
      slug: 'q3-report',
      title: 'Q3 report',
      created_by_subject: SUBJECT,
      created_by_session_id: 'session-1',
    });
  }

  async function createVersion(artifact_id: string) {
    const version = await getStore().createVersion({
      tenant_id: TENANT,
      artifact_id,
      entrypoint: 'index.html',
      created_by_turn_id: 'turn-1',
    });
    if (version === undefined) {
      throw new Error('Expected version to be created');
    }
    return version;
  }

  it('creates and gets an artifact; slug is unique per tenant', async () => {
    const created = await createArtifact();
    expect(created).toEqual(
      expect.objectContaining({ tenant_id: TENANT, slug: 'q3-report', latest_version: 0, created_by_subject: SUBJECT }),
    );
    expect(await getStore().getArtifact({ tenant_id: TENANT, slug: 'q3-report' })).toEqual(created);
    await expect(createArtifact()).rejects.toBeInstanceOf(ArtifactSlugConflictError);
    await expect(createArtifact(OTHER_TENANT)).resolves.toEqual(expect.objectContaining({ tenant_id: OTHER_TENANT }));
  });

  it('allocates pending versions and commits them with files', async () => {
    const store = getStore();
    const artifact = await createArtifact();
    const v1 = await createVersion(artifact.id);
    const v2 = await createVersion(artifact.id);
    expect([v1.version, v2.version]).toEqual([1, 2]);
    expect(v1.status).toBe('pending');

    const files = [file('assets/chart.png', 2), file('index.html', 2)];
    const afterV2 = await store.commitVersion({ tenant_id: TENANT, artifact_id: artifact.id, version: 2, files });
    expect(afterV2?.latest_version).toBe(2);
    // An older commit must not move latest_version backwards.
    const afterV1 = await store.commitVersion({
      tenant_id: TENANT,
      artifact_id: artifact.id,
      version: 1,
      files: [file('index.html', 1)],
    });
    expect(afterV1?.latest_version).toBe(2);
    expect(
      await store.commitVersion({ tenant_id: TENANT, artifact_id: artifact.id, version: 2, files }),
    ).toBeUndefined();

    const fetched = await store.getVersion({ tenant_id: TENANT, artifact_id: artifact.id, version: 2 });
    expect(fetched).toEqual(
      expect.objectContaining({ status: 'committed', entrypoint: 'index.html', created_by_turn_id: 'turn-1' }),
    );
    expect(fetched?.files).toHaveLength(files.length);
    for (const f of files) {
      expect(fetched?.files).toContainEqual(expect.objectContaining(f));
    }
    expect(fetched?.files.every(f => !Number.isNaN(Date.parse(f.created_at)))).toBe(true);
  });

  it('fails only pending versions', async () => {
    const store = getStore();
    const artifact = await createArtifact();
    const v1 = await createVersion(artifact.id);
    const key = { tenant_id: TENANT, artifact_id: artifact.id, version: v1.version };
    expect(await store.failVersion(key)).toBe(true);
    expect(await store.failVersion(key)).toBe(false);
    expect(await store.commitVersion({ ...key, files: [] })).toBeUndefined();
    expect((await store.getVersion(key))?.status).toBe('failed');
  });

  it('hides versions from other tenants', async () => {
    const store = getStore();
    const artifact = await createArtifact();
    const v1 = await createVersion(artifact.id);
    const key = { tenant_id: OTHER_TENANT, artifact_id: artifact.id, version: v1.version };
    expect(
      await store.createVersion({
        tenant_id: OTHER_TENANT,
        artifact_id: artifact.id,
        entrypoint: 'index.html',
        created_by_turn_id: 'turn-1',
      }),
    ).toBeUndefined();
    expect(await store.commitVersion({ ...key, files: [] })).toBeUndefined();
    expect(await store.failVersion(key)).toBe(false);
    expect(await store.getVersion(key)).toBeUndefined();
  });
}
