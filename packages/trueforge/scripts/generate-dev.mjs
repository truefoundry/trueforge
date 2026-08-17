/**
 * Watch-mode codegen: local sandbox scripts + shipped catalogs.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
for (const script of ['generate-local-sandbox-scripts.mjs', 'generate-catalog.mjs']) {
  const result = spawnSync(process.execPath, [join(dir, script)], { stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
