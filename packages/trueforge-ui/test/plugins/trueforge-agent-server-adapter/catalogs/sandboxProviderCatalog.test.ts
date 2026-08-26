import { TrueForgeApi } from '@truefoundry/trueforge-sdk';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  configFromHarness,
  filterUiSandboxProviders,
  toHarnessManifest,
  toUiCatalogEntry,
  toUiSandboxProvider,
  toUiSandboxProviderListEntry,
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

  const openSandboxCatalog = {
    type: 'opensandbox' as const,
    execTimeoutMs: 60000,
    domain: 'api.opensandbox.io',
    protocol: 'https' as const,
  };

  const openSandboxConfigured = {
    ...openSandboxCatalog,
    auth: { apiKey: 'osb_secret' },
  };

  function configuredResponse({
    status,
    statusReason,
  }: {
    status: TrueForgeApi.SandboxBuildStatus;
    statusReason: string | null;
  }): TrueForgeApi.GetSandboxProviderResponse['data'] {
    return {
      manifest: harnessConfigured,
      status,
      statusReason,
    };
  }

  // Snapshot/image is release-owned now; mappers emit an empty snapshotName only to satisfy
  // the external SandboxProviderConfig type, and toHarnessManifest omits it entirely.
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

  it('preserves OpenSandbox endpoint settings while using zero compatibility lifecycle values', () => {
    assert.deepEqual(toUiCatalogEntry(openSandboxCatalog), {
      id: 'opensandbox',
      name: 'OpenSandbox',
      type: 'opensandbox',
      execTimeoutMs: 60000,
      autoStopIntervalInMinutes: 0,
      autoArchiveIntervalInMinutes: 0,
      autoDeleteIntervalInMinutes: 0,
      domain: 'api.opensandbox.io',
      protocol: 'https',
    });
    assert.deepEqual(toUiSandboxProvider(openSandboxConfigured), {
      id: 'opensandbox',
      name: 'OpenSandbox',
      catalogId: 'opensandbox',
      isConnected: true,
      execTimeoutMs: 60000,
      autoStopIntervalInMinutes: 0,
      autoArchiveIntervalInMinutes: 0,
      autoDeleteIntervalInMinutes: 0,
      domain: 'api.opensandbox.io',
      protocol: 'https',
    });
  });

  it('wraps configured providers with snapshot sync status', () => {
    for (const status of [
      TrueForgeApi.SandboxBuildStatus.Pending,
      TrueForgeApi.SandboxBuildStatus.Ready,
      TrueForgeApi.SandboxBuildStatus.Failed,
    ]) {
      const statusReason = status === TrueForgeApi.SandboxBuildStatus.Failed ? 'Snapshot build failed' : null;
      const entry = toUiSandboxProviderListEntry(configuredResponse({ status, statusReason }));

      assert.equal(entry.snapshotSyncStatus.status, status);
      assert.deepEqual(entry.data, toUiSandboxProvider(harnessConfigured));
      if (statusReason) {
        assert.equal(entry.snapshotSyncStatus.statusReason, statusReason);
      } else {
        assert.equal('statusReason' in entry.snapshotSyncStatus, false);
      }
    }
  });

  it('filters wrapped providers by provider identity', () => {
    const provider = toUiSandboxProviderListEntry(
      configuredResponse({
        status: TrueForgeApi.SandboxBuildStatus.Ready,
        statusReason: null,
      }),
    );

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

  it('round-trips OpenSandbox domain and protocol into the harness manifest', () => {
    assert.deepEqual(
      toHarnessManifest({
        type: 'opensandbox',
        apiKey: 'osb_secret',
        execTimeoutMs: 60000,
        autoStopIntervalInMinutes: 0,
        autoArchiveIntervalInMinutes: 0,
        autoDeleteIntervalInMinutes: 0,
        domain: 'api.opensandbox.io',
        protocol: 'https',
      }),
      openSandboxConfigured,
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
