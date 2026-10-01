import { DaytonaSandboxProvider, withTimeout } from '@truefoundry/trueforge-core/core';
import type { ISandboxEnvironmentStore, SandboxEnvironmentVersionForProgress } from '../db/sandboxEnvironmentStore';
import type { ResolvedSandboxProvider } from '../sandbox/providerUtils';
import type {
  SandboxEnvironmentVersionInternalMetadata,
  StoredSandboxEnvironmentManifest,
} from '../schemas/sandboxEnvironment';
import { SandboxEnvironmentVersionInternalMetadataSchema } from '../schemas/sandboxEnvironment';
import { isRedactedSecretValue, SECRET_REDACTION } from '../utils/secretRedaction';

/** Bound hung Daytona RPCs so the sandbox-env-build tick can move on. */
export const DAYTONA_RPC_TIMEOUT_MS = 30_000;

export interface SyncSandboxEnvironmentSecretsResult {
  manifest: StoredSandboxEnvironmentManifest;
  internal_metadata: SandboxEnvironmentVersionInternalMetadata;
}

/** Sync org secrets for the version's provider, then redact the stored manifest. */
export async function syncSandboxEnvironmentSecrets({
  pending,
  provider,
  store,
}: {
  pending: SandboxEnvironmentVersionForProgress;
  provider: ResolvedSandboxProvider;
  store: ISandboxEnvironmentStore;
}): Promise<SyncSandboxEnvironmentSecretsResult> {
  switch (pending.manifest.type) {
    case 'daytona':
      if (!(provider instanceof DaytonaSandboxProvider)) {
        throw new Error('Daytona sandbox provider required for secret sync');
      }
      return syncDaytonaSandboxEnvironmentSecrets({ pending, provider, store });
    case 'truefoundry':
      throw new Error('Sandbox environment secret sync is not supported for truefoundry providers');
  }
}

async function syncDaytonaSandboxEnvironmentSecrets({
  pending,
  provider,
  store,
}: {
  pending: SandboxEnvironmentVersionForProgress;
  provider: DaytonaSandboxProvider;
  store: ISandboxEnvironmentStore;
}): Promise<SyncSandboxEnvironmentSecretsResult> {
  const desired = pending.manifest.networking?.secrets ?? [];
  const desiredNames = new Set(desired.map(secret => secret.env));
  const rows = await store.listSecretsByEnvironment({ environment_id: pending.environment_id });
  const byName = new Map(rows.map(row => [row.secret_name, row]));
  const secrets: { key: string; id: string }[] = [];

  for (const secret of desired) {
    const row = byName.get(secret.env);
    if (row === undefined) {
      throw new Error(`Sandbox environment secret row missing for ${secret.env}`);
    }

    if (row.external_secret_id === null) {
      if (isRedactedSecretValue(secret.value)) {
        throw new Error(`Cannot create Daytona secret ${secret.env}: value is redacted`);
      }
      const created = await withTimeout(
        provider.createOrgSecret({
          name: row.external_secret_name,
          value: secret.value,
          description: row.description,
          hosts: secret.hosts,
        }),
        DAYTONA_RPC_TIMEOUT_MS,
        'sandbox environment secret create',
      );
      await store.upsertSecret({
        tenant_id: row.tenant_id,
        environment_id: row.environment_id,
        secret_name: row.secret_name,
        description: row.description,
        hash: row.hash,
        external_secret_id: created.id,
      });
    } else {
      await withTimeout(
        provider.updateOrgSecret({
          secretId: row.external_secret_id,
          hosts: secret.hosts,
          ...(!isRedactedSecretValue(secret.value) ? { value: secret.value } : {}),
        }),
        DAYTONA_RPC_TIMEOUT_MS,
        'sandbox environment secret update',
      );
    }
    secrets.push({ key: secret.env, id: row.id });
  }

  const removed = rows.filter(row => !desiredNames.has(row.secret_name));
  for (const row of removed) {
    if (row.external_secret_id !== null) {
      await withTimeout(
        provider.deleteOrgSecret({ secretId: row.external_secret_id }),
        DAYTONA_RPC_TIMEOUT_MS,
        'sandbox environment secret delete',
      );
    }
  }
  await store.deleteSecretsByIds({ ids: removed.map(row => row.id) });

  const networking = pending.manifest.networking;
  return {
    manifest: {
      ...pending.manifest,
      ...(networking?.secrets
        ? {
            networking: {
              ...networking,
              secrets: networking.secrets.map(secret => ({ ...secret, value: SECRET_REDACTION })),
            },
          }
        : {}),
    },
    internal_metadata: SandboxEnvironmentVersionInternalMetadataSchema.parse({ secrets }),
  };
}
