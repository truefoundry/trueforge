import { createCatalogRouter } from '../../../src/apis/catalog';
import { createAvailableSkillsRouter, createSkillsRouter } from '../../../src/apis/skills';
import { McpCatalog } from '../../../src/catalog/McpCatalog';
import { ModelCatalog } from '../../../src/catalog/ModelCatalog';
import { SandboxCatalog } from '../../../src/catalog/SandboxCatalog';
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

function wrapManifest(manifest: unknown) {
  return { manifest };
}

function configured(manifest: { name: string }) {
  return { name: manifest.name, manifest };
}

function putInit(body: unknown): RequestInit {
  return {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function postInit(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

describe('skills routers', () => {
  let settingsRouter: ReturnType<typeof createSkillsRouter>;
  let catalogRouter: ReturnType<typeof createCatalogRouter>;
  let availableRouter: ReturnType<typeof createAvailableSkillsRouter>;

  beforeAll(async () => {
    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    const skillStore = new SqliteSkillStore(db);
    settingsRouter = createSkillsRouter({
      skillStore,
      withTransaction: callback => db.transaction().execute(callback),
    });
    catalogRouter = createCatalogRouter({
      modelCatalog: ModelCatalog.load(),
      mcpCatalog: McpCatalog.load(),
      skillCatalog: SkillCatalog.load(),
      sandboxCatalog: SandboxCatalog.load(),
    });
    availableRouter = createAvailableSkillsRouter({
      skillStore,
      withTransaction: callback => db.transaction().execute(callback),
    });
  });

  it('GET /catalogs/skills returns the shipped catalog verbatim', async () => {
    const response = await catalogRouter.request('/skills');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { name: string }[] };
    expect(body.data.map(skill => skill.name)).toEqual(
      SkillCatalog.load()
        .list()
        .map(skill => skill.name),
    );
  });

  it('PUT upserts a skill and echoes the stored manifest', async () => {
    const response = await settingsRouter.request('/', putInit(wrapManifest(putBody)));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: configured(putBody) });

    const list = await settingsRouter.request('/');
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ data: [configured(putBody)] });
  });

  it('POST creates a skill and returns 409 on name clash', async () => {
    const createBody = {
      ...putBody,
      name: 'create-only-skill',
      path: 'skills/create-only-skill',
    };
    const created = await settingsRouter.request('/', postInit(wrapManifest(createBody)));
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ data: configured(createBody) });

    const clash = await settingsRouter.request('/', postInit(wrapManifest(createBody)));
    expect(clash.status).toBe(409);
    expect(await clash.json()).toEqual({
      error: { message: 'Skill name already exists: create-only-skill' },
    });
  });

  it('GET / on the chat router returns the slim name/description projection', async () => {
    const response = await availableRouter.request('/');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [
        { name: putBody.name, description: putBody.description },
        { name: 'create-only-skill', description: putBody.description },
      ],
    });
  });

  it('PUT rejects invalid bodies at the Zod layer', async () => {
    const { url: _, ...withoutUrl } = putBody;
    const missingUrl = await settingsRouter.request('/', putInit(wrapManifest(withoutUrl)));
    expect(missingUrl.status).toBe(400);

    const badName = await settingsRouter.request('/', putInit(wrapManifest({ ...putBody, name: 'Not A Name' })));
    expect(badName.status).toBe(400);

    const badUrl = await settingsRouter.request(
      '/',
      putInit(wrapManifest({ ...putBody, name: 'bad-url', url: 'https://example.com/repo' })),
    );
    expect(badUrl.status).toBe(400);
  });
});
