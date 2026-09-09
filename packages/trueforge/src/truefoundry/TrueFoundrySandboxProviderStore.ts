import type {
  ISandboxProviderStore,
  SandboxProviderRecord,
  UpdateSandboxStatusInput,
  UpsertSandboxProviderInput,
} from '../db/sandboxProviderStore';
import { trueFoundryManaged } from './errors';
import {
  resolveTrueFoundrySandboxProviderConfig,
  SANDBOX_DEFAULT_SETTINGS,
  type TrueFoundrySandboxProviderConfig,
} from './resolveTrueFoundrySandboxProviderConfig';

function synthesizeDaytonaRecord({
  tenantId,
  providerConfig,
}: {
  tenantId: string;
  providerConfig: Extract<TrueFoundrySandboxProviderConfig, { type: 'daytona' }>;
}): SandboxProviderRecord {
  const { settings } = providerConfig;
  const now = new Date().toISOString();
  return {
    tenant_id: tenantId,
    manifest: {
      type: 'daytona',
      auth: { api_key: providerConfig.apiKey },
      exec_timeout_ms: settings.timeoutMs,
      auto_stop_interval_in_minutes: settings.autoStopIntervalInMinutes,
      auto_archive_interval_in_minutes: settings.autoArchiveIntervalInMinutes,
      auto_delete_interval_in_minutes: settings.autoDeleteIntervalInMinutes,
    },
    status: 'ready',
    status_reason: null,
    // Snapshot name only — no image_uri; TrueFoundry mode never registers a snapshot.
    build_metadata: { build_ref: settings.snapshotName },
    created_at: now,
    // Fresh on every get so checkSnapshotStatus short-circuits without Daytona.
    updated_at: now,
  };
}

function synthesizeTrueFoundryRecord({
  tenantId,
  providerConfig,
}: {
  tenantId: string;
  providerConfig: Extract<TrueFoundrySandboxProviderConfig, { type: 'truefoundry' }>;
}): SandboxProviderRecord {
  const now = new Date().toISOString();
  return {
    tenant_id: tenantId,
    manifest: {
      type: 'truefoundry',
      server_url: providerConfig.serverUrl,
      nats_bridge_url: providerConfig.natsBridgeUrl,
      exec_timeout_ms: SANDBOX_DEFAULT_SETTINGS.timeoutMs,
    },
    status: 'ready',
    status_reason: null,
    build_metadata: null,
    created_at: now,
    updated_at: now,
  };
}

/** Env-backed shared sandbox; no per-request credentials (settings are static JSON). */
export class TrueFoundrySandboxProviderStore<TTransaction = never> implements ISandboxProviderStore<TTransaction> {
  getSandboxProvider(tenantId: string, transaction?: TTransaction): Promise<SandboxProviderRecord | undefined> {
    void transaction;
    const providerConfig = resolveTrueFoundrySandboxProviderConfig();
    if (!providerConfig) {
      return Promise.resolve(undefined);
    }
    switch (providerConfig.type) {
      case 'daytona':
        return Promise.resolve(synthesizeDaytonaRecord({ tenantId, providerConfig }));
      case 'truefoundry':
        return Promise.resolve(synthesizeTrueFoundryRecord({ tenantId, providerConfig }));
    }
  }

  getSandboxProviderForUpdate(tenantId: string, transaction: TTransaction): Promise<SandboxProviderRecord | undefined> {
    void tenantId;
    void transaction;
    return trueFoundryManaged();
  }

  upsertSandboxProvider(input: UpsertSandboxProviderInput, transaction?: TTransaction): Promise<SandboxProviderRecord> {
    void input;
    void transaction;
    return trueFoundryManaged();
  }

  updateSandboxStatus(
    input: UpdateSandboxStatusInput,
    transaction?: TTransaction,
  ): Promise<SandboxProviderRecord | undefined> {
    void input;
    void transaction;
    return trueFoundryManaged();
  }
}
