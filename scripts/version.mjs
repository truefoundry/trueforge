/**
 * Root `pnpm version` entry for changesets/action.
 *
 * `changeset version` only patches package.json (+ CHANGELOG). Fern also bakes the
 * SDK version into generated TS, so if `@truefoundry/trueforge-sdk` actually moved,
 * re-run `pnpm sdk:generate` and stage that output.
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sdkPackageJsonPath = path.join(rootDir, 'packages/trueforge-sdk/package.json');

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

const before = await readSdkVersion();
await run('pnpm', ['changeset', 'version']);
const after = await readSdkVersion();

if (before === after) {
  console.log(`SDK version unchanged (${before}); skipping sdk:generate`);
} else {
  console.log(`SDK version ${before} → ${after}; regenerating SDK so Fern rebakes version literals`);
  await run('pnpm', ['sdk:generate']);
  await run('git', ['add', '.github/fern/openapi', 'docs/openapi.json', 'packages/trueforge-sdk', 'pnpm-lock.yaml']);
}
