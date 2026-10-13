/**
 * Prep a TrueForge release branch for one TrueFoundry chart version.
 *
 * `TFY_CHART_VERSION` is `X.Y.Z` or `X.Y.Z-rc.N`.
 * `RELEASE_BRANCH` is `release-vX.Y.Z`.
 *
 * Changesets pre mode follows that version. Published packages still at
 * `0.0.0` move to `X.Y.0` or `X.Y.0-rc.0`; private packages (`packages/frontend`)
 * stay `0.0.0`. Bootstrapping `packages/trueforge-sdk` deliberately leaves
 * `python/trueforge_sdk/pyproject.toml` alone: `pnpm run version` runs straight
 * after this script, and `scripts/version.mjs` syncs Poetry whenever the Python
 * version diverges from the TS SDK's - not only when `changeset version` moves
 * it - so the bootstrap is picked up there.
 * `.changeset/config.json` `baseBranch` becomes the release branch so version
 * changelogs are computed against it. `main` is not rewritten here.
 */
import { spawn } from 'node:child_process';
import { readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDirDefault = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chartVersionPattern = /^(\d+)\.(\d+)\.\d+(?:-rc\.\d+)?$/;
const releaseBranchPattern = /^release-v\d+\.\d+\.\d+$/;

export function parseChartVersion(chartVersion) {
  const match = typeof chartVersion === 'string' ? chartVersionPattern.exec(chartVersion) : null;
  if (match === null) {
    throw new Error(`TFY_CHART_VERSION must be X.Y.Z or X.Y.Z-rc.N, got ${JSON.stringify(chartVersion)}`);
  }
  return {
    major: match[1],
    minor: match[2],
    prerelease: chartVersion.includes('-rc.'),
  };
}

export function bootstrapPackageVersion(chartVersion) {
  const parsed = parseChartVersion(chartVersion);
  const core = `${parsed.major}.${parsed.minor}.0`;
  return parsed.prerelease ? `${core}-rc.0` : core;
}

export function preModeCommand(chartVersion, preState) {
  const prerelease = parseChartVersion(chartVersion).prerelease;
  const inPre = preState !== null && preState.mode === 'pre';
  if (prerelease && !inPre) {
    return 'enter';
  }
  if (!prerelease && inPre) {
    return 'exit';
  }
  return 'keep';
}

function defaultRun(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', env: process.env });
    child.on('error', error => {
      reject(new Error(`Failed to spawn ${command} ${args.join(' ')}`, { cause: error }));
    });
    child.on('close', code => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with code ${String(code)}`));
    });
  });
}

async function readJson(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  return JSON.parse(raw);
}

async function setBaseBranch(rootDir, branch) {
  const configPath = path.join(rootDir, '.changeset', 'config.json');
  const raw = await readFile(configPath, 'utf8');
  if (!raw.includes('"baseBranch"')) {
    throw new Error('.changeset/config.json is missing baseBranch');
  }
  const next = raw.replace(/"baseBranch"\s*:\s*"[^"]+"/, `"baseBranch": "${branch}"`);
  if (next === raw && !raw.includes(`"baseBranch": "${branch}"`)) {
    throw new Error('failed to set changesets baseBranch');
  }
  if (next !== raw) {
    await writeFile(configPath, next);
  }
}

async function readPreState(rootDir) {
  const prePath = path.join(rootDir, '.changeset', 'pre.json');
  const parsed = await readJson(prePath);
  if (parsed === null) {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || typeof parsed.mode !== 'string') {
    throw new Error('.changeset/pre.json must be an object with mode');
  }
  return parsed;
}

async function applyPreMode(rootDir, chartVersion, run) {
  const prePath = path.join(rootDir, '.changeset', 'pre.json');
  const preState = await readPreState(rootDir);
  const command = preModeCommand(chartVersion, preState);
  if (command === 'keep') {
    return command;
  }
  if (command === 'enter' && preState !== null) {
    await unlink(prePath);
  }
  const args = command === 'enter' ? ['changeset', 'pre', 'enter', 'rc'] : ['changeset', 'pre', 'exit'];
  await run('pnpm', args, rootDir);
  return command;
}

async function bootstrapZeroVersions(rootDir, chartVersion) {
  const target = bootstrapPackageVersion(chartVersion);
  const packagesDir = path.join(rootDir, 'packages');
  const entries = await readdir(packagesDir, { withFileTypes: true });
  const changed = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const packagePath = path.join(packagesDir, entry.name, 'package.json');
    let raw;
    try {
      raw = await readFile(packagePath, 'utf8');
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        continue;
      }
      throw error;
    }
    const parsed = JSON.parse(raw);
    if (parsed.private === true || parsed.version !== '0.0.0') {
      continue;
    }
    // Patch the one field instead of re-stringifying: these files are committed
    // on the release branch, and JSON.stringify would reflow the whole manifest.
    const next = raw.replace(/("version"\s*:\s*")0\.0\.0(")/, `$1${target}$2`);
    if (next === raw) {
      throw new Error(`${packagePath} is 0.0.0 but the version field could not be replaced`);
    }
    await writeFile(packagePath, next);
    changed.push(entry.name);
  }
  return changed;
}

export async function prepareRelease({ rootDir = rootDirDefault, chartVersion, branch, run = defaultRun }) {
  if (typeof branch !== 'string' || !releaseBranchPattern.test(branch)) {
    throw new Error(`RELEASE_BRANCH must be release-vX.Y.Z, got ${JSON.stringify(branch)}`);
  }
  parseChartVersion(chartVersion);
  await setBaseBranch(rootDir, branch);
  const pre = await applyPreMode(rootDir, chartVersion, run);
  const bootstrapped = await bootstrapZeroVersions(rootDir, chartVersion);
  console.log(`prepared ${branch} for ${chartVersion} (pre=${pre}, bootstrapped=${bootstrapped.join(',') || 'none'})`);
  return { pre, bootstrapped };
}

async function main() {
  await prepareRelease({
    chartVersion: process.env.TFY_CHART_VERSION,
    branch: process.env.RELEASE_BRANCH,
  });
}

// Run the release prep only when invoked as a script; tests import the exports.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
