import { createCatalogRouter } from '../../../src/apis/catalog';
import { createAvailableSkillsRouter, createSkillsRouter } from '../../../src/apis/skills';
import { STANDALONE_REQUEST_CONTEXT } from '../../../src/auth/identity';
import { McpCatalog } from '../../../src/catalog/McpCatalog';
import { ModelCatalog } from '../../../src/catalog/ModelCatalog';
import { SandboxCatalog } from '../../../src/catalog/SandboxCatalog';
import { SkillCatalog } from '../../../src/catalog/SkillCatalog';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteSkillStore } from '../../../src/db/sqlite/skill-store/SqliteSkillStore';
import { TRUEFOUNDRY_MANAGED_MESSAGE, trueFoundryManaged } from '../../../src/truefoundry/errors';

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
      resolveSkillStore: () => skillStore,
      withTransaction: callback => db.transaction().execute(callback),
      resolveRequestContext: () => STANDALONE_REQUEST_CONTEXT,
    });
    catalogRouter = createCatalogRouter({
      modelCatalog: ModelCatalog.load(),
      mcpCatalog: McpCatalog.load(),
      skillCatalog: SkillCatalog.load(),
      sandboxCatalog: SandboxCatalog.load(),
    });
    availableRouter = createAvailableSkillsRouter({
      resolveSkillStore: () => skillStore,
      withTransaction: callback => db.transaction().execute(callback),
      resolveRequestContext: () => STANDALONE_REQUEST_CONTEXT,
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

  it('GET / on the chat router returns name and description for git skills', async () => {
    const response = await availableRouter.request('/');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [
        { name: putBody.name, description: putBody.description },
        { name: 'create-only-skill', description: putBody.description },
      ],
    });
  });

  it('GET / maps registry rows with TrueFoundry metadata', async () => {
    const fqn = 'agent-skill:acme/team-a/echo:3';
    const now = '2026-01-01T00:00:00.000Z';
    const skillStore = {
      listSkills: jest.fn().mockResolvedValue([
        {
          tenant_id: 'default',
          name: fqn,
          manifest: {
            type: 'truefoundry' as const,
            name: fqn,
            display_name: 'echo',
            description: 'Echo skill',
            repository_name: 'team-a',
            version: 3,
          },
          created_at: now,
          updated_at: now,
        },
      ]),
      createSkill: jest.fn(),
      upsertSkill: jest.fn(),
      listSkillVersions: jest.fn(),
      validateAgentSkills: jest.fn(),
      resolveTurnSkills: jest.fn(),
    };
    const router = createAvailableSkillsRouter({
      resolveSkillStore: () => skillStore,
      withTransaction: async callback => callback(undefined as never),
      resolveRequestContext: () => STANDALONE_REQUEST_CONTEXT,
    });
    const response = await router.request('/');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [
        {
          name: fqn,
          description: 'Echo skill',
          metadata: {
            display_name: 'echo',
            repository_name: 'team-a',
            version: '3',
          },
        },
      ],
    });
  });

  it('settings create/put forward registry bodies to the store (no early git-only 400)', async () => {
    const registryManifest = {
      type: 'truefoundry' as const,
      name: 'agent-skill:acme/team-a/echo:3',
      display_name: 'echo',
      description: 'Echo skill',
      repository_name: 'team-a',
      version: 3,
    };
    const now = '2026-01-01T00:00:00.000Z';
    const record = {
      tenant_id: 'default',
      name: 'agent-skill:acme/team-a/echo:3' as const,
      manifest: registryManifest,
      created_at: now,
      updated_at: now,
    };
    const managedStore = {
      listSkills: jest.fn(),
      createSkill: jest.fn().mockResolvedValue(record),
      upsertSkill: jest.fn().mockResolvedValue(record),
      listSkillVersions: jest.fn(),
      validateAgentSkills: jest.fn(),
      resolveTurnSkills: jest.fn(),
    };
    const router = createSkillsRouter({
      resolveSkillStore: () => managedStore,
      withTransaction: async callback => callback(undefined as never),
      resolveRequestContext: () => STANDALONE_REQUEST_CONTEXT,
    });
    const created = await router.request('/', postInit(wrapManifest(registryManifest)));
    expect(created.status).toBe(201);
    expect(managedStore.createSkill).toHaveBeenCalledWith({
      tenant_id: 'default',
      name: 'agent-skill:acme/team-a/echo:3',
      manifest: registryManifest,
    });

    const put = await router.request('/', putInit(wrapManifest(registryManifest)));
    expect(put.status).toBe(200);
    expect(managedStore.upsertSkill).toHaveBeenCalledWith({
      tenant_id: 'default',
      name: 'agent-skill:acme/team-a/echo:3',
      manifest: registryManifest,
    });
  });

  it('settings create/put return 424 when the skill store is TrueFoundry-managed', async () => {
    const registryManifest = {
      type: 'truefoundry' as const,
      name: 'agent-skill:acme/team-a/echo:3',
      display_name: 'echo',
      description: 'Echo skill',
      repository_name: 'team-a',
      version: 3,
    };
    const managedStore = {
      listSkills: jest.fn(),
      createSkill: jest.fn(() => trueFoundryManaged()),
      upsertSkill: jest.fn(() => trueFoundryManaged()),
      listSkillVersions: jest.fn(),
      validateAgentSkills: jest.fn(),
      resolveTurnSkills: jest.fn(),
    };
    const router = createSkillsRouter({
      resolveSkillStore: () => managedStore,
      withTransaction: async callback => callback(undefined as never),
      resolveRequestContext: () => STANDALONE_REQUEST_CONTEXT,
    });

    const created = await router.request('/', postInit(wrapManifest(registryManifest)));
    expect(created.status).toBe(424);
    expect(await created.text()).toBe(TRUEFOUNDRY_MANAGED_MESSAGE);

    const put = await router.request('/', putInit(wrapManifest(registryManifest)));
    expect(put.status).toBe(424);
    expect(await put.text()).toBe(TRUEFOUNDRY_MANAGED_MESSAGE);
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
