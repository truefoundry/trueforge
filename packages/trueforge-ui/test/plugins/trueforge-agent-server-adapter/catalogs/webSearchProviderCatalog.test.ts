import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  configFromHarness,
  filterUiWebSearchProviders,
  toHarnessManifest,
  toUiCatalogEntry,
  toUiWebSearchProvider,
} from '@/plugins/trueforge-agent-server-adapter/catalogs/webSearchProviderCatalog.js';

describe('webSearchProviderCatalog mappers', () => {
  const harnessCatalog = {
    type: 'parallel' as const,
    mode: 'turbo' as const,
  };

  const harnessConfigured = {
    ...harnessCatalog,
    auth: { apiKey: 'par_secret' },
  };

  it('stamps catalog identity from type and strips auth', () => {
    assert.deepEqual(toUiCatalogEntry(harnessCatalog), {
      id: 'parallel',
      name: 'Parallel',
      type: 'parallel',
      mode: 'turbo',
    });
  });

  it('maps configured provider without embedding apiKey', () => {
    assert.deepEqual(toUiWebSearchProvider(harnessConfigured), {
      id: 'parallel',
      name: 'Parallel',
      catalogId: 'parallel',
      isConnected: true,
      mode: 'turbo',
    });
    assert.equal('auth' in toUiWebSearchProvider(harnessConfigured), false);
    assert.equal('apiKey' in toUiWebSearchProvider(harnessConfigured), false);
  });

  it('filters providers by provider identity', () => {
    const provider = toUiWebSearchProvider(harnessConfigured);

    assert.deepEqual(filterUiWebSearchProviders({ providers: [provider], query: ' PAR ' }), [provider]);
    assert.deepEqual(filterUiWebSearchProviders({ providers: [provider], query: 'missing' }), []);
  });

  it('round-trips config fields into harness upsert body', () => {
    assert.deepEqual(
      toHarnessManifest({
        type: 'parallel',
        apiKey: 'par_secret',
        ...configFromHarness(harnessCatalog),
      }),
      harnessConfigured,
    );
  });

  it('rejects unsupported web-search provider types', () => {
    assert.throws(
      () =>
        toHarnessManifest({
          type: 'other',
          apiKey: 'x',
          mode: 'turbo',
        }),
      /Unsupported web-search provider type/,
    );
  });
});
