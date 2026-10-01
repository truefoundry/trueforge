// Unit cover for scripts/prepare-release.mjs. prepareRelease takes rootDir and
// an injectable `run`, so every case works on a temp fixture tree and no
// process is spawned.
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  bootstrapPackageVersion,
  parseChartVersion,
  preModeCommand,
  prepareRelease,
} from '../../scripts/prepare-release.mjs';

const CONFIG =
  '{\n  "$schema": "https://unpkg.com/@changesets/config/schema.json",\n  "baseBranch": "main",\n  "access": "public"\n}\n';

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build a fixture tree. `packages` maps a directory name to the raw
 * package.json text so tests can assert on formatting, not just parsed values.
 */
async function fixture({ config = CONFIG, pre = null, packages = {} } = {}) {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'prepare-release-'));
  await mkdir(path.join(rootDir, '.changeset'), { recursive: true });
  if (config !== null) {
    await writeFile(path.join(rootDir, '.changeset', 'config.json'), config);
  }
  if (pre !== null) {
    await writeFile(path.join(rootDir, '.changeset', 'pre.json'), pre);
  }
  await mkdir(path.join(rootDir, 'packages'), { recursive: true });
  for (const [name, raw] of Object.entries(packages)) {
    await mkdir(path.join(rootDir, 'packages', name), { recursive: true });
    await writeFile(path.join(rootDir, 'packages', name, 'package.json'), raw);
  }
  return rootDir;
}

function manifest({ name, version = '0.0.0', private: isPrivate = false }) {
  const lines = ['{', `  "name": "${name}",`, `  "version": "${version}",`];
  if (isPrivate) {
    lines.push('  "private": true,');
  }
  lines.push('  "main": "dist/index.js"', '}', '');
  return lines.join('\n');
}

/** Stand-in for `run` in cases that assert no subprocess is needed. */
const noRun = async () => undefined;

/** Records calls and whether .changeset/pre.json still existed at call time. */
function recorder(rootDir) {
  const calls = [];
  return {
    calls,
    run: async (command, args, cwd) => {
      calls.push({
        command,
        args,
        cwd,
        preJsonPresent: await exists(path.join(rootDir, '.changeset', 'pre.json')),
      });
    },
  };
}

test('parseChartVersion accepts a final version', () => {
  assert.deepEqual(parseChartVersion('0.200.0'), { major: '0', minor: '200', prerelease: false });
});

test('parseChartVersion accepts an rc version', () => {
  assert.deepEqual(parseChartVersion('0.200.0-rc.7'), {
    major: '0',
    minor: '200',
    prerelease: true,
  });
});

test('parseChartVersion rejects anything else', () => {
  for (const bad of ['0.200', '0.200.0-beta.1', 'v0.200.0', '', undefined, null, 0.2]) {
    assert.throws(
      () => parseChartVersion(bad),
      /TFY_CHART_VERSION must be X\.Y\.Z or X\.Y\.Z-rc\.N/,
      `expected ${JSON.stringify(bad)} to be rejected`,
    );
  }
});

test('bootstrapPackageVersion pins patch 0 and rc 0', () => {
  assert.equal(bootstrapPackageVersion('0.200.0'), '0.200.0');
  // Always rc.0, never the dispatched counter.
  assert.equal(bootstrapPackageVersion('0.200.0-rc.7'), '0.200.0-rc.0');
  // Patch is always 0, even for a hotfix line.
  assert.equal(bootstrapPackageVersion('0.199.7'), '0.199.0');
});

test('preModeCommand enters, exits, or keeps pre mode', () => {
  assert.equal(preModeCommand('0.200.0-rc.1', null), 'enter');
  assert.equal(preModeCommand('0.200.0-rc.1', { mode: 'pre' }), 'keep');
  // A stale pre.json left behind by a previous `pre exit` must be re-entered.
  assert.equal(preModeCommand('0.200.0-rc.1', { mode: 'exit' }), 'enter');
  assert.equal(preModeCommand('0.200.0', { mode: 'pre' }), 'exit');
  assert.equal(preModeCommand('0.200.0', null), 'keep');
});

test('prepareRelease rejects a branch that is not release-vX.Y.Z', async t => {
  const rootDir = await fixture();
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  await assert.rejects(
    prepareRelease({ rootDir, chartVersion: '0.200.0', branch: 'main', run: noRun }),
    /RELEASE_BRANCH must be release-vX\.Y\.Z/,
  );
});

test('prepareRelease rejects a branch carrying the rc suffix', async t => {
  const rootDir = await fixture();
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  await assert.rejects(
    prepareRelease({
      rootDir,
      chartVersion: '0.200.0-rc.1',
      branch: 'release-v0.200.0-rc.1',
      run: noRun,
    }),
    /RELEASE_BRANCH must be release-vX\.Y\.Z/,
  );
});

test('prepareRelease rewrites only the baseBranch field', async t => {
  const rootDir = await fixture();
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  await prepareRelease({
    rootDir,
    chartVersion: '0.200.0',
    branch: 'release-v0.200.0',
    run: noRun,
  });
  const after = await readFile(path.join(rootDir, '.changeset', 'config.json'), 'utf8');
  assert.equal(after, CONFIG.replace('"baseBranch": "main"', '"baseBranch": "release-v0.200.0"'));
});

test('prepareRelease fails when config.json has no baseBranch', async t => {
  const rootDir = await fixture({ config: '{\n  "access": "public"\n}\n' });
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  await assert.rejects(
    prepareRelease({
      rootDir,
      chartVersion: '0.200.0',
      branch: 'release-v0.200.0',
      run: noRun,
    }),
    /\.changeset\/config\.json is missing baseBranch/,
  );
});

