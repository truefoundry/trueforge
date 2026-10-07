import { Daytona, SnapshotState } from '@daytona/sdk';
import type { Logger } from 'winston';
import { STANDALONE_REQUEST_CONTEXT } from '../auth/identity';
import type { ISandboxProviderStore } from '../db/sandboxProviderStore';
import { captureCriticalException } from '../sentry';
import type { ControlLoop } from './Controller';

const SNAPSHOT_ACTIVATION_INTERVAL_MS = 60_000;
const SNAPSHOT_ACTIVATION_LOOP_NAME = 'daytona-snapshot-activation';
const SNAPSHOT_LIST_PAGE_SIZE = 100;
const TRUEFORGE_SNAPSHOT_PREFIX = 'trueforge-';

export interface DaytonaSnapshotActivationClient {
  list(input: { page: number; limit: number }): Promise<{
    items: { id: string; name: string; state: string }[];
    totalPages: number;
  }>;
  activate(snapshotId: string): Promise<void>;
}

export async function activateInactiveTrueForgeSnapshots({
  client,
  logger,
  signal,
}: {
  client: DaytonaSnapshotActivationClient;
  logger: Logger;
  signal: AbortSignal;
}): Promise<void> {
  let page = 1;
  while (!signal.aborted) {
    const snapshots = await client.list({ page, limit: SNAPSHOT_LIST_PAGE_SIZE });
    for (const snapshot of snapshots.items) {
      if (!snapshot.name.startsWith(TRUEFORGE_SNAPSHOT_PREFIX) || snapshot.state !== SnapshotState.INACTIVE) {
        continue;
      }
      try {
        await client.activate(snapshot.id);
        logger.debug('Activated inactive Daytona snapshot', {
          snapshot_id: snapshot.id,
          snapshot_name: snapshot.name,
        });
      } catch (error) {
        logger.error('Failed to activate inactive Daytona snapshot', {
          snapshot_id: snapshot.id,
          snapshot_name: snapshot.name,
          error: error instanceof Error ? error.message : String(error),
        });
        captureCriticalException(error, {
          tags: { module: 'daytonaSnapshotActivation', operation: 'activate' },
          extra: { snapshot_id: snapshot.id, snapshot_name: snapshot.name },
        });
      }
    }
    if (page >= snapshots.totalPages) {
      return;
    }
    page += 1;
  }
}

export function daytonaSnapshotActivationLoop<TTransaction>({
  sandboxProviderStore,
  logger,
}: {
  sandboxProviderStore: ISandboxProviderStore<TTransaction>;
  logger: Logger;
}): ControlLoop {
  return {
    name: SNAPSHOT_ACTIVATION_LOOP_NAME,
    intervalMs: SNAPSHOT_ACTIVATION_INTERVAL_MS,
    async tick(signal) {
      if (signal.aborted) {
        return;
      }
      const record = await sandboxProviderStore.getSandboxProvider(STANDALONE_REQUEST_CONTEXT.tenant_id);
      if (record?.manifest.type !== 'daytona') {
        return;
      }
      const snapshots = new Daytona({ apiKey: record.manifest.auth.api_key }).snapshot;
      await activateInactiveTrueForgeSnapshots({
        logger,
        signal,
        client: {
          list: input => snapshots.list(input),
          async activate(snapshotId) {
            await snapshots.activate(snapshotId);
          },
        },
      });
    },
  };
}
