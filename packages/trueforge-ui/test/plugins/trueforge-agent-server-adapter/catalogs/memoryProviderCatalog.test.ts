import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  toHarnessMemoryManifest,
  toUiMemoryCatalogEntry,
  toUiMemoryProvider,
} from '@/plugins/trueforge-agent-server-adapter/catalogs/memoryProviderCatalog.js';

describe('memoryProviderCatalog mappers', () => {
  it('stamps catalog identity from type', () => {
    assert.deepEqual(toUiMemoryCatalogEntry({ type: 'zep' }), { id: 'zep', name: 'Zep', type: 'zep' });
  });

  it('maps a configured provider without its key and keeps the server URL', () => {
    assert.deepEqual(
      toUiMemoryProvider({ type: 'zep', serverUrl: 'https://zep.example.com', auth: { apiKey: 'redacted' } }),
      { id: 'zep', name: 'Zep', catalogId: 'zep', isConnected: true, serverUrl: 'https://zep.example.com' },
    );
    assert.deepEqual(toUiMemoryProvider({ type: 'zep', auth: { apiKey: 'redacted' } }), {
      id: 'zep',
      name: 'Zep',
      catalogId: 'zep',
      isConnected: true,
    });
  });

  it('builds a Zep manifest and drops a blank server URL', () => {
    assert.deepEqual(toHarnessMemoryManifest({ type: 'zep', apiKey: 'zep_secret', serverUrl: '  ' }), {
      type: 'zep',
      auth: { apiKey: 'zep_secret' },
    });
    assert.deepEqual(toHarnessMemoryManifest({ type: 'zep', apiKey: 'zep_secret', serverUrl: 'https://zep.local' }), {
      type: 'zep',
      serverUrl: 'https://zep.local',
      auth: { apiKey: 'zep_secret' },
    });
  });

  it('rejects provider types it does not know', () => {
    assert.throws(() => toHarnessMemoryManifest({ type: 'mem0', apiKey: 'k', serverUrl: undefined }));
  });
});
