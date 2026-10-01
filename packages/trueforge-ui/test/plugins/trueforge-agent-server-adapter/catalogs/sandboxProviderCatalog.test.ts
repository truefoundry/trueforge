import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  configFromHarness,
  filterUiSandboxProviders,
  isDaytonaSandboxConfig,
  toHarnessManifest,
  toUiCatalogEntry,
  toUiSandboxProvider,
} from '@/plugins/trueforge-agent-server-adapter/catalogs/sandboxProviderCatalog.js';

describe('sandboxProviderCatalog mappers', () => {
  const harnessCatalog = {
    type: 'daytona' as const,
    execTimeoutMs: 60000,
    autoStopIntervalInMinutes: 5,
    autoArchiveIntervalInMinutes: 60,
    autoDeleteIntervalInMinutes: 7200,
  };

  const harnessConfigured = {
    ...harnessCatalog,
    auth: { apiKey: 'dtn_secret' },
  };

  it('stamps catalog identity from type and strips auth', () => {
    assert.deepEqual(toUiCatalogEntry(harnessCatalog), {
      id: 'daytona',
      name: 'Daytona',
      type: 'daytona',
      execTimeoutMs: 60000,
      autoStopIntervalInMinutes: 5,
      autoArchiveIntervalInMinutes: 60,
      autoDeleteIntervalInMinutes: 7200,
    });
  });

  it('maps configured provider without embedding apiKey', () => {
    assert.deepEqual(toUiSandboxProvider(harnessConfigured), {
      id: 'daytona',
      name: 'Daytona',
      catalogId: 'daytona',
      isConnected: true,
      execTimeoutMs: 60000,
      autoStopIntervalInMinutes: 5,
      autoArchiveIntervalInMinutes: 60,
      autoDeleteIntervalInMinutes: 7200,
    });
    assert.equal('auth' in toUiSandboxProvider(harnessConfigured), false);
    assert.equal('apiKey' in toUiSandboxProvider(harnessConfigured), false);
  });

  it('filters providers by provider identity', () => {
    const provider = toUiSandboxProvider(harnessConfigured);

    assert.deepEqual(filterUiSandboxProviders({ providers: [provider], query: ' DAYT ' }), [provider]);
    assert.deepEqual(filterUiSandboxProviders({ providers: [provider], query: 'missing' }), []);
  });

  it('round-trips config fields into harness upsert body without a snapshot name', () => {
    assert.deepEqual(
      toHarnessManifest({
        type: 'daytona',
        apiKey: 'dtn_secret',
        ...configFromHarness(harnessCatalog),
      }),
      harnessConfigured,
    );
  });

  it('rejects unsupported sandbox provider types', () => {
    assert.throws(
      () =>
        toHarnessManifest({
          type: 'other',
          apiKey: 'x',
          execTimeoutMs: 1,
          autoStopIntervalInMinutes: 1,
          autoArchiveIntervalInMinutes: 1,
          autoDeleteIntervalInMinutes: 1,
        }),
      /Unsupported sandbox provider type/i,
    );
  });

  it('narrows DaytonaSandboxConfig via type guard', () => {
    assert.equal(isDaytonaSandboxConfig(configFromHarness(harnessCatalog)), true);
    assert.equal(isDaytonaSandboxConfig({ id: 'daytona' }), false);
  });
});
