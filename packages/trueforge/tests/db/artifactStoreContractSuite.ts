import type { Subject } from '@truefoundry/trueforge-core/agent-session';
import { ulid } from 'ulid';
import type { IArtifactStore, ListArtifactsInput } from '../../src/db/artifactStore';
import { MAX_TITLE_LENGTH } from '../../src/schemas/common';

const TENANT = 'default';
const OTHER_TENANT = 'other';
const SUBJECT: Subject = { subject_id: 'tester', subject_type: 'user', subject_display_name: 'tester' };
const AGENT_ID = 'agent-1';

const LIST_DEFAULTS: ListArtifactsInput = {
  tenant_id: TENANT,
  created_by_subject_id: SUBJECT.subject_id,
  created_by_session_id: undefined,
  created_by_agent_id: undefined,
  title: undefined,
  limit: 10,
  page_token: undefined,
};

/** Keeps `updated_at` distinct between consecutive writes. */
async function tick(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 5));
}

/** Callers MUST `jest.mock('ulid')` with a pass-through `jest.fn` so ids can be pinned. */
export function runArtifactStoreContractSuite(getStore: () => IArtifactStore): void {
  async function createArtifact({
    tenantId = TENANT,
    title = 'Q3 report',
    sessionId = 'session-1',
    agentId = AGENT_ID,
  }: { tenantId?: string; title?: string; sessionId?: string; agentId?: string | null } = {}) {
    return getStore().createArtifact({
      tenant_id: tenantId,
      title,
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

  async function listTitles(filters: Partial<ListArtifactsInput>): Promise<string[]> {
    const { data } = await getStore().listArtifacts({ ...LIST_DEFAULTS, ...filters });
    return data.map(a => a.title).sort();
  }

  it('creates an artifact with a generated slug', async () => {
    const created = await createArtifact();
    expect(created).toEqual(
      expect.objectContaining({
        tenant_id: TENANT,
        title: 'Q3 report',
        latest_version: 0,
        entry_point: null,
        created_by_subject: SUBJECT,
        created_by_session_id: 'session-1',
        created_by_agent_id: AGENT_ID,
      }),
    );
    expect(created.slug).toBe(`q3-report-${created.id.slice(-6)}`);
    expect((await getStore().listArtifacts(LIST_DEFAULTS)).data).toEqual([created]);
    const inline = await createArtifact({ title: 'inline', agentId: null });
    expect(inline.created_by_agent_id).toBeNull();
  });

  it('cleans the title into a URL-safe slug', async () => {
    const accented = await createArtifact({ title: '  Café --  Sales_Report!! (Q3)  ' });
    expect(accented.title).toBe('Café --  Sales_Report!! (Q3)');
    expect(accented.slug).toBe(`cafe-salesreport-q3-${accented.id.slice(-6)}`);
    const symbols = await createArtifact({ title: 'a/b & c' });
    expect(symbols.slug).toBe(`ab-c-${symbols.id.slice(-6)}`);
    const currency = await createArtifact({ title: 'Cost €5 & 10%' });
    expect(currency.slug).toBe(`cost-5-10-${currency.id.slice(-6)}`);
    const nonLatin = await createArtifact({ title: 'レポート' });
    expect(nonLatin.slug).toBe(nonLatin.id.slice(-6));
  });

  it('caps the title length', async () => {
    const longest = await createArtifact({ title: 'a'.repeat(MAX_TITLE_LENGTH) });
    expect(longest.slug).toHaveLength(MAX_TITLE_LENGTH + 1);
    const expanded = await createArtifact({ title: 'ß'.repeat(MAX_TITLE_LENGTH) });
    expect(expanded.slug).toHaveLength(MAX_TITLE_LENGTH + 1);
    await expect(createArtifact({ title: 'a'.repeat(MAX_TITLE_LENGTH + 1) })).rejects.toBeInstanceOf(RangeError);
    await expect(createArtifact({ title: '   ' })).rejects.toBeInstanceOf(RangeError);
  });

  it('gives artifacts with the same title distinct slugs', async () => {
    const first = await createArtifact();
    const second = await createArtifact();
    expect(second.slug).not.toBe(first.slug);
  });

  // Only exercises the DB unique constraint: ids are pinned to force a shared slug.
  // Generated slugs carry a random id suffix, so real creates don't collide.
  it('rejects a duplicate slug in the tenant but allows it in another tenant', async () => {
    const pinnedIds = ['01JAAAAAAAAAAAAAAAAAQ3SUFX', '01JBBBBBBBBBBBBBBBBBQ3SUFX', '01JCCCCCCCCCCCCCCCCCQ3SUFX'];
    for (const id of pinnedIds) {
      jest.mocked(ulid).mockReturnValueOnce(id);
    }
    const first = await createArtifact();
    await expect(createArtifact()).rejects.toThrow();
    const otherTenant = await createArtifact({ tenantId: OTHER_TENANT });
    expect(otherTenant.slug).toBe(first.slug);
  });

  it("lists the subject's artifacts in the tenant with pagination", async () => {
    const store = getStore();
    const titles = ['a', 'b', 'c'];
    for (const title of titles) {
      await createArtifact({ title });
    }
    await createArtifact({ tenantId: OTHER_TENANT });
    await store.createArtifact({
      tenant_id: TENANT,
      title: 'other',
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
    expect([...first.data, ...second.data].map(a => a.title).sort()).toEqual(titles);
  });

  it('filters the list by session', async () => {
    await createArtifact({ title: 'one', sessionId: 'session-1' });
    await createArtifact({ title: 'two', sessionId: 'session-2' });
    expect(await listTitles({ created_by_session_id: 'session-2' })).toEqual(['two']);
    expect(await listTitles({ created_by_session_id: 'session-3' })).toEqual([]);
  });

  it('filters the list by agent', async () => {
    await createArtifact({ title: 'one', sessionId: 'session-1', agentId: AGENT_ID });
    await createArtifact({ title: 'two', sessionId: 'session-2', agentId: AGENT_ID });
    await createArtifact({ title: 'three', sessionId: 'session-3', agentId: 'agent-2' });
    await createArtifact({ title: 'inline', sessionId: 'session-4', agentId: null });
    expect(await listTitles({ created_by_agent_id: AGENT_ID })).toEqual(['one', 'two']);
    expect(await listTitles({ created_by_agent_id: 'agent-2' })).toEqual(['three']);
    expect(await listTitles({ created_by_agent_id: AGENT_ID, created_by_session_id: 'session-2' })).toEqual(['two']);
    expect(await listTitles({ created_by_agent_id: 'agent-2', created_by_session_id: 'session-1' })).toEqual([]);
    expect(await listTitles({ created_by_agent_id: 'agent-3' })).toEqual([]);
  });

  it('filters the list by case-insensitive title substring', async () => {
    await createArtifact({ title: 'Quarterly Report' });
    await createArtifact({ title: 'Roadmap' });
    expect(await listTitles({ title: 'rep' })).toEqual(['Quarterly Report']);
    expect(await listTitles({ title: 'MAP' })).toEqual(['Roadmap']);
    expect(await listTitles({ title: 'missing' })).toEqual([]);
  });

  it('creates monotonic versions and advances latest_version and updated_at', async () => {
    const store = getStore();
    const artifact = await createArtifact();
    const untouched = await createArtifact({ title: 'untouched' });
    await tick();
    const v1 = await createVersion({ artifactId: artifact.id, entryPoint: 'index.html' });
    const v2 = await createVersion({ artifactId: artifact.id, entryPoint: 'report/index.html' });
    expect([v1.version, v2.version]).toEqual([1, 2]);
    const updated = (await store.listArtifacts(LIST_DEFAULTS)).data.find(a => a.id === artifact.id);
    expect(updated?.latest_version).toBe(2);
    expect(updated?.entry_point).toBe('report/index.html');
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
