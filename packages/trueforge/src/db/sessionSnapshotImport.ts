/**
 * Ops-only session snapshot import. Postgres historical backfill — not ISessionStore.
 */
import type { ImportSessionSnapshotRequest, ImportSessionSnapshotResult } from '../schemas/sessionImport';

export interface ISessionSnapshotImporter {
  importSessionSnapshot(input: ImportSessionSnapshotRequest): Promise<ImportSessionSnapshotResult>;
}

export function isContextPrefix({ prefix, full }: { prefix: unknown[]; full: unknown[] }): boolean {
  if (prefix.length > full.length) {
    return false;
  }
  for (let i = 0; i < prefix.length; i++) {
    if (JSON.stringify(prefix[i]) !== JSON.stringify(full[i])) {
      return false;
    }
  }
  return true;
}
