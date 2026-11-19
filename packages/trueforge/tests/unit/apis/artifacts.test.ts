import { createArtifactsRouter } from '../../../src/apis/artifacts';
import { createdBySubjectFromRequestContext, STANDALONE_REQUEST_CONTEXT } from '../../../src/auth/identity';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { SqliteArtifactStore } from '../../../src/db/sqlite/artifact-store/SqliteArtifactStore';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { GetArtifactResponseSchema, ListArtifactsResponseSchema } from '../../../src/schemas/artifact';
import { mountWithErrorHandler } from '../mountWithErrorHandler';

describe('artifacts router', () => {
  let app: ReturnType<typeof mountWithErrorHandler>;

  beforeAll(async () => {
    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    const artifactStore = new SqliteArtifactStore(db);
    for (const slug of ['a', 'b']) {
      await artifactStore.createArtifact({
        tenant_id: STANDALONE_REQUEST_CONTEXT.tenant_id,
        slug,
        title: slug,
        created_by_subject: createdBySubjectFromRequestContext(STANDALONE_REQUEST_CONTEXT),
        created_by_session_id: 'session-1',
      });
    }
    app = mountWithErrorHandler(
      createArtifactsRouter({ artifactStore, resolveRequestContext: () => STANDALONE_REQUEST_CONTEXT }),
    );
  });

  it('lists artifacts with pagination', async () => {
    const first = ListArtifactsResponseSchema.parse(await (await app.request('/?limit=1')).json());
    expect(first.data).toHaveLength(1);
    const second = ListArtifactsResponseSchema.parse(
      await (await app.request(`/?limit=1&page_token=${first.pagination.next_page_token ?? ''}`)).json(),
    );
    expect([...first.data, ...second.data].map(a => a.slug).sort()).toEqual(['a', 'b']);
  });

  it('rejects an invalid page token', async () => {
    expect((await app.request('/?page_token=not-a-token')).status).toBe(400);
  });

  it('gets an artifact by slug', async () => {
    const response = await app.request('/a');
    expect(response.status).toBe(200);
    expect(GetArtifactResponseSchema.parse(await response.json()).data.slug).toBe('a');
  });

  it('returns 404 for an unknown slug', async () => {
    expect((await app.request('/missing')).status).toBe(404);
  });
});
