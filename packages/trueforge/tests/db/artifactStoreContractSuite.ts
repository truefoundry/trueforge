import type { Subject } from '@truefoundry/trueforge-core/agent-session';
import { ArtifactSlugConflictError, type IArtifactStore } from '../../src/db/artifactStore';

const TENANT = 'default';
const OTHER_TENANT = 'other';
const SUBJECT: Subject = { subject_id: 'tester', subject_type: 'user', subject_display_name: 'tester' };

export function runArtifactStoreContractSuite(getStore: () => IArtifactStore): void {
  async function createArtifact(tenantId = TENANT) {
    return getStore().createArtifact({
      tenant_id: tenantId,
      slug: 'q3-report',
      title: 'Q3 report',
      created_by_subject: SUBJECT,
      created_by_session_id: 'session-1',
    });
  }

  async function createVersion(artifactId: string, uploadId: string) {
    const version = await getStore().createVersion({
      tenant_id: TENANT,
      artifact_id: artifactId,
      storage_prefix: `artifacts/${TENANT}/${artifactId}/${uploadId}/`,
      total_bytes: 100,
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

  it("lists the subject's artifacts in the tenant with pagination", async () => {
    const store = getStore();
    const slugs = ['a', 'b', 'c'];
    for (const slug of slugs) {
      await store.createArtifact({
        tenant_id: TENANT,
        slug,
        title: slug,
        created_by_subject: SUBJECT,
        created_by_session_id: 'session-1',
      });
    }
    await createArtifact(OTHER_TENANT);
    await store.createArtifact({
      tenant_id: TENANT,
      slug: 'other-subject',
      title: 'other',
      created_by_subject: { ...SUBJECT, subject_id: 'someone-else' },
      created_by_session_id: 'session-2',
    });

    const query = { tenant_id: TENANT, created_by_subject_id: SUBJECT.subject_id, limit: 2 };
    const first = await store.listArtifacts({ ...query, page_token: undefined });
    expect(first.data).toHaveLength(2);
    const second = await store.listArtifacts({ ...query, page_token: first.pagination.next_page_token });
    expect(second.data).toHaveLength(1);
    expect(second.pagination.next_page_token).toBeUndefined();
    expect([...first.data, ...second.data].map(a => a.slug).sort()).toEqual(slugs);
  });

  it('creates monotonic versions and advances latest_version', async () => {
    const store = getStore();
    const artifact = await createArtifact();
    const v1 = await createVersion(artifact.id, 'u1');
    const v2 = await createVersion(artifact.id, 'u2');
    expect([v1.version, v2.version]).toEqual([1, 2]);
    expect((await store.getArtifact({ tenant_id: TENANT, slug: artifact.slug }))?.latest_version).toBe(2);

    expect(await store.getVersion({ tenant_id: TENANT, artifact_id: artifact.id, version: 1 })).toEqual(v1);
    expect(v1).toEqual(
      expect.objectContaining({
        storage_prefix: `artifacts/${TENANT}/${artifact.id}/u1/`,
        total_bytes: 100,
      }),
    );
    expect(await store.getVersion({ tenant_id: TENANT, artifact_id: artifact.id, version: 3 })).toBeUndefined();
  });

  it('hides versions from other tenants', async () => {
    const store = getStore();
    const artifact = await createArtifact();
    const v1 = await createVersion(artifact.id, 'u1');
    expect(
      await store.createVersion({
        tenant_id: OTHER_TENANT,
        artifact_id: artifact.id,
        storage_prefix: 'p/',
        total_bytes: 1,
      }),
    ).toBeUndefined();
    expect(
      await store.getVersion({ tenant_id: OTHER_TENANT, artifact_id: artifact.id, version: v1.version }),
    ).toBeUndefined();
    expect((await store.getArtifact({ tenant_id: TENANT, slug: artifact.slug }))?.latest_version).toBe(1);
  });
}
