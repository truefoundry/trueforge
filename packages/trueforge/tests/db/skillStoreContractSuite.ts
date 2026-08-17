/**
 * Backend-agnostic behavioural contract for ISkillStore.
 * Runs under jest against a fresh store per test (see backend test files).
 */
import { SkillNameConflictError, type ISkillStore } from '../../src/db/skillStore';
import type { SkillManifest } from '../../src/schemas/skill';

const TENANT = 'default';

function manifest(overrides: Partial<SkillManifest> = {}): SkillManifest {
  return {
    type: 'git',
    name: 'algorithmic-art',
    url: 'https://github.com/anthropics/skills',
    path: 'skills/algorithmic-art',
    ref: 'main',
    description: 'Creating algorithmic art using p5.js with seeded randomness.',
    ...overrides,
  };
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function runSkillStoreContractSuite(getStore: () => ISkillStore): void {
  it('upsert creates a skill and round-trips the manifest', async () => {
    const store = getStore();
    const created = await store.upsertSkill({
      tenant_id: TENANT,
      name: 'algorithmic-art',
      manifest: manifest(),
    });

    expect(created.tenant_id).toBe(TENANT);
    expect(created.name).toBe('algorithmic-art');
    expect(created.manifest).toEqual(manifest());
    expect(created.created_at).toMatch(ISO_UTC);
    expect(created.updated_at).toBe(created.created_at);

    const fetched = await store.getSkill({ tenant_id: TENANT, name: 'algorithmic-art' });
    expect(fetched).toEqual(created);
  });

  it('createSkill inserts and throws SkillNameConflictError on name clash', async () => {
    const store = getStore();
    const created = await store.createSkill({
      tenant_id: TENANT,
      name: 'algorithmic-art',
      manifest: manifest(),
    });
    expect(created.name).toBe('algorithmic-art');

    await expect(
      store.createSkill({ tenant_id: TENANT, name: 'algorithmic-art', manifest: manifest() }),
    ).rejects.toBeInstanceOf(SkillNameConflictError);
  });

  it('getSkill returns undefined for unknown skills', async () => {
    const store = getStore();
    expect(await store.getSkill({ tenant_id: TENANT, name: 'missing' })).toBeUndefined();
  });

  it('upsert replaces the whole manifest and preserves created_at', async () => {
    const store = getStore();
    const created = await store.upsertSkill({
      tenant_id: TENANT,
      name: 'algorithmic-art',
      manifest: manifest(),
    });

    const replacement = manifest({
      description: 'Updated description for algorithmic art.',
      ref: 'v2',
    });
    const updated = await store.upsertSkill({
      tenant_id: TENANT,
      name: 'algorithmic-art',
      manifest: replacement,
    });

    expect(updated.manifest).toEqual(replacement);
    expect(updated.created_at).toBe(created.created_at);
    expect(Date.parse(updated.updated_at)).toBeGreaterThanOrEqual(Date.parse(created.updated_at));

    const skills = await store.listSkills({ tenant_id: TENANT, names: undefined });
    expect(skills).toEqual([updated]);
  });

  it('listSkills returns only the tenant, ordered by name', async () => {
    const store = getStore();
    await store.upsertSkill({
      tenant_id: TENANT,
      name: 'web-artifacts',
      manifest: manifest({
        name: 'web-artifacts',
        path: 'skills/web-artifacts-builder',
        description: 'Build web artifacts.',
      }),
    });
    await store.upsertSkill({ tenant_id: TENANT, name: 'algorithmic-art', manifest: manifest() });
    await store.upsertSkill({
      tenant_id: 'other-tenant',
      name: 'algorithmic-art',
      manifest: manifest(),
    });

    const skills = await store.listSkills({ tenant_id: TENANT, names: undefined });
    expect(skills.map(skill => skill.name)).toEqual(['algorithmic-art', 'web-artifacts']);
    expect(skills.every(skill => skill.tenant_id === TENANT)).toBe(true);
  });

  it('listSkills filters by names and returns empty for an empty name list', async () => {
    const store = getStore();
    await store.upsertSkill({ tenant_id: TENANT, name: 'algorithmic-art', manifest: manifest() });
    await store.upsertSkill({
      tenant_id: TENANT,
      name: 'web-artifacts',
      manifest: manifest({
        name: 'web-artifacts',
        path: 'skills/web-artifacts-builder',
        description: 'Build web artifacts.',
      }),
    });
    await store.upsertSkill({
      tenant_id: TENANT,
      name: 'demo',
      manifest: manifest({ name: 'demo', path: 'skills/demo', description: 'Demo skill.' }),
    });

    const filtered = await store.listSkills({
      tenant_id: TENANT,
      names: ['demo', 'missing', 'web-artifacts'],
    });
    expect(filtered.map(skill => skill.name)).toEqual(['demo', 'web-artifacts']);

    await expect(store.listSkills({ tenant_id: TENANT, names: [] })).resolves.toEqual([]);
  });
}
