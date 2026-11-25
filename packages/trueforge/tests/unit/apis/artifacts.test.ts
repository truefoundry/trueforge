import { createArtifactsRouter } from '../../../src/apis/artifacts';
import {
  createdBySubjectFromRequestContext,
  STANDALONE_REQUEST_CONTEXT,
  type RequestContext,
} from '../../../src/auth/identity';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { SqliteArtifactStore } from '../../../src/db/sqlite/artifact-store/SqliteArtifactStore';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { GetArtifactResponseSchema, ListArtifactsResponseSchema } from '../../../src/schemas/artifact';
import { mountWithErrorHandler } from '../mountWithErrorHandler';

describe('artifacts router', () => {
  let app: ReturnType<typeof mountWithErrorHandler>;
  let artifactStore: SqliteArtifactStore;
  let reportId: string;
  let notMineId: string;

  async function listTitles(query: string): Promise<string[]> {
    const response = await app.request(`/?${query}`);
    expect(response.status).toBe(200);
    return ListArtifactsResponseSchema.parse(await response.json())
      .data.map(a => a.name)
      .sort();
  }

  beforeAll(async () => {
    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    artifactStore = new SqliteArtifactStore(db);
    const mine = {
      tenant_id: STANDALONE_REQUEST_CONTEXT.tenant_id,
      created_by_subject: createdBySubjectFromRequestContext(STANDALONE_REQUEST_CONTEXT),
    };
    const report = await artifactStore.createArtifact({
      ...mine,
      name: 'Q3 Report',
      created_by_session_id: 'session-1',
      created_by_agent_id: 'agent-1',
    });
    reportId = report.id;
    await artifactStore.createVersion({
      tenant_id: report.tenant_id,
      artifact_id: report.id,
      entry_point: 'report/index.html',
      total_bytes: 1,
    });
    await artifactStore.createArtifact({
      ...mine,
      name: 'Roadmap',
      created_by_session_id: 'session-2',
      created_by_agent_id: null,
    });
    const notMine = await artifactStore.createArtifact({
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
    expect([...first.data, ...second.data].map(a => [a.name, a.entry_point, a.created_by_agent_id]).sort()).toEqual([
      ['Q3 Report', 'report/index.html', 'agent-1'],
      ['Roadmap', null, null],
    ]);
    expect([...first.data, ...second.data].find(a => a.name === 'Q3 Report')?.id).toBe(reportId);
  });

  it('filters by created_by_session_id', async () => {
    expect(await listTitles('created_by_session_id=session-2')).toEqual(['Roadmap']);
  });

  it('filters by name substring', async () => {
    expect(await listTitles('name=report')).toEqual(['Q3 Report']);
  });

  it('rejects an invalid page token', async () => {
    expect((await app.request('/?page_token=not-a-token')).status).toBe(400);
  });

  it("gets the caller's artifact by id", async () => {
    const response = await app.request(`/${reportId}`);
    expect(response.status).toBe(200);
    expect(GetArtifactResponseSchema.parse(await response.json()).data).toEqual(
      expect.objectContaining({ id: reportId, name: 'Q3 Report', entry_point: 'report/index.html' }),
    );
    expect((await app.request(`/${notMineId}`)).status).toBe(404);
    expect((await app.request('/missing')).status).toBe(404);
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

    it('returns 404 for get by a user who is not the creator', async () => {
      expect((await appAs(otherUser).request(`/${reportId}`)).status).toBe(404);
    });

    it('lets the creator get the artifact', async () => {
      expect((await appAs(STANDALONE_REQUEST_CONTEXT).request(`/${reportId}`)).status).toBe(200);
    });

    it('returns 404 for get when the tenant does not match', async () => {
      expect((await appAs(otherTenant).request(`/${reportId}`)).status).toBe(404);
    });
  });
});
