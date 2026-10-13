import type { SandboxProvider } from '@truefoundry/trueforge-core/core';
import { withTimeout } from '@truefoundry/trueforge-core/core';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { SandboxEnvironmentSecretRecord, SyncedSandboxEnvironmentSecret } from '../db/sandboxEnvironmentStore';
import type { SandboxEnvironmentSecret } from '../schemas/sandboxEnvironment';
import { isRedactedSecretValue, MissingStoredSecretError } from '../utils/secretRedaction';
import { DAYTONA_RPC_TIMEOUT_MS, isDaytonaNotFoundError } from './providerUtils';

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

export async function deleteSandboxEnvironmentSecrets({
  secrets,
  provider,
}: {
  secrets: SandboxEnvironmentSecretRecord[];
  provider: SandboxProvider<unknown>;
}): Promise<void> {
  for (const secret of secrets) {
    try {
      await withSecretSyncError(
        withTimeout(
          provider.deleteSecret({ secretId: secret.external_secret_id }),
          DAYTONA_RPC_TIMEOUT_MS,
          'sandbox environment secret delete',
        ),
      );
    } catch (error) {
      if (error instanceof SandboxEnvironmentSecretSyncError && isDaytonaNotFoundError(error.cause)) {
        continue;
      }
      throw error;
    }
  }
}

/** Sync provider org secrets from in-memory PUT values before the environment upsert. */
export async function syncSandboxEnvironmentSecrets({
  secrets,
  previous,
  existing,
  provider,
  description,
}: {
  secrets: SandboxEnvironmentSecret[];
  previous: SandboxEnvironmentSecret[];
  existing: SandboxEnvironmentSecretRecord[];
  provider: SandboxProvider<unknown>;
  description: string;
}): Promise<SyncedSandboxEnvironmentSecret[]> {
  const desiredNames = new Set(secrets.map(secret => secret.env));
  const previousByName = new Map(previous.map(secret => [secret.env, secret]));
  const byName = new Map(existing.map(row => [row.secret_name, row]));
  const synced: SyncedSandboxEnvironmentSecret[] = [];

  for (const secret of secrets) {
    const row = byName.get(secret.env);
    if (row !== undefined) {
      const valueChanged = !isRedactedSecretValue(secret.value);
      const hostsChanged = !isDeepStrictEqual(previousByName.get(secret.env)?.hosts, secret.hosts);
      if (valueChanged || hostsChanged) {
        await withSecretSyncError(
          withTimeout(
            provider.updateSecret({
              secretId: row.external_secret_id,
              hosts: secret.hosts,
              ...(valueChanged ? { value: secret.value } : {}),
            }),
            DAYTONA_RPC_TIMEOUT_MS,
            'sandbox environment secret update',
          ),
        );
      }
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
  await deleteSandboxEnvironmentSecrets({ secrets: removed, provider });

  return synced;
}
