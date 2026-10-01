import type { SandboxProvider } from '@truefoundry/trueforge-core/core';
import { withTimeout } from '@truefoundry/trueforge-core/core';
import { randomUUID } from 'node:crypto';
import type { SandboxEnvironmentSecretRecord, SyncedSandboxEnvironmentSecret } from '../db/sandboxEnvironmentStore';
import { isRedactedSecretValue, MissingStoredSecretError } from '../utils/secretRedaction';
import { DAYTONA_RPC_TIMEOUT_MS } from './providerUtils';

export class SandboxEnvironmentSecretSyncError extends Error {
  constructor(message: string, options: ErrorOptions) {
    super(message, options);
    this.name = 'SandboxEnvironmentSecretSyncError';
  }
}

async function withSecretSyncError<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    throw new SandboxEnvironmentSecretSyncError(
      error instanceof Error ? error.message : 'Sandbox environment secret sync failed',
      { cause: error },
    );
  }
}

/** Sync provider org secrets from in-memory PUT values before the environment upsert. */
export async function syncSandboxEnvironmentSecrets({
  secrets,
  existing,
  provider,
  description,
}: {
  secrets: { env: string; value: string; hosts: string[] }[];
  existing: SandboxEnvironmentSecretRecord[];
  provider: SandboxProvider<unknown>;
  description: string;
}): Promise<SyncedSandboxEnvironmentSecret[]> {
  const desiredNames = new Set(secrets.map(secret => secret.env));
  const byName = new Map(existing.map(row => [row.secret_name, row]));
  const synced: SyncedSandboxEnvironmentSecret[] = [];

  for (const secret of secrets) {
    const row = byName.get(secret.env);
    if (row !== undefined) {
      await withSecretSyncError(
        withTimeout(
          provider.updateSecret({
            secretId: row.external_secret_id,
            hosts: secret.hosts,
            ...(!isRedactedSecretValue(secret.value) ? { value: secret.value } : {}),
          }),
          DAYTONA_RPC_TIMEOUT_MS,
          'sandbox environment secret update',
        ),
      );
      synced.push({
        secret_name: secret.env,
        external_secret_name: row.external_secret_name,
        external_secret_id: row.external_secret_id,
      });
      continue;
    }

    if (isRedactedSecretValue(secret.value)) {
      throw new MissingStoredSecretError();
    }
    const name = `trueforge-${randomUUID()}`;
    const created = await withSecretSyncError(
      withTimeout(
        provider.createSecret({
          name,
          value: secret.value,
          description,
          hosts: secret.hosts,
        }),
        DAYTONA_RPC_TIMEOUT_MS,
        'sandbox environment secret create',
      ),
    );
    synced.push({
      secret_name: secret.env,
      external_secret_name: name,
      external_secret_id: created.id,
    });
  }

  const removed = existing.filter(row => !desiredNames.has(row.secret_name));
  for (const row of removed) {
    await withSecretSyncError(
      withTimeout(
        provider.deleteSecret({ secretId: row.external_secret_id }),
        DAYTONA_RPC_TIMEOUT_MS,
        'sandbox environment secret delete',
      ),
    );
  }

  return synced;
}
