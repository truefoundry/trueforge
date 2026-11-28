import type { Kysely } from 'kysely';
import { createModelsRouter } from '../../../src/apis/models';
import { STANDALONE_REQUEST_CONTEXT } from '../../../src/auth/identity';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import type { ModelInfo } from '../../../src/db/modelProviderStore';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteConfigurationStore } from '../../../src/db/sqlite/configuration-store/SqliteConfigurationStore';
import { SqliteModelProviderStore } from '../../../src/db/sqlite/model-provider-store/SqliteModelProviderStore';
import type { Database } from '../../../src/db/sqlite/types';

/** Lists a fixed set of models, standing in for the tenant's provider store. */
class ListedModelsStore extends SqliteModelProviderStore {
  readonly #models: ModelInfo[];

  constructor({ db, models }: { db: Kysely<Database>; models: ModelInfo[] }) {
    super(db);
    this.#models = models;
  }

  override listModels(): Promise<ModelInfo[]> {
    return Promise.resolve(this.#models);
  }
}

const model = (name: string, canonical_model: string | null): ModelInfo => ({
  name,
  model_id: name,
  provider: { name: 'acct' },
  properties: {},
  canonical_model,
  cost: 1,
});

interface ListedModel {
  name: string;
  canonical_model: string | null;
  properties: { auto_routing: unknown };
}

async function listModels({ models, enabled }: { models: ModelInfo[]; enabled: string[] }) {
  const db = createSqliteDb(':memory:');
  await migrateSqliteToLatest(db);
  const configurationStore = new SqliteConfigurationStore(db);
  await configurationStore.upsertConfiguration({
    tenant_id: STANDALONE_REQUEST_CONTEXT.tenant_id,
    manifest: {
      web_search: { enabled: true },
      memory: { enabled: true },
      auto_model_routing: { enabled: true, candidate_models: enabled },
    },
  });
  const router = createModelsRouter({
    resolveModelProviderStore: () => new ListedModelsStore({ db, models }),
    configurationStore,
    withTransaction: callback => db.transaction().execute(callback),
    resolveRequestContext: () => STANDALONE_REQUEST_CONTEXT,
  });
  const response = await router.request('/');
  expect(response.status).toBe(200);
  const body = (await response.json()) as { data: ListedModel[] };
  return new Map(body.data.map(entry => [entry.name, entry]));
}

describe('GET /models auto_routing', () => {
  it('lists the categories a routable model serves and whether it is in the global list', async () => {
    const listed = await listModels({
      models: [
        model('acct/sonnet', 'anthropic/claude-sonnet-5-5'),
        model('acct/fable', 'anthropic/claude-fable-5-2'),
        model('acct/luna', 'openai/gpt-6-luna'),
      ],
      enabled: ['acct/sonnet'],
    });

    expect(listed.get('acct/sonnet')?.properties.auto_routing).toEqual({
      supported: true,
      enabled: true,
      categories: ['answer', 'execute', 'analyze', 'frontier'],
    });
    expect(listed.get('acct/fable')?.properties.auto_routing).toEqual({
      supported: true,
      enabled: false,
      categories: ['frontier'],
    });
    expect(listed.get('acct/luna')?.properties.auto_routing).toEqual({
      supported: true,
      enabled: false,
      categories: ['answer', 'execute'],
    });
  });

  it('says why a model cannot be routed to', async () => {
    const listed = await listModels({
      models: [model('acct/custom', null), model('acct/unlisted', 'acme/custom-llm')],
      enabled: [],
    });

    expect(listed.get('acct/custom')?.properties.auto_routing).toEqual({
      supported: false,
      unsupported_reason: 'The model has no canonical model mapping.',
    });
    expect(listed.get('acct/unlisted')?.properties.auto_routing).toEqual({
      supported: false,
      unsupported_reason: 'The model is not in any Auto routing cluster.',
    });
  });

  it('returns the canonical model when it is known and null otherwise', async () => {
    const listed = await listModels({
      models: [model('acct/sonnet', 'anthropic/claude-sonnet-5-5'), model('acct/custom', null)],
      enabled: [],
    });

    expect(listed.get('acct/sonnet')?.canonical_model).toBe('anthropic/claude-sonnet-5-5');
    expect(listed.get('acct/custom')?.canonical_model).toBeNull();
  });
});
