/**
 * Copies the monorepo frontend build into `dist/_frontend` so the published
 * `@truefoundry/trueforge` tarball (and local `node dist/main.js` / `pnpm start`) can serve the UI
 * from next to the server bundle. Cleared by `pnpm clean` with the rest of dist/.
 *
 * Root `pnpm build` builds frontend before this package; a missing source only
 * skips (Docker builder builds frontend in a parallel stage).
 */
import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(packageRoot, '../frontend/dist');
const destination = path.join(packageRoot, 'dist', '_frontend');

if (!existsSync(path.join(source, 'index.html'))) {
  console.warn(
    `Skipping frontend copy: no build at ${source}. Run \`pnpm --filter frontend build\` first for a UI-capable package.`,
  );
  process.exit(0);
}

rmSync(destination, { recursive: true, force: true });
cpSync(source, destination, { recursive: true });
console.log(`Copied frontend build to ${destination}`);
