/**
 * One-shot migrate for the default standalone SQLite data dir rename:
 *   env-paths("truefoundry-utils")/db/db.sqlite* → env-paths("trueforge")/db/db.sqlite*
 *
 * Assumes the earlier flat → `db/` layout move under truefoundry-utils already
 * ran for existing installs. This only relocates that `db/` tree to the new
 * app name.
 *
 * - No legacy `db/` files → noop.
 * - Destination already has db.sqlite + db.sqlite-shm + db.sqlite-wal → noop.
 * - Otherwise replace destination `db/` by copying, then best-effort delete
 *   the legacy copies (warn only if delete fails).
 *
 * Used by root `prestandalone:dev` / `:no-watch`.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import path from 'node:path';

import envPaths from 'env-paths';

const LEGACY_ENV_PATHS_APP_NAME = 'truefoundry-utils';
const ENV_PATHS_APP_NAME = 'trueforge';
const SQLITE_BASENAME = 'db.sqlite';
const COMPLETE_DEST_FILES = ['db.sqlite', 'db.sqlite-shm', 'db.sqlite-wal'];

function isSqliteFileName(name) {
  return name === SQLITE_BASENAME || name.startsWith(`${SQLITE_BASENAME}-`);
}

const legacyDataDir = envPaths(LEGACY_ENV_PATHS_APP_NAME, { suffix: '' }).data;
const legacyDbDir = path.join(legacyDataDir, 'db');
if (!existsSync(legacyDbDir)) {
  process.exit(0);
}

const legacyNames = readdirSync(legacyDbDir).filter(isSqliteFileName);
if (legacyNames.length === 0) {
  process.exit(0);
}

const newDbDir = path.join(envPaths(ENV_PATHS_APP_NAME, { suffix: '' }).data, 'db');
if (COMPLETE_DEST_FILES.every(name => existsSync(path.join(newDbDir, name)))) {
  process.exit(0);
}

rmSync(newDbDir, { recursive: true, force: true });
mkdirSync(newDbDir, { recursive: true });

for (const name of legacyNames) {
  const source = path.join(legacyDbDir, name);
  const destination = path.join(newDbDir, name);
  console.log(`Moving ${source} → ${destination}`);
  copyFileSync(source, destination);
}

for (const name of legacyNames) {
  const source = path.join(legacyDbDir, name);
  try {
    unlinkSync(source);
  } catch (error) {
    console.warn(`Could not remove legacy ${source}:`, error instanceof Error ? error.message : error);
  }
}

try {
  if (existsSync(legacyDbDir) && readdirSync(legacyDbDir).length === 0) {
    rmSync(legacyDbDir, { recursive: true, force: true });
  }
} catch (error) {
  console.warn(
    `Could not remove empty legacy dir ${legacyDbDir}:`,
    error instanceof Error ? error.message : error,
  );
}
