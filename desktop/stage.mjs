/**
 * Stages everything the unsigned macOS app needs at runtime:
 * a production TrueForge deployment and the Node executable used for this build.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stageDirectory = path.join(repoRoot, 'desktop/.stage');
const harnessDirectory = path.join(stageDirectory, 'harness');
const nodeDirectory = path.join(stageDirectory, 'node/bin');
const nodeExecutable = path.join(nodeDirectory, 'node');
const harnessEntry = path.join(harnessDirectory, 'dist/main.js');
const frontendEntry = path.join(harnessDirectory, 'dist/_frontend/index.html');

function run(options) {
  const result = spawnSync(options.command, options.args, {
    cwd: options.cwd ?? repoRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error !== undefined) {
    throw new Error(`Failed to run ${options.command}`, { cause: result.error });
  }
  if (result.status !== 0) {
    throw new Error(`${options.command} exited with code ${String(result.status)}`);
  }
}

if (process.platform !== 'darwin') {
  throw new Error('The desktop DMG can only be staged on macOS.');
}

rmSync(stageDirectory, { recursive: true, force: true });
mkdirSync(nodeDirectory, { recursive: true });

run({
  command: 'pnpm',
  args: [
    '--config.inject-workspace-packages=true',
    '--filter',
    '@truefoundry/trueforge',
    'deploy',
    '--prod',
    harnessDirectory,
  ],
});

if (!existsSync(harnessEntry) || !existsSync(frontendEntry)) {
  throw new Error('The staged TrueForge package is missing its server or bundled frontend build.');
}

copyFileSync(process.execPath, nodeExecutable);
chmodSync(nodeExecutable, 0o755);

run({
  command: nodeExecutable,
  args: ['--input-type=module', '--eval', "await import('better-sqlite3')"],
  cwd: harnessDirectory,
});

console.log(`Staged TrueForge harness and Node ${process.version} in ${stageDirectory}`);
