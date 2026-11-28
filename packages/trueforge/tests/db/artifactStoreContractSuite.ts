import type { Subject } from '@truefoundry/trueforge-core/agent-session';
import type { IArtifactStore, ListArtifactsInput } from '../../src/db/artifactStore';
import { newId } from '../../src/utils/id';

const TENANT = 'default';
const OTHER_TENANT = 'other';
const SUBJECT: Subject = { subject_id: 'tester', subject_type: 'user', subject_display_name: 'tester' };
const COLLABORATOR: Subject = {
  subject_id: 'collaborator',
  subject_type: 'user',
  subject_display_name: 'collaborator',
};
const AGENT_ID = 'agent-1';

const LIST_DEFAULTS: ListArtifactsInput = {
  tenant_id: TENANT,
  created_by_subject_id: SUBJECT.subject_id,
  name: undefined,
  limit: 10,
  page_token: undefined,
};

/** Keeps `updated_at` distinct between consecutive writes. */
async function tick(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 5));
}

export function runArtifactStoreContractSuite(getStore: () => IArtifactStore): void {
  async function createArtifactWithVersion({
    tenantId = TENANT,
    name = 'Q3 report',
    subject = SUBJECT,
    sessionId = 'session-1',
    agentId = AGENT_ID,
  }: { tenantId?: string; name?: string; subject?: Subject; sessionId?: string; agentId?: string | null } = {}) {
    return getStore().createArtifactWithVersion({
      id: newId(),
      tenant_id: tenantId,
      name,
      files_metadata: { entry_point: 'index.html', total_bytes: 100, root_path: 'uploads/index.html' },
      created_by_subject: subject,
      created_by_session_id: sessionId,
      created_by_agent_id: agentId,
    });
  }

  async function createArtifact(options: Parameters<typeof createArtifactWithVersion>[0] = {}) {
    return (await createArtifactWithVersion(options)).artifact;
  }

  async function createVersion({
    artifactId,
    entryPoint,
    subject = SUBJECT,
    sessionId = 'session-1',
    agentId = AGENT_ID,
  }: {
    artifactId: string;
    entryPoint: string;
    subject?: Subject;
    sessionId?: string;
    agentId?: string | null;
  }) {
    const version = await getStore().createVersion({
      tenant_id: TENANT,
      artifact_id: artifactId,
      files_metadata: { entry_point: entryPoint, total_bytes: 100, root_path: `uploads/${entryPoint}` },
      created_by_subject: subject,
      created_by_session_id: sessionId,
      created_by_agent_id: agentId,
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

  it('creates an artifact with its first version', async () => {
    const { artifact: created, version } = await createArtifactWithVersion({ name: 'Q3 report' });
    const createdBy = {
      created_by_subject: SUBJECT,
      created_by_session_id: 'session-1',
      created_by_agent_id: AGENT_ID,
    };
    expect(created).toEqual(
      expect.objectContaining({
        tenant_id: TENANT,
        name: 'Q3 report',
        latest_version: 1,
        latest_entry_point: 'index.html',
        updated_at: version.created_at,
        ...createdBy,
      }),
    );
    expect(version).toEqual({
      artifact_id: created.id,
      version: 1,
      files_metadata: { entry_point: 'index.html', total_bytes: 100, root_path: 'uploads/index.html' },
      created_at: created.created_at,
      ...createdBy,
    });
    expect((await getStore().listArtifacts(LIST_DEFAULTS)).data).toEqual([created]);
    expect(await getStore().listSessionArtifacts({ tenant_id: TENANT, session_id: 'session-1' })).toEqual([created]);
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
    await createArtifact({
      name: 'other',
      subject: { ...SUBJECT, subject_id: 'someone-else' },
      sessionId: 'session-2',
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
    expect(await store.getArtifact({ tenant_id: TENANT, id: artifact.id })).toEqual(artifact);
    expect(await store.getArtifact({ tenant_id: OTHER_TENANT, id: artifact.id })).toBeUndefined();
    expect(await store.getArtifact({ tenant_id: TENANT, id: 'missing' })).toBeUndefined();
  });

  it('renames an artifact within the tenant', async () => {
    const store = getStore();
    const artifact = await createArtifact();
    await tick();
    const renamed = await store.updateArtifact({
      tenant_id: TENANT,
      id: artifact.id,
      created_by_subject_id: SUBJECT.subject_id,
      name: 'Renamed',
    });
    expect(renamed).toEqual({ ...artifact, name: 'Renamed', updated_at: renamed?.updated_at });
    expect(Date.parse(renamed?.updated_at ?? '')).toBeGreaterThan(Date.parse(artifact.updated_at));
    expect((await store.listArtifacts(LIST_DEFAULTS)).data).toEqual([renamed]);
  });

  it('does not rename an artifact from another tenant', async () => {
    const store = getStore();
    const artifact = await createArtifact();
    await tick();
    expect(
      await store.updateArtifact({
        tenant_id: OTHER_TENANT,
        id: artifact.id,
        created_by_subject_id: SUBJECT.subject_id,
        name: 'x',
      }),
    ).toBeUndefined();
    expect((await store.listArtifacts(LIST_DEFAULTS)).data).toEqual([artifact]);
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
    expect((await store.listArtifacts(LIST_DEFAULTS)).data).toEqual([artifact]);
  });

  it('creates monotonic versions and advances latest_version, latest_entry_point and updated_at', async () => {
    const store = getStore();
    const artifact = await createArtifact();
    const untouched = await createArtifact({ name: 'untouched' });
    await tick();
    const v2 = await createVersion({ artifactId: artifact.id, entryPoint: 'index.html' });
    const v3 = await createVersion({
      artifactId: artifact.id,
      entryPoint: 'report/index.html',
      subject: COLLABORATOR,
      sessionId: 'session-2',
      agentId: null,
    });
    expect([v2.version, v3.version]).toEqual([2, 3]);
    const updated = (await store.listArtifacts(LIST_DEFAULTS)).data.find(a => a.id === artifact.id);
    expect(updated?.latest_version).toBe(3);
    expect(updated?.latest_entry_point).toBe('report/index.html');
    expect(updated?.updated_at).toBe(v3.created_at);
    expect(Date.parse(updated?.updated_at ?? '')).toBeGreaterThan(Date.parse(artifact.updated_at));
    expect((await store.listArtifacts(LIST_DEFAULTS)).data.map(a => a.id)).toEqual([artifact.id, untouched.id]);

    expect(v2).toEqual(
      expect.objectContaining({
        files_metadata: {
          entry_point: 'index.html',
          total_bytes: 100,
          root_path: 'uploads/index.html',
        },
        created_by_subject: SUBJECT,
        created_by_session_id: 'session-1',
        created_by_agent_id: AGENT_ID,
      }),
    );
    expect(v3).toEqual(
      expect.objectContaining({
        created_by_subject: COLLABORATOR,
        created_by_session_id: 'session-2',
        created_by_agent_id: null,
      }),
    );
  });

  it('lists artifacts with a version created in the session', async () => {
    const store = getStore();
    const own = await createArtifact({ name: 'own' });
    const shared = await createArtifact({ name: 'Shared Report', sessionId: 'session-2' });
    await createArtifact({ name: 'elsewhere', sessionId: 'session-2' });
    await createArtifact({ name: 'other tenant', tenantId: OTHER_TENANT });
    await tick();
    await createVersion({ artifactId: shared.id, entryPoint: 'a.html' });
    await createVersion({ artifactId: shared.id, entryPoint: 'b.html' });

    const input = { tenant_id: TENANT, session_id: 'session-1' };
    expect((await store.listSessionArtifacts(input)).map(a => a.id)).toEqual([shared.id, own.id]);
    expect(await store.listSessionArtifacts({ ...input, session_id: 'session-3' })).toEqual([]);
  });

  it('rejects versions for artifacts in other tenants', async () => {
    const store = getStore();
    const artifact = await createArtifact();
    expect(
      await store.createVersion({
        tenant_id: OTHER_TENANT,
        artifact_id: artifact.id,
        files_metadata: { entry_point: 'index.html', total_bytes: 1, root_path: 'uploads/other' },
        created_by_subject: SUBJECT,
        created_by_session_id: 'session-1',
        created_by_agent_id: AGENT_ID,
      }),
    ).toBeUndefined();
    expect((await store.listArtifacts(LIST_DEFAULTS)).data[0]?.latest_version).toBe(1);
  });
}
