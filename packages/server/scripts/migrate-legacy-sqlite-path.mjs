/**
 * Temporary layout migrate for the default standalone SQLite path:
 *   `{env-paths data}/db.sqlite*` → `{env-paths data}/db/db.sqlite*`
 *
 * - No legacy files → noop.
 * - `db/` already has db.sqlite + db.sqlite-shm + db.sqlite-wal → noop.
 * - Otherwise replace `db/` by copying legacy files, then best-effort delete
 *   the legacy copies (warn only if delete fails).
 *
 * Used by root `prestandalone:dev` / `:no-watch`. Remove once the package
 * rename lands and this path layout is no longer transitional.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import path from 'node:path';

import envPaths from 'env-paths';

const ENV_PATHS_APP_NAME = 'truefoundry-utils';
const SQLITE_BASENAME = 'db.sqlite';
const COMPLETE_DEST_FILES = ['db.sqlite', 'db.sqlite-shm', 'db.sqlite-wal'];

function isLegacySqliteFileName(name) {
  return name === SQLITE_BASENAME || name.startsWith(`${SQLITE_BASENAME}-`);
}

const dataDir = envPaths(ENV_PATHS_APP_NAME, { suffix: '' }).data;
if (!existsSync(dataDir)) {
  process.exit(0);
}

const legacyNames = readdirSync(dataDir).filter(isLegacySqliteFileName);
if (legacyNames.length === 0) {
  process.exit(0);
}

const newDir = path.join(dataDir, 'db');
if (COMPLETE_DEST_FILES.every(name => existsSync(path.join(newDir, name)))) {
  process.exit(0);
}

rmSync(newDir, { recursive: true, force: true });
mkdirSync(newDir, { recursive: true });

for (const name of legacyNames) {
  const source = path.join(dataDir, name);
  const destination = path.join(newDir, name);
  console.log(`Moving ${source} → ${destination}`);
  copyFileSync(source, destination);
}

for (const name of legacyNames) {
  const source = path.join(dataDir, name);
  try {
    unlinkSync(source);
  } catch (error) {
    console.warn(
      `Could not remove legacy ${source}:`,
      error instanceof Error ? error.message : error,
    );
  }
}
