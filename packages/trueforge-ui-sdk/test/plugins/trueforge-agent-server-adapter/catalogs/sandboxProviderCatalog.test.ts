import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  configFromHarness,
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

  // Snapshot/image is release-owned now; mappers emit an empty snapshotName only to satisfy
  // the external SandboxProviderConfig type, and toHarnessManifest omits it entirely.
  it('stamps catalog identity from type and strips auth', () => {
    assert.deepEqual(toUiCatalogEntry(harnessCatalog), {
      id: 'daytona',
      name: 'Daytona',
      type: 'daytona',
      snapshotName: '',
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
      snapshotName: '',
      execTimeoutMs: 60000,
      autoStopIntervalInMinutes: 5,
      autoArchiveIntervalInMinutes: 60,
      autoDeleteIntervalInMinutes: 7200,
    });
    assert.equal('auth' in toUiSandboxProvider(harnessConfigured), false);
    assert.equal('apiKey' in toUiSandboxProvider(harnessConfigured), false);
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
});
