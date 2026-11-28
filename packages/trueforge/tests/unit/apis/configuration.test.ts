import { sql, type Kysely } from 'kysely';
import { createConfigurationRouter } from '../../../src/apis/configuration';
import { STANDALONE_REQUEST_CONTEXT } from '../../../src/auth/identity';
import configuration, { parseTrueFoundryModelRouting } from '../../../src/config';
import type { IConfigurationStore } from '../../../src/db/configurationStore';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import type { ModelInfo } from '../../../src/db/modelProviderStore';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteConfigurationStore } from '../../../src/db/sqlite/configuration-store/SqliteConfigurationStore';
import { SqliteModelProviderStore } from '../../../src/db/sqlite/model-provider-store/SqliteModelProviderStore';
import type { Database } from '../../../src/db/sqlite/types';

function patchInit(manifest: unknown): RequestInit {
  return {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ manifest }),
  };
}

const modelNames = (count: number) => Array.from({ length: count }, (_, index) => `acct/model-${String(index)}`);

// Any four consecutive default models together serve every routing category.
const ROUTABLE_CANONICAL_IDS = [
  'google/gemini-3-8-flash',
  'google/gemini-4-argon',
  'anthropic/claude-fable-5-2',
  'anthropic/claude-haiku-5-5',
];
const defaultCanonicalModels = Object.fromEntries(
  modelNames(10).flatMap((name, index) => {
    const canonicalId = ROUTABLE_CANONICAL_IDS[index % ROUTABLE_CANONICAL_IDS.length];
    return canonicalId === undefined ? [] : [[name, canonicalId]];
  }),
);

/** Sets up model routing for `tenantId` for the tests in the surrounding describe. */
function useModelRouting(tenantId: string) {
  const routingKeys = ['STANDALONE', 'TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL', 'TRUEFOUNDRY_MODEL_ROUTING'] as const;
  let previous: Map<(typeof routingKeys)[number], unknown> | undefined;

  beforeEach(() => {
    previous = new Map(routingKeys.map(key => [key, Reflect.get(configuration, key)]));
    Reflect.set(configuration, 'STANDALONE', false);
    Reflect.set(configuration, 'TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL', 'http://sfy.example');
    Reflect.set(
      configuration,
      'TRUEFOUNDRY_MODEL_ROUTING',
      parseTrueFoundryModelRouting(
        JSON.stringify({
          decision_model: { name: 'typesafe/jev-1.13.0', api_key: 'test-routing-key' },
          tenants: { [tenantId]: { enabled: 'on' } },
        }),
      ),
    );
  });

  afterEach(() => {
    for (const [key, value] of previous ?? []) Reflect.set(configuration, key, value);
    previous = undefined;
  });
}

/** Lists a fixed set of models, standing in for the models the calling admin has access to. */
class ListedModelsStore extends SqliteModelProviderStore {
  readonly #models: ModelInfo[];

  constructor({
    db,
    names,
    canonicalModels = {},
  }: {
    db: Kysely<Database>;
    names: string[];
    /** Canonical ids by model name, which place a model in a routing category. */
    canonicalModels?: Record<string, string>;
  }) {
    super(db);
    this.#models = names.map(name => ({
      name,
      model_id: name,
      provider: { name: 'acct' },
      properties: {},
      canonicalModel: canonicalModels[name],
      cost: 1,
    }));
  }

  override listModels(): Promise<ModelInfo[]> {
    return Promise.resolve(this.#models);
  }
}

/** The admin can access `accessibleModels`; by default the ten models the tests pick from. */
async function createRouter({
  accessibleModels = modelNames(10),
  canonicalModels = defaultCanonicalModels,
}: { accessibleModels?: string[]; canonicalModels?: Record<string, string> } = {}) {
  const db = createSqliteDb(':memory:');
  await migrateSqliteToLatest(db);
  const store = new SqliteConfigurationStore(db);
  const router = createConfigurationRouter({
    resolveConfigurationStore: () => store,
    resolveModelProviderStore: () => new ListedModelsStore({ db, names: accessibleModels, canonicalModels }),
    resolveRequestContext: () => STANDALONE_REQUEST_CONTEXT,
  });
  return { router, store, db };
}

