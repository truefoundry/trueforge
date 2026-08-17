/**
 * Package version for logs, the OpenAPI document, and the CLI.
 *
 * Read from `package.json` next to this module's package root — the same
 * `src/` vs `dist/` layout as `config.ts` (`import.meta` → parent).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readPackageVersion(): string {
  const packageJsonPath = path.join(PACKAGE_ROOT, 'package.json');
  const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || !('version' in parsed)) {
    throw new Error(`${packageJsonPath} is missing a version field`);
  }
  const { version } = parsed;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(`${packageJsonPath} version must be a non-empty string`);
  }
  return version;
}

export const PACKAGE_VERSION = readPackageVersion();
