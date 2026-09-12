/**
 * Root `pnpm version` entry for changesets/action.
 *
 * `changeset version` only patches package.json (+ CHANGELOG). Fern also bakes the
 * SDK version into generated TS/Python, so if `@truefoundry/trueforge-sdk` actually
 * moved, mirror that version into `python/trueforge_sdk/pyproject.toml`, re-run
 * `pnpm sdk:generate`, and stage that output.
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sdkPackageJsonPath = path.join(rootDir, 'packages/trueforge-sdk/package.json');
const pythonPyprojectPath = path.join(rootDir, 'python/trueforge_sdk/pyproject.toml');

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: 'inherit',
      env: process.env,
    });
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

async function readSdkVersion() {
  let raw;
  try {
    raw = await readFile(sdkPackageJsonPath, 'utf8');
  } catch (error) {
    throw new Error('Failed to read packages/trueforge-sdk/package.json', { cause: error });
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error('Failed to parse packages/trueforge-sdk/package.json', { cause: error });
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('packages/trueforge-sdk/package.json must be a JSON object');
  }
  if (!('version' in parsed) || typeof parsed.version !== 'string' || parsed.version.length === 0) {
    throw new Error('packages/trueforge-sdk/package.json is missing a non-empty string version');
  }
  return parsed.version;
}

/** Lockstep: Poetry version tracks the Changesets-bumped TS SDK version. */
async function setPythonSdkVersion(version) {
  let toml;
  try {
    toml = await readFile(pythonPyprojectPath, 'utf8');
  } catch (error) {
    throw new Error('Failed to read python/trueforge_sdk/pyproject.toml', { cause: error });
  }

  const next = toml.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`);
  if (next === toml) {
    throw new Error('python/trueforge_sdk/pyproject.toml is missing version = "…"');
  }
  await writeFile(pythonPyprojectPath, next, 'utf8');
  console.log(`Python SDK version → ${version}`);
}

function readPoetryVersion(toml) {
  const match = /^version\s*=\s*"([^"]+)"/m.exec(toml);
  if (match === null) {
    throw new Error('python/trueforge_sdk/pyproject.toml is missing version = "…"');
  }
  return match[1];
}

const before = await readSdkVersion();
let pythonToml;
try {
  pythonToml = await readFile(pythonPyprojectPath, 'utf8');
} catch (error) {
  throw new Error('Failed to read python/trueforge_sdk/pyproject.toml', { cause: error });
}
const pythonBefore = readPoetryVersion(pythonToml);

await run('pnpm', ['changeset', 'version']);
const after = await readSdkVersion();

if (before === after && pythonBefore === after) {
  console.log(`SDK version unchanged (${before}); skipping sdk:generate`);
} else {
  if (before !== after) {
    console.log(`SDK version ${before} → ${after}; regenerating SDK so Fern rebakes version literals`);
  } else {
    console.log(`Python SDK ${pythonBefore} diverged from TS ${after}; syncing and regenerating`);
  }
  await setPythonSdkVersion(after);
  await run('pnpm', ['sdk:generate']);
  await run('git', [
    'add',
    '.github/fern/openapi',
    'docs/openapi.json',
    'packages/trueforge-sdk',
    'python/trueforge_sdk',
    'pnpm-lock.yaml',
  ]);
}