describe('settings configuration router', () => {
  it('GET reports the defaults (memory on) and materialises the row on first read', async () => {
    const { router, store } = await createRouter();

    const response = await router.request('/');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        manifest: {
          web_search: { enabled: true },
          memory: { enabled: true },
          auto_model_routing: { enabled: true, candidate_models: [] },
        },
        updated_at: expect.any(String),
      },
    });
    await expect(store.getConfiguration(STANDALONE_REQUEST_CONTEXT.tenant_id)).resolves.toEqual({
      tenant_id: STANDALONE_REQUEST_CONTEXT.tenant_id,
      manifest: {
        web_search: { enabled: true },
        memory: { enabled: true },
        auto_model_routing: { enabled: true, candidate_models: [] },
      },
      updated_at: expect.any(String),
    });
  });

  it('PATCH saves the switches and a later GET reads them back', async () => {
    const { router } = await createRouter();

    const patched = await router.request('/', patchInit({ web_search: { enabled: false } }));
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({
      data: { manifest: { web_search: { enabled: false }, memory: { enabled: true } } },
    });

    const get = await router.request('/');
    expect(get.status).toBe(200);
    expect(await get.json()).toMatchObject({
      data: { manifest: { web_search: { enabled: false }, memory: { enabled: true } } },
    });
  });

  it('PATCH on a tenant with nothing saved starts from the defaults', async () => {
    const { router, store } = await createRouter();

    const patched = await router.request('/', patchInit({ web_search: { enabled: false } }));
    expect(patched.status).toBe(200);
    await expect(store.getConfiguration(STANDALONE_REQUEST_CONTEXT.tenant_id)).resolves.toMatchObject({
      manifest: { web_search: { enabled: false }, memory: { enabled: true } },
    });
  });

  it('PATCH can turn web search back on', async () => {
    const { router, store } = await createRouter();

    await router.request('/', patchInit({ web_search: { enabled: false } }));
    const reEnabled = await router.request('/', patchInit({ web_search: { enabled: true } }));
    expect(reEnabled.status).toBe(200);

    await expect(store.getConfiguration(STANDALONE_REQUEST_CONTEXT.tenant_id)).resolves.toMatchObject({
      manifest: { web_search: { enabled: true }, memory: { enabled: true } },
    });
  });

  it('PATCH turns memory off without touching web search', async () => {
    const { router, store } = await createRouter();

    const patched = await router.request('/', patchInit({ memory: { enabled: false } }));
    expect(patched.status).toBe(200);

    await expect(store.getConfiguration(STANDALONE_REQUEST_CONTEXT.tenant_id)).resolves.toMatchObject({
      manifest: { web_search: { enabled: true }, memory: { enabled: false } },
    });
  });

  it('PATCH turns Auto mode off without touching the other switches', async () => {
    const { router, store } = await createRouter();

    const patched = await router.request('/', patchInit({ auto_model_routing: { enabled: false } }));
    expect(patched.status).toBe(200);

    await expect(store.getConfiguration(STANDALONE_REQUEST_CONTEXT.tenant_id)).resolves.toMatchObject({
      manifest: {
        web_search: { enabled: true },
        memory: { enabled: true },
        auto_model_routing: { enabled: false, candidate_models: [] },
      },
    });
  });

  describe('Auto mode model candidate list', () => {
    const tenantId = STANDALONE_REQUEST_CONTEXT.tenant_id;
    const four = modelNames(4);
    useModelRouting(tenantId);

    async function savedList(store: Awaited<ReturnType<typeof createRouter>>['store']) {
      // No row at all (nothing was ever saved) reads as an empty list.
      return (await store.getConfiguration(tenantId))?.manifest.auto_model_routing.candidate_models ?? [];
    }

    it('rejects setting the list when model routing is off for the tenant, and saves nothing', async () => {
      Reflect.set(configuration, 'TRUEFOUNDRY_MODEL_ROUTING', undefined);
      const { router, store } = await createRouter();

      const patched = await router.request('/', patchInit({ auto_model_routing: { candidate_models: four } }));

      expect(patched.status).toBe(400);
      expect(await patched.json()).toEqual({ error: { message: 'Model routing is not enabled for this tenant.' } });
      expect(await savedList(store)).toEqual([]);
    });

    it('saves the list without repeats and reads it back', async () => {
      const { router, store } = await createRouter();

      const saved = await router.request(
        '/',
        patchInit({ auto_model_routing: { candidate_models: [...four, 'acct/model-0'] } }),
      );
      expect(saved.status).toBe(200);
      expect(await (await router.request('/')).json()).toMatchObject({
        data: { manifest: { auto_model_routing: { enabled: true, candidate_models: four } } },
      });
      expect(await savedList(store)).toEqual(four);
    });

    it('changes the switch and the list independently, and never checks access for the switch', async () => {
      const { router, store, db } = await createRouter();
      await router.request('/', patchInit({ auto_model_routing: { candidate_models: four } }));
      const withNoModels = createConfigurationRouter({
        resolveConfigurationStore: () => store,
        resolveModelProviderStore: () => new ListedModelsStore({ db, names: [] }),
        resolveRequestContext: () => STANDALONE_REQUEST_CONTEXT,
      });

      const switchedOff = await withNoModels.request('/', patchInit({ auto_model_routing: { enabled: false } }));
      expect(switchedOff.status).toBe(200);
      expect(await savedList(store)).toEqual(four);

      await router.request('/', patchInit({ auto_model_routing: { candidate_models: modelNames(5) } }));
      await expect(store.getConfiguration(tenantId)).resolves.toMatchObject({
        manifest: { auto_model_routing: { enabled: false, candidate_models: modelNames(5) } },
      });
    });

    it('accepts 4 to 10 distinct models and rejects anything else, including an empty list, keeping the saved list', async () => {
      const { router, store } = await createRouter();
      await router.request('/', patchInit({ auto_model_routing: { candidate_models: four } }));
      const repeated = Array.from({ length: 4 }, () => 'acct/model-0');

      for (const tooFew of [[], modelNames(3), repeated, modelNames(11)]) {
        const rejected = await router.request('/', patchInit({ auto_model_routing: { candidate_models: tooFew } }));
        expect(rejected.status).toBe(400);
      }
      expect(await savedList(store)).toEqual(four);

      const ten = await router.request('/', patchInit({ auto_model_routing: { candidate_models: modelNames(10) } }));
      expect(ten.status).toBe(200);
    });

    it('rejects names that are not account/model, and null', async () => {
      const { router } = await createRouter();

      for (const candidate_models of [['sonnet'], ['acct/'], ['acct/team/sonnet'], null]) {
        const rejected = await router.request('/', patchInit({ auto_model_routing: { candidate_models } }));
        expect(rejected.status).toBe(400);
      }
    });

    it('rejects models the admin has no access to, and saves nothing', async () => {
      const { router, store } = await createRouter({ accessibleModels: four });
      const lacking = ['acct/model-0', 'acct/model-1', 'acct/model-2', 'acct/secret-a', 'acct/secret-b'];

      const patched = await router.request('/', patchInit({ auto_model_routing: { candidate_models: lacking } }));

      expect(patched.status).toBe(400);
      expect(await patched.json()).toEqual({
        error: {
          message: 'You do not have access to all candidate models in the provided list.',
        },
      });
      expect(await savedList(store)).toEqual([]);
    });

    describe('with model routing set up for the tenant', () => {
      // flash covers routine and guided, argon covers analytical, fable covers frontier.
      const canonicalModels = {
        'acct/flash': 'google/gemini-3-8-flash',
        'acct/argon': 'google/gemini-4-argon',
        'acct/fable': 'anthropic/claude-fable-5-2',
        'acct/haiku': 'anthropic/claude-haiku-5-5',
        'acct/haiku-2': 'anthropic/claude-haiku-5-5',
        'acct/fable-2': 'anthropic/claude-fable-5-2',
        'acct/fable-3': 'anthropic/claude-fable-5-2',
        'acct/fable-4': 'anthropic/claude-fable-5-2',
        'acct/other': 'unlisted/other-model',
      };
      const accessibleModels = Object.keys(canonicalModels);
      const patchList = (router: Awaited<ReturnType<typeof createRouter>>['router'], candidate_models: string[]) =>
        router.request('/', patchInit({ auto_model_routing: { candidate_models } }));

      it('rejects a list that leaves a routing category without a model, naming it, and saves nothing', async () => {
        const { router, store } = await createRouter({ accessibleModels, canonicalModels });

        const noFrontier = await patchList(router, ['acct/flash', 'acct/argon', 'acct/haiku', 'acct/haiku-2']);
        expect(noFrontier.status).toBe(400);
        expect(await noFrontier.json()).toEqual({
          error: {
            message: "The selected models don't cover every tier. Add a model for the frontier tier.",
          },
        });

        const onlyFrontier = await patchList(router, ['acct/fable', 'acct/fable-2', 'acct/fable-3', 'acct/fable-4']);
        expect(await onlyFrontier.json()).toEqual({
          error: {
            message:
              "The selected models don't cover every tier. Add a model for each of these tiers: routine, guided, and analytical.",
          },
        });
        expect(await savedList(store)).toEqual([]);
      });

      it('rejects a list with a model that cannot be routed to, without naming it, and saves nothing', async () => {
        const { router, store } = await createRouter({ accessibleModels, canonicalModels });

        const response = await patchList(router, ['acct/flash', 'acct/argon', 'acct/fable', 'acct/other']);

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: { message: 'candidate_models must only contain models that support Auto routing' },
        });
        expect(await savedList(store)).toEqual([]);
      });

      it('accepts a list that covers every category', async () => {
        const { router, store } = await createRouter({ accessibleModels, canonicalModels });
        const covering = ['acct/flash', 'acct/argon', 'acct/fable', 'acct/haiku'];

        expect((await patchList(router, covering)).status).toBe(200);
        expect(await savedList(store)).toEqual(covering);
      });
    });
  });

  it('PATCH leaves switches the body does not mention', async () => {
    const { router, store } = await createRouter();

    await router.request('/', patchInit({ web_search: { enabled: false } }));
    const empty = await router.request('/', patchInit({}));
    expect(empty.status).toBe(200);

    await expect(store.getConfiguration(STANDALONE_REQUEST_CONTEXT.tenant_id)).resolves.toMatchObject({
      manifest: { web_search: { enabled: false }, memory: { enabled: true } },
    });
  });

  it('GET does not roll back an update that landed while it was in flight', async () => {
    const { store, db } = await createRouter();
    const tenant_id = STANDALONE_REQUEST_CONTEXT.tenant_id;
    // Stands in for a PATCH committing after the GET found no row.
    const racingStore: IConfigurationStore = {
      getConfiguration: tenant => store.getConfiguration(tenant),
      upsertConfiguration: input => store.upsertConfiguration(input),
      getOrCreateConfiguration: async input => {
        await store.upsertConfiguration({
          tenant_id,
          manifest: {
            web_search: { enabled: false },
            memory: { enabled: false },
            auto_model_routing: { enabled: true, candidate_models: [] },
          },
        });
        return await store.getOrCreateConfiguration(input);
      },
      listTenantIdsWithFeatureEnabled: feature => store.listTenantIdsWithFeatureEnabled(feature),
    };
    const router = createConfigurationRouter({
      resolveConfigurationStore: () => racingStore,
      resolveModelProviderStore: () => new ListedModelsStore({ db, names: [] }),
      resolveRequestContext: () => STANDALONE_REQUEST_CONTEXT,
    });

    const response = await router.request('/');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { manifest: { web_search: { enabled: false }, memory: { enabled: false } } },
    });
    await expect(store.getConfiguration(tenant_id)).resolves.toMatchObject({
      manifest: { web_search: { enabled: false }, memory: { enabled: false } },
    });
  });

  it('seeds memory on into a row saved without it, keeping the switches it has', async () => {
    const { router, db } = await createRouter();
    const tenant_id = STANDALONE_REQUEST_CONTEXT.tenant_id;
    await sql`INSERT INTO configuration (tenant_id, manifest, updated_at)
      VALUES (${tenant_id}, jsonb('{"web_search":{"enabled":false}}'), ${new Date().toISOString()})`.execute(db);

    const read = await router.request('/');
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      data: { manifest: { web_search: { enabled: false }, memory: { enabled: true } } },
    });

    // Aliased away from `manifest` so the raw stored document is read.
    const stored = await sql<{
      raw: string;
    }>`SELECT json(manifest) AS raw FROM configuration WHERE tenant_id = ${tenant_id}`.execute(db);
    expect(JSON.parse(stored.rows[0]?.raw ?? 'null')).toEqual({
      web_search: { enabled: false },
      memory: { enabled: true },
      auto_model_routing: { enabled: true, candidate_models: [] },
    });
  });

  it('PATCH rejects a switch the server does not know about', async () => {
    const { router } = await createRouter();
    const patched = await router.request(
      '/',
      patchInit({ web_search: { enabled: true }, sandbox: { enabled: false } }),
    );
    expect(patched.status).toBe(400);
  });
});
