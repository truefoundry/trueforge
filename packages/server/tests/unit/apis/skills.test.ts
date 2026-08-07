import { createAvailableSkillsRouter, createSkillsRouter } from '../../../src/apis/skills';
import { SkillCatalog } from '../../../src/catalog/SkillCatalog';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteSkillStore } from '../../../src/db/sqlite/skill-store/SqliteSkillStore';

const putBody = {
  type: 'git' as const,
  name: 'algorithmic-art',
  url: 'https://github.com/anthropics/skills',
  path: 'skills/algorithmic-art',
  ref: 'main',
  description: 'Creating algorithmic art using p5.js with seeded randomness.',
};

function putInit(body: unknown): RequestInit {
  return {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

describe('skills routers', () => {
  let settingsRouter: ReturnType<typeof createSkillsRouter>;
  let availableRouter: ReturnType<typeof createAvailableSkillsRouter>;

  beforeAll(async () => {
    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    const skillStore = new SqliteSkillStore(db);
    settingsRouter = createSkillsRouter({
      skillCatalog: SkillCatalog.load(),
      skillStore,
      withTransaction: callback => db.transaction().execute(callback),
    });
    availableRouter = createAvailableSkillsRouter({
      skillStore,
      withTransaction: callback => db.transaction().execute(callback),
    });
  });

  it('GET /catalog returns the shipped catalog verbatim', async () => {
    const response = await settingsRouter.request('/catalog');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { name: string }[] };
    expect(body.data.map(skill => skill.name)).toEqual(
      SkillCatalog.load()
        .list()
        .map(skill => skill.name),
    );
  });

  it('PUT upserts a skill and echoes the stored manifest', async () => {
    const response = await settingsRouter.request('/', putInit(putBody));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: putBody });

    const list = await settingsRouter.request('/');
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ data: [putBody] });
  });

  it('GET / on the chat router returns the slim name/description projection', async () => {
    const response = await availableRouter.request('/');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [{ name: putBody.name, description: putBody.description }],
    });
  });

  it('PUT rejects invalid bodies at the Zod layer', async () => {
    const { url: _, ...withoutUrl } = putBody;
    const missingUrl = await settingsRouter.request('/', putInit(withoutUrl));
    expect(missingUrl.status).toBe(400);

    const badName = await settingsRouter.request('/', putInit({ ...putBody, name: 'Not A Name' }));
    expect(badName.status).toBe(400);

    const badUrl = await settingsRouter.request(
      '/',
      putInit({ ...putBody, name: 'bad-url', url: 'https://example.com/repo' }),
    );
    expect(badUrl.status).toBe(400);
  });
});