test('prepareRelease enters pre mode for an rc with no pre.json', async t => {
  const rootDir = await fixture();
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const { calls, run } = recorder(rootDir);
  const result = await prepareRelease({
    rootDir,
    chartVersion: '0.200.0-rc.1',
    branch: 'release-v0.200.0',
    run,
  });
  assert.equal(result.pre, 'enter');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'pnpm');
  assert.deepEqual(calls[0].args, ['changeset', 'pre', 'enter', 'rc']);
  assert.equal(calls[0].cwd, rootDir);
  assert.equal(calls[0].preJsonPresent, false);
});

test('prepareRelease removes a stale pre.json before entering pre mode', async t => {
  const rootDir = await fixture({ pre: '{"mode":"exit","tag":"rc"}\n' });
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const { calls, run } = recorder(rootDir);
  const result = await prepareRelease({
    rootDir,
    chartVersion: '0.200.0-rc.1',
    branch: 'release-v0.200.0',
    run,
  });
  assert.equal(result.pre, 'enter');
  assert.deepEqual(calls[0].args, ['changeset', 'pre', 'enter', 'rc']);
  // The unlink has to happen first or `changeset pre enter` refuses.
  assert.equal(calls[0].preJsonPresent, false);
});

test('prepareRelease exits pre mode for a final version', async t => {
  const rootDir = await fixture({ pre: '{"mode":"pre","tag":"rc"}\n' });
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const { calls, run } = recorder(rootDir);
  const result = await prepareRelease({
    rootDir,
    chartVersion: '0.200.0',
    branch: 'release-v0.200.0',
    run,
  });
  assert.equal(result.pre, 'exit');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['changeset', 'pre', 'exit']);
  // `changeset pre exit` deletes pre.json itself; prepare-release must not.
  assert.equal(calls[0].preJsonPresent, true);
});

test('prepareRelease leaves a stable release with no pre.json alone', async t => {
  const rootDir = await fixture();
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const { calls, run } = recorder(rootDir);
  const result = await prepareRelease({
    rootDir,
    chartVersion: '0.200.0',
    branch: 'release-v0.200.0',
    run,
  });
  assert.equal(result.pre, 'keep');
  assert.equal(calls.length, 0);
});

test('prepareRelease bootstraps only published packages still at 0.0.0', async t => {
  const rootDir = await fixture({
    packages: {
      trueforge: manifest({ name: '@truefoundry/trueforge' }),
      'trueforge-core': manifest({ name: '@truefoundry/trueforge-core' }),
      'trueforge-ui': manifest({ name: '@truefoundry/trueforge-ui' }),
      frontend: manifest({ name: 'frontend', private: true }),
      'trueforge-sdk': manifest({ name: '@truefoundry/trueforge-sdk', version: '0.199.3' }),
    },
  });
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const result = await prepareRelease({
    rootDir,
    chartVersion: '0.200.0-rc.7',
    branch: 'release-v0.200.0',
    run: noRun,
  });

  assert.deepEqual(result.bootstrapped.sort(), ['trueforge', 'trueforge-core', 'trueforge-ui']);
  const version = async name =>
    JSON.parse(await readFile(path.join(rootDir, 'packages', name, 'package.json'), 'utf8')).version;
  // rc.0, not the dispatched rc.7.
  assert.equal(await version('trueforge'), '0.200.0-rc.0');
  assert.equal(await version('trueforge-core'), '0.200.0-rc.0');
  assert.equal(await version('trueforge-ui'), '0.200.0-rc.0');
  // private stays put, and an already-versioned package is never rewritten.
  assert.equal(await version('frontend'), '0.0.0');
  assert.equal(await version('trueforge-sdk'), '0.199.3');
});

test('prepareRelease bootstrap changes exactly one line of a manifest', async t => {
  const original = manifest({ name: '@truefoundry/trueforge' });
  const rootDir = await fixture({ packages: { trueforge: original } });
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  await prepareRelease({
    rootDir,
    chartVersion: '0.200.0',
    branch: 'release-v0.200.0',
    run: noRun,
  });
  const after = await readFile(path.join(rootDir, 'packages', 'trueforge', 'package.json'), 'utf8');
  const before = original.split('\n');
  const now = after.split('\n');
  assert.equal(now.length, before.length);
  const differing = before.filter((line, i) => line !== now[i]);
  // Proves the raw.replace path did not reflow the manifest.
  assert.deepEqual(differing, ['  "version": "0.0.0",']);
});

test('prepareRelease fails on a 0.0.0 manifest whose version field cannot be patched', async t => {
  // JSON.parse sees version 0.0.0; the raw text has no literal "version" key.
  const rootDir = await fixture({
    packages: { trueforge: '{\n  "\\u0076ersion": "0.0.0"\n}\n' },
  });
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  await assert.rejects(
    prepareRelease({
      rootDir,
      chartVersion: '0.200.0',
      branch: 'release-v0.200.0',
      run: noRun,
    }),
    /is 0\.0\.0 but the version field could not be replaced/,
  );
});

test('prepareRelease rejects a pre.json without a mode', async t => {
  const rootDir = await fixture({ pre: '{}\n' });
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  await assert.rejects(
    prepareRelease({
      rootDir,
      chartVersion: '0.200.0',
      branch: 'release-v0.200.0',
      run: noRun,
    }),
    /\.changeset\/pre\.json must be an object with mode/,
  );
});
