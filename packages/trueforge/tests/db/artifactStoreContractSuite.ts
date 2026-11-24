import type { Subject } from '@truefoundry/trueforge-core/agent-session';
import type { IArtifactStore, ListArtifactsInput } from '../../src/db/artifactStore';

const TENANT = 'default';
const OTHER_TENANT = 'other';
const SUBJECT: Subject = { subject_id: 'tester', subject_type: 'user', subject_display_name: 'tester' };
const OWNER = SUBJECT.subject_id;
const AGENT_ID = 'agent-1';

const LIST_DEFAULTS: ListArtifactsInput = {
  tenant_id: TENANT,
  created_by_subject_id: OWNER,
  created_by_session_id: undefined,
  name: undefined,
  limit: 10,
  page_token: undefined,
};

/** Keeps `updated_at` distinct between consecutive writes. */
async function tick(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 5));
}

export function runArtifactStoreContractSuite(getStore: () => IArtifactStore): void {
  async function createArtifact({
    tenantId = TENANT,
    name = 'Q3 report',
    sessionId = 'session-1',
    agentId = AGENT_ID,
  }: { tenantId?: string; name?: string; sessionId?: string; agentId?: string | null } = {}) {
    return getStore().createArtifact({
      tenant_id: tenantId,
      name,
      created_by_subject: SUBJECT,
      created_by_session_id: sessionId,
      created_by_agent_id: agentId,
    });
  }

  async function createVersion({ artifactId, entryPoint }: { artifactId: string; entryPoint: string }) {
    const version = await getStore().createVersion({
      tenant_id: TENANT,
      artifact_id: artifactId,
      entry_point: entryPoint,
      total_bytes: 100,
    });
    if (version === undefined) {
      throw new Error('Expected version to be created');
    }
    return version;
  }

  async function listNames(filters: Partial<ListArtifactsInput>): Promise<string[]> {
    const { data } = await getStore().listArtifacts({ ...LIST_DEFAULTS, ...filters });
    return data.map(a => a.name).sort();
  }

  it('creates an artifact', async () => {
    const created = await createArtifact({ name: 'Q3 report' });
    expect(created).toEqual(
      expect.objectContaining({
        tenant_id: TENANT,
        name: 'Q3 report',
        latest_version: 0,
        latest_entry_point: null,
        created_by_subject: SUBJECT,
        created_by_session_id: 'session-1',
        created_by_agent_id: AGENT_ID,
      }),
    );
    expect((await getStore().listArtifacts(LIST_DEFAULTS)).data).toEqual([created]);
    const inline = await createArtifact({ name: 'inline', agentId: null });
    expect(inline.created_by_agent_id).toBeNull();
  });

  it('allows artifacts with the same name', async () => {
    const first = await createArtifact();
    const second = await createArtifact();
    expect(second.id).not.toBe(first.id);
    expect(await listNames({})).toEqual(['Q3 report', 'Q3 report']);
  });

  it("lists the subject's artifacts in the tenant with pagination", async () => {
    const store = getStore();
    const names = ['a', 'b', 'c'];
    for (const name of names) {
      await createArtifact({ name });
    }
    await createArtifact({ tenantId: OTHER_TENANT });
    await store.createArtifact({
      tenant_id: TENANT,
      name: 'other',
      created_by_subject: { ...SUBJECT, subject_id: 'someone-else' },
      created_by_session_id: 'session-2',
      created_by_agent_id: AGENT_ID,
    });

    const first = await store.listArtifacts({ ...LIST_DEFAULTS, limit: 2 });
    expect(first.data).toHaveLength(2);
    const second = await store.listArtifacts({
      ...LIST_DEFAULTS,
      limit: 2,
      page_token: first.pagination.next_page_token,
    });
    expect(second.data).toHaveLength(1);
    expect(second.pagination.next_page_token).toBeUndefined();
    expect([...first.data, ...second.data].map(a => a.name).sort()).toEqual(names);
  });

  it('filters the list by session', async () => {
    await createArtifact({ name: 'one', sessionId: 'session-1' });
    await createArtifact({ name: 'two', sessionId: 'session-2' });
    expect(await listNames({ created_by_session_id: 'session-2' })).toEqual(['two']);
    expect(await listNames({ created_by_session_id: 'session-3' })).toEqual([]);
  });

  it('filters the list by case-insensitive name substring', async () => {
    await createArtifact({ name: 'Quarterly Report' });
    await createArtifact({ name: 'Roadmap' });
    expect(await listNames({ name: 'rep' })).toEqual(['Quarterly Report']);
    expect(await listNames({ name: 'MAP' })).toEqual(['Roadmap']);
    expect(await listNames({ name: 'missing' })).toEqual([]);
  });

  it('gets an artifact only within its tenant', async () => {
    const store = getStore();
    const artifact = await createArtifact();
    expect(await store.getArtifact({ tenant_id: TENANT, id: artifact.id, created_by_subject_id: OWNER })).toEqual(
      artifact,
    );
    expect(
      await store.getArtifact({ tenant_id: OTHER_TENANT, id: artifact.id, created_by_subject_id: OWNER }),
    ).toBeUndefined();
    expect(await store.getArtifact({ tenant_id: TENANT, id: 'missing', created_by_subject_id: OWNER })).toBeUndefined();
  });

  it('gets an artifact only for its creator', async () => {
    const artifact = await createArtifact();
    expect(
      await getStore().getArtifact({ tenant_id: TENANT, id: artifact.id, created_by_subject_id: 'someone-else' }),
    ).toBeUndefined();
  });

  it('renames an artifact within the tenant', async () => {
    const store = getStore();
    const artifact = await createArtifact();
    await tick();
    const renamed = await store.updateArtifact({
      tenant_id: TENANT,
      id: artifact.id,
      created_by_subject_id: OWNER,
      name: 'Renamed',
    });
    expect(renamed).toEqual({ ...artifact, name: 'Renamed', updated_at: renamed?.updated_at });
    expect(Date.parse(renamed?.updated_at ?? '')).toBeGreaterThan(Date.parse(artifact.updated_at));
    expect(await store.getArtifact({ tenant_id: TENANT, id: artifact.id, created_by_subject_id: OWNER })).toEqual(
      renamed,
    );
  });

  it('does not rename an artifact from another tenant', async () => {
    const store = getStore();
    const artifact = await createArtifact();
    await tick();
    expect(
      await store.updateArtifact({ tenant_id: OTHER_TENANT, id: artifact.id, created_by_subject_id: OWNER, name: 'x' }),
    ).toBeUndefined();
    expect(await store.getArtifact({ tenant_id: TENANT, id: artifact.id, created_by_subject_id: OWNER })).toEqual(
      artifact,
    );
  });

  it('does not rename an artifact created by another subject', async () => {
    const store = getStore();
    const artifact = await createArtifact();
    await tick();
    expect(
      await store.updateArtifact({
        tenant_id: TENANT,
        id: artifact.id,
        created_by_subject_id: 'someone-else',
        name: 'x',
      }),
    ).toBeUndefined();
    expect(await store.getArtifact({ tenant_id: TENANT, id: artifact.id, created_by_subject_id: OWNER })).toEqual(
      artifact,
    );
  });

  it('creates monotonic versions and advances latest_version, latest_entry_point and updated_at', async () => {
    const store = getStore();
    const artifact = await createArtifact();
    const untouched = await createArtifact({ name: 'untouched' });
    await tick();
    const v1 = await createVersion({ artifactId: artifact.id, entryPoint: 'index.html' });
    const v2 = await createVersion({ artifactId: artifact.id, entryPoint: 'report/index.html' });
    expect([v1.version, v2.version]).toEqual([1, 2]);
    const updated = (await store.listArtifacts(LIST_DEFAULTS)).data.find(a => a.id === artifact.id);
    expect(updated?.latest_version).toBe(2);
    expect(updated?.latest_entry_point).toBe('report/index.html');
    expect(updated?.updated_at).toBe(v2.created_at);
    expect(Date.parse(updated?.updated_at ?? '')).toBeGreaterThan(Date.parse(artifact.updated_at));
    expect((await store.listArtifacts(LIST_DEFAULTS)).data.map(a => a.id)).toEqual([artifact.id, untouched.id]);

    expect(await store.getVersion({ tenant_id: TENANT, artifact_id: artifact.id, version: 1 })).toEqual(v1);
    expect(v1).toEqual(
      expect.objectContaining({
        entry_point: 'index.html',
        total_bytes: 100,
      }),
    );
    expect(await store.getVersion({ tenant_id: TENANT, artifact_id: artifact.id, version: 3 })).toBeUndefined();
  });

  it('hides versions from other tenants', async () => {
    const store = getStore();
    const artifact = await createArtifact();
    const v1 = await createVersion({ artifactId: artifact.id, entryPoint: 'index.html' });
    expect(
      await store.createVersion({
        tenant_id: OTHER_TENANT,
        artifact_id: artifact.id,
        entry_point: 'index.html',
        total_bytes: 1,
      }),
    ).toBeUndefined();
    expect(
      await store.getVersion({ tenant_id: OTHER_TENANT, artifact_id: artifact.id, version: v1.version }),
    ).toBeUndefined();
    expect((await store.listArtifacts(LIST_DEFAULTS)).data[0]?.latest_version).toBe(1);
  });
}
