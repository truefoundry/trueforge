import { createArtifactsRouter } from '../../../src/apis/artifacts';
import {
  createdBySubjectFromRequestContext,
  STANDALONE_REQUEST_CONTEXT,
  type RequestContext,
} from '../../../src/auth/identity';
import type { CreateArtifactWithVersionInput } from '../../../src/db/artifactStore';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { SqliteArtifactStore } from '../../../src/db/sqlite/artifact-store/SqliteArtifactStore';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { ListArtifactsResponseSchema, UpdateArtifactResponseSchema } from '../../../src/schemas/artifact';
import { MAX_TITLE_LENGTH } from '../../../src/schemas/common';
import { newId } from '../../../src/utils/id';
import { mountWithErrorHandler } from '../mountWithErrorHandler';

describe('artifacts router', () => {
  let app: ReturnType<typeof mountWithErrorHandler>;
  let artifactStore: SqliteArtifactStore;
  let reportId: string;
  let notMineId: string;

  async function createArtifact(input: Omit<CreateArtifactWithVersionInput, 'id' | 'files_metadata'>) {
    const files_metadata = { entry_point: 'index.html', total_bytes: 1, root_path: 'uploads/index.html' };
    return (await artifactStore.createArtifactWithVersion({ ...input, id: newId(), files_metadata })).artifact;
  }

  async function listTitles(query: string): Promise<string[]> {
    const response = await app.request(`/?${query}`);
    expect(response.status).toBe(200);
    return ListArtifactsResponseSchema.parse(await response.json())
      .data.map(a => a.name)
      .sort();
  }

  function update({
    target = app,
    id,
    body,
  }: {
    target?: ReturnType<typeof mountWithErrorHandler>;
    id: string;
    body: unknown;
  }) {
    return target.request(`/${id}/update`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  beforeAll(async () => {
    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    artifactStore = new SqliteArtifactStore(db);
    const mine = {
      tenant_id: STANDALONE_REQUEST_CONTEXT.tenant_id,
      created_by_subject: createdBySubjectFromRequestContext(STANDALONE_REQUEST_CONTEXT),
    };
    const report = await createArtifact({
      ...mine,
      name: 'Q3 Report',
      created_by_session_id: 'session-1',
      created_by_agent_id: 'agent-1',
    });
    reportId = report.id;
    await createArtifact({
      ...mine,
      name: 'Roadmap',
      created_by_session_id: 'session-2',
      created_by_agent_id: null,
    });
    const notMine = await createArtifact({
      ...mine,
      name: 'not mine',
      created_by_subject: { ...mine.created_by_subject, subject_id: 'someone-else' },
      created_by_session_id: 'session-1',
      created_by_agent_id: 'agent-1',
    });
    notMineId = notMine.id;
    app = mountWithErrorHandler(
      createArtifactsRouter({ artifactStore, resolveRequestContext: () => STANDALONE_REQUEST_CONTEXT }),
    );
  });

  it("lists only the caller's artifacts with pagination", async () => {
    const first = ListArtifactsResponseSchema.parse(await (await app.request('/?limit=1')).json());
    expect(first.data).toHaveLength(1);
    const second = ListArtifactsResponseSchema.parse(
      await (await app.request(`/?limit=1&page_token=${first.pagination.next_page_token ?? ''}`)).json(),
    );
    expect([...first.data, ...second.data].map(a => a.name).sort()).toEqual(['Q3 Report', 'Roadmap']);
    expect([...first.data, ...second.data].find(a => a.name === 'Q3 Report')?.id).toBe(reportId);
  });

  it('filters by name substring', async () => {
    expect(await listTitles('name=report')).toEqual(['Q3 Report']);
  });

  it('rejects an invalid page token', async () => {
    expect((await app.request('/?page_token=not-a-token')).status).toBe(400);
  });

  it("renames the caller's artifact", async () => {
    const artifact = await createArtifact({
      tenant_id: STANDALONE_REQUEST_CONTEXT.tenant_id,
      name: 'Draft',
      created_by_subject: createdBySubjectFromRequestContext(STANDALONE_REQUEST_CONTEXT),
      created_by_session_id: 'session-3',
      created_by_agent_id: null,
    });

    const response = await update({ id: artifact.id, body: { name: '  Final  ' } });
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toEqual({
      data: {
        id: artifact.id,
        name: 'Final',
        created_by_subject: artifact.created_by_subject,
        created_at: artifact.created_at,
        updated_at: expect.any(String),
      },
    });
    expect(UpdateArtifactResponseSchema.safeParse(body).success).toBe(true);
    expect((await update({ id: artifact.id, body: { name: '   ' } })).status).toBe(400);
    expect((await update({ id: artifact.id, body: { name: 'a|b' } })).status).toBe(400);
    expect((await update({ id: artifact.id, body: { name: ` ${'a'.repeat(MAX_TITLE_LENGTH)}` } })).status).toBe(400);
    const normalized = await update({ id: artifact.id, body: { name: '  a\u2029\u2029b  ' } });
    expect(normalized.status).toBe(200);
    expect(UpdateArtifactResponseSchema.parse(await normalized.json()).data.name).toBe('a b');
    expect((await update({ id: notMineId, body: { name: 'Taken' } })).status).toBe(403);
    expect((await update({ id: 'missing', body: { name: 'Gone' } })).status).toBe(404);
  });

  describe('access control', () => {
    function appAs(context: RequestContext) {
      return mountWithErrorHandler(createArtifactsRouter({ artifactStore, resolveRequestContext: () => context }));
    }
    // Standalone context carries an admin role, so this also checks that admins get no special access.
    const otherUser: RequestContext = {
      ...STANDALONE_REQUEST_CONTEXT,
      subject: { ...STANDALONE_REQUEST_CONTEXT.subject, id: 'someone-else' },
    };
    const otherTenant: RequestContext = { ...STANDALONE_REQUEST_CONTEXT, tenant_id: 'other-tenant' };

    it('returns 403 for update by a user who is not the creator, leaving the name unchanged', async () => {
      expect((await update({ target: appAs(otherUser), id: reportId, body: { name: 'Hijacked' } })).status).toBe(403);
      expect(await listTitles('name=report')).toEqual(['Q3 Report']);
    });

    it('returns 404 for update when the tenant does not match, leaving the name unchanged', async () => {
      expect((await update({ target: appAs(otherTenant), id: reportId, body: { name: 'Moved' } })).status).toBe(404);
      expect(await listTitles('name=report')).toEqual(['Q3 Report']);
    });
  });
});
