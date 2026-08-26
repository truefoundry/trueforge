/**
 * Turns the staged runtime in desktop/.stage into an unsigned DMG.
 *
 * electron-builder only builds the app bundle here: its resource copy drops
 * `node_modules`, so the harness would ship without its dependencies, and its DMG
 * target shells out to dmgbuild, which cannot retry the `hdiutil` image conversion
 * that macOS fails intermittently with EAGAIN.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stageDirectory = path.join(repoRoot, 'desktop/.stage');
const releaseDirectory = path.join(repoRoot, 'desktop/release');
const productName = 'TrueForge';

function run(options) {
  const result = spawnSync(options.command, options.args, {
    cwd: repoRoot,
    env: options.env ?? process.env,
    stdio: 'inherit',
  });
  if (result.error !== undefined) {
    throw new Error(`Failed to run ${options.command}`, { cause: result.error });
  }
  return result.status;
}

function runOrThrow(options) {
  const status = run(options);
  if (status !== 0) {
    throw new Error(`${options.command} exited with code ${String(status)}`);
  }
}

/** macOS fails hdiutil image conversion intermittently, so one failure is not a verdict. */
function createDiskImage(options) {
  const attemptLimit = 4;
  for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
    const status = run({
      command: 'hdiutil',
      args: [
        'create',
        '-volname',
        productName,
        '-srcfolder',
        options.payloadDirectory,
        '-fs',
        'HFS+',
        '-format',
        'UDZO',
        '-ov',
        options.dmgPath,
      ],
    });
    if (status === 0) {
      return;
    }
    if (attempt === attemptLimit) {
      throw new Error(`hdiutil create failed ${String(attemptLimit)} times with exit code ${String(status)}`);
    }
    console.log(`hdiutil create failed (attempt ${String(attempt)}/${String(attemptLimit)}); retrying…`);
  }
}

if (process.platform !== 'darwin') {
  throw new Error('The desktop DMG can only be built on macOS.');
}

const stagedHarness = path.join(stageDirectory, 'harness');
const stagedNode = path.join(stageDirectory, 'node');
if (!existsSync(path.join(stagedHarness, 'dist/main.js')) || !existsSync(path.join(stagedNode, 'bin/node'))) {
  throw new Error(`Missing staged runtime in ${stageDirectory}. Run \`pnpm desktop:stage\` first.`);
}

// Electron reads ELECTRON_RUN_AS_NODE when set by the surrounding terminal, which breaks packaging.
const builderEnv = { ...process.env };
delete builderEnv['ELECTRON_RUN_AS_NODE'];
runOrThrow({
  command: 'electron-builder',
  args: ['--config', 'desktop/electron-builder.yml', '--mac', 'dir'],
  env: builderEnv,
});

const architecture = process.arch === 'arm64' ? 'arm64' : 'x64';
const appBundle = path.join(releaseDirectory, `mac-${architecture}`, `${productName}.app`);
if (!existsSync(appBundle)) {
  throw new Error(`electron-builder did not write ${appBundle}`);
}

const bundleResources = path.join(appBundle, 'Contents/Resources');
// ditto keeps symlinks and extended attributes intact, which pnpm's node_modules layout needs.
runOrThrow({ command: 'ditto', args: [stagedHarness, path.join(bundleResources, 'harness')] });
runOrThrow({ command: 'ditto', args: [stagedNode, path.join(bundleResources, 'node')] });

const { version } = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const dmgPath = path.join(releaseDirectory, `${productName}-${version}-${architecture}.dmg`);
const payloadRoot = mkdtempSync(path.join(tmpdir(), 'trueforge-dmg-'));
const payloadDirectory = path.join(payloadRoot, 'payload');

try {
  mkdirSync(payloadDirectory);
  runOrThrow({ command: 'ditto', args: [appBundle, path.join(payloadDirectory, `${productName}.app`)] });
  symlinkSync('/Applications', path.join(payloadDirectory, 'Applications'));

  rmSync(dmgPath, { force: true });
  createDiskImage({ payloadDirectory, dmgPath });
} finally {
  rmSync(payloadRoot, { recursive: true, force: true });
}

console.log(`Built ${dmgPath}`);
