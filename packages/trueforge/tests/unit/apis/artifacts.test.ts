import { createArtifactsRouter } from '../../../src/apis/artifacts';
import { createdBySubjectFromRequestContext, STANDALONE_REQUEST_CONTEXT } from '../../../src/auth/identity';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { SqliteArtifactStore } from '../../../src/db/sqlite/artifact-store/SqliteArtifactStore';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { ListArtifactsResponseSchema } from '../../../src/schemas/artifact';
import { mountWithErrorHandler } from '../mountWithErrorHandler';

describe('artifacts router', () => {
  let app: ReturnType<typeof mountWithErrorHandler>;

  async function listTitles(query: string): Promise<string[]> {
    const response = await app.request(`/?${query}`);
    expect(response.status).toBe(200);
    return ListArtifactsResponseSchema.parse(await response.json())
      .data.map(a => a.title)
      .sort();
  }

  beforeAll(async () => {
    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    const artifactStore = new SqliteArtifactStore(db);
    const mine = {
      tenant_id: STANDALONE_REQUEST_CONTEXT.tenant_id,
      created_by_subject: createdBySubjectFromRequestContext(STANDALONE_REQUEST_CONTEXT),
    };
    const report = await artifactStore.createArtifact({
      ...mine,
      title: 'Q3 Report',
      created_by_session_id: 'session-1',
      created_by_agent_id: 'agent-1',
    });
    await artifactStore.createVersion({
      tenant_id: report.tenant_id,
      artifact_id: report.id,
      entry_point: 'report/index.html',
      total_bytes: 1,
    });
    await artifactStore.createArtifact({
      ...mine,
      title: 'Roadmap',
      created_by_session_id: 'session-2',
      created_by_agent_id: null,
    });
    await artifactStore.createArtifact({
      ...mine,
      title: 'not mine',
      created_by_subject: { ...mine.created_by_subject, subject_id: 'someone-else' },
      created_by_session_id: 'session-1',
      created_by_agent_id: 'agent-1',
    });
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
    expect([...first.data, ...second.data].map(a => [a.title, a.entry_point, a.created_by_agent_id]).sort()).toEqual([
      ['Q3 Report', 'report/index.html', 'agent-1'],
      ['Roadmap', null, null],
    ]);
  });

  it('filters by created_by_session_id', async () => {
    expect(await listTitles('created_by_session_id=session-2')).toEqual(['Roadmap']);
  });

  it('filters by title substring', async () => {
    expect(await listTitles('title=report')).toEqual(['Q3 Report']);
  });

  it('rejects an invalid page token', async () => {
    expect((await app.request('/?page_token=not-a-token')).status).toBe(400);
  });
});
