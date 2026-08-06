import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  configFromHarness,
  toHarnessManifest,
  toUiCatalogEntry,
  toUiSandboxProvider,
} from '../src/sandboxProviderCatalog';

describe('sandboxProviderCatalog mappers', () => {
  const harnessCatalog = {
    type: 'daytona' as const,
    snapshotName: 'truefoundry-platform-dev',
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
      snapshotName: 'truefoundry-platform-dev',
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
      snapshotName: 'truefoundry-platform-dev',
      execTimeoutMs: 60000,
      autoStopIntervalInMinutes: 5,
      autoArchiveIntervalInMinutes: 60,
      autoDeleteIntervalInMinutes: 7200,
    });
    assert.equal('auth' in toUiSandboxProvider(harnessConfigured), false);
    assert.equal('apiKey' in toUiSandboxProvider(harnessConfigured), false);
  });

  it('round-trips config fields into harness upsert body', () => {
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
          snapshotName: 'snap',
          execTimeoutMs: 1,
          autoStopIntervalInMinutes: 1,
          autoArchiveIntervalInMinutes: 1,
          autoDeleteIntervalInMinutes: 1,
        }),
      /Unsupported sandbox provider type/i,
    );
  });
});
