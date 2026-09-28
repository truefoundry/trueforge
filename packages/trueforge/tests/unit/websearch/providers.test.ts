import { ExaWebSearchProvider, ParallelWebSearchProvider } from '@truefoundry/trueforge-core/core';
import { WebSearchCatalog } from '../../../src/catalog/WebSearchCatalog';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteWebSearchProviderStore } from '../../../src/db/sqlite/web-search-provider-store/SqliteWebSearchProviderStore';
import type { WebSearchProviderManifest } from '../../../src/schemas/webSearchProvider';
import { hasConfiguredWebSearchProvider, resolveWebSearchProvider } from '../../../src/websearch/providers';

async function createStore() {
  const db = createSqliteDb(':memory:');
  await migrateSqliteToLatest(db);
  return new SqliteWebSearchProviderStore(db);
}

describe('resolveWebSearchProvider', () => {
  it('returns undefined and reports unconfigured when nothing is stored', async () => {
    const store = await createStore();
    expect(await resolveWebSearchProvider({ tenant_id: 'default', store })).toBeUndefined();
    expect(await hasConfiguredWebSearchProvider({ tenant_id: 'default', store })).toBe(false);
  });

  it.each<{
    manifest: WebSearchProviderManifest;
    expected: typeof ParallelWebSearchProvider | typeof ExaWebSearchProvider;
  }>([
    { manifest: { type: 'parallel', auth: { api_key: 'k' } }, expected: ParallelWebSearchProvider },
    { manifest: { type: 'exa', auth: { api_key: 'k' } }, expected: ExaWebSearchProvider },
  ])('constructs the $manifest.type provider from the stored manifest', async ({ manifest, expected }) => {
    const store = await createStore();
    await store.upsertProvider({ tenant_id: 'default', manifest });
    expect(await resolveWebSearchProvider({ tenant_id: 'default', store })).toBeInstanceOf(expected);
    expect(await hasConfiguredWebSearchProvider({ tenant_id: 'default', store })).toBe(true);
  });
});

describe('shipped web-search catalog', () => {
  it('lists parallel and exa presets without credentials', () => {
    expect(WebSearchCatalog.load().list()).toEqual([{ type: 'parallel' }, { type: 'exa' }]);
  });
});
