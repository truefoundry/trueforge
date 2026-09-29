import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { bootstrapPackageVersion, preModeCommand, prepareRelease } from '../../scripts/prepare-release.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function scaffold(pre) {
  const root = await mkdtemp(path.join(tmpdir(), 'prepare-release-'));
  await mkdir(path.join(root, '.changeset'), { recursive: true });
  await mkdir(path.join(root, 'packages', 'frontend'), { recursive: true });
  await mkdir(path.join(root, 'packages', 'trueforge'), { recursive: true });
  await mkdir(path.join(root, 'packages', 'already'), { recursive: true });
  await mkdir(path.join(root, 'packages', 'fresh'), { recursive: true });
  await mkdir(path.join(root, 'packages', 'private-pkg'), { recursive: true });
  await writeFile(path.join(root, '.changeset', 'config.json'), '{\n  "baseBranch": "main"\n}\n');
  if (pre !== undefined) {
    await writeFile(path.join(root, '.changeset', 'pre.json'), JSON.stringify(pre));
  }
  await writeFile(
    path.join(root, 'packages', 'frontend', 'package.json'),
    '{"name":"frontend","version":"0.0.0","private":true}\n',
  );
  await writeFile(
    path.join(root, 'packages', 'trueforge', 'package.json'),
    '{"name":"@truefoundry/trueforge","version":"0.3.0-rc.0"}\n',
  );
  await writeFile(
    path.join(root, 'packages', 'already', 'package.json'),
    '{"name":"@truefoundry/already","version":"1.2.3"}\n',
  );
  await writeFile(
    path.join(root, 'packages', 'fresh', 'package.json'),
    '{"name":"@truefoundry/fresh","version":"0.0.0"}\n',
  );
  await writeFile(
    path.join(root, 'packages', 'private-pkg', 'package.json'),
    '{"name":"@truefoundry/private","private":true,"version":"0.0.0"}\n',
  );
  return root;
}

test('bootstrap version uses the TrueFoundry major.minor and patch 0', () => {
  assert.equal(bootstrapPackageVersion('0.176.0-rc.2'), '0.176.0-rc.0');
  assert.equal(bootstrapPackageVersion('0.176.0'), '0.176.0');
});

test('pre mode enters, exits, or stays', () => {
  assert.equal(preModeCommand('0.176.0-rc.1', null), 'enter');
  assert.equal(preModeCommand('0.176.0-rc.1', { mode: 'pre', tag: 'rc' }), 'keep');
  assert.equal(preModeCommand('0.176.0', { mode: 'pre', tag: 'rc' }), 'exit');
  assert.equal(preModeCommand('0.176.0', null), 'keep');
  assert.equal(preModeCommand('0.176.0-rc.1', { mode: 'exit', tag: 'rc' }), 'enter');
});

test('rc release enters pre mode and rewrites only unpublished 0.0.0 packages', async () => {
  const root = await scaffold(null);
  const commands = [];
  const result = await prepareRelease({
    rootDir: root,
    chartVersion: '0.176.0-rc.2',
    branch: 'release-v0.176.0',
    run: async (command, args) => {
      commands.push([command, ...args]);
      await writeFile(path.join(root, '.changeset', 'pre.json'), '{"mode":"pre","tag":"rc"}\n');
    },
  });
  assert.deepEqual(commands, [['pnpm', 'changeset', 'pre', 'enter', 'rc']]);
  assert.equal(result.pre, 'enter');
  assert.deepEqual(result.bootstrapped, ['fresh']);
  const config = await readFile(path.join(root, '.changeset', 'config.json'), 'utf8');
  assert.match(config, /"baseBranch": "release-v0.176.0"/);
  assert.equal(
    JSON.parse(await readFile(path.join(root, 'packages', 'fresh', 'package.json'), 'utf8')).version,
    '0.176.0-rc.0',
  );
  assert.equal(
    JSON.parse(await readFile(path.join(root, 'packages', 'frontend', 'package.json'), 'utf8')).version,
    '0.0.0',
  );
  assert.equal(
    JSON.parse(await readFile(path.join(root, 'packages', 'trueforge', 'package.json'), 'utf8')).version,
    '0.3.0-rc.0',
  );
  assert.equal(
    JSON.parse(await readFile(path.join(root, 'packages', 'private-pkg', 'package.json'), 'utf8')).version,
    '0.0.0',
  );
});

test('stable release exits pre mode and bootstraps 0.0.0 without an rc suffix', async () => {
  const root = await scaffold({ mode: 'pre', tag: 'rc' });
  const commands = [];
  const result = await prepareRelease({
    rootDir: root,
    chartVersion: '0.176.0',
    branch: 'release-v0.176.0',
    run: async (command, args) => {
      commands.push([command, ...args]);
    },
  });
  assert.deepEqual(commands, [['pnpm', 'changeset', 'pre', 'exit']]);
  assert.equal(result.pre, 'exit');
  assert.equal(
    JSON.parse(await readFile(path.join(root, 'packages', 'fresh', 'package.json'), 'utf8')).version,
    '0.176.0',
  );
});

test('matching pre mode does not run changeset pre', async () => {
  const root = await scaffold({ mode: 'pre', tag: 'rc' });
  const commands = [];
  const result = await prepareRelease({
    rootDir: root,
    chartVersion: '0.176.0-rc.4',
    branch: 'release-v0.176.0',
    run: async () => {
      commands.push('called');
    },
  });
  assert.deepEqual(commands, []);
  assert.equal(result.pre, 'keep');
});

test('bootstrapping the TS SDK mirrors the version into the Python SDK', async () => {
  const root = await scaffold(null);
  await mkdir(path.join(root, 'packages', 'trueforge-sdk'), { recursive: true });
  await mkdir(path.join(root, 'python', 'trueforge_sdk'), { recursive: true });
  await writeFile(
    path.join(root, 'packages', 'trueforge-sdk', 'package.json'),
    '{"name":"@truefoundry/trueforge-sdk","version":"0.0.0"}\n',
  );
  await writeFile(
    path.join(root, 'python', 'trueforge_sdk', 'pyproject.toml'),
    '[project]\nname = "trueforge_sdk"\ndynamic = ["version"]\n\n[tool.poetry]\nversion = "0.0.0"\n',
  );
  const result = await prepareRelease({
    rootDir: root,
    chartVersion: '0.176.0-rc.2',
    branch: 'release-v0.176.0',
    run: async () => {
      await writeFile(path.join(root, '.changeset', 'pre.json'), '{"mode":"pre","tag":"rc"}\n');
    },
  });
  assert.ok(result.bootstrapped.includes('trueforge-sdk'));
  assert.ok(result.bootstrapped.includes('python/trueforge_sdk/pyproject.toml'));
  const pyproject = await readFile(path.join(root, 'python', 'trueforge_sdk', 'pyproject.toml'), 'utf8');
  assert.match(pyproject, /^version = "0\.176\.0-rc\.0"$/m);
  assert.match(pyproject, /dynamic = \["version"\]/);
});

test('release workflow publishes from release branches', async () => {
  const workflow = await readFile(path.join(repoRoot, '.github/workflows/release.yml'), 'utf8');
  assert.match(workflow, /release-v\*/);
  assert.match(workflow, /tfy_chart_version/);
  assert.doesNotMatch(workflow, /branches:\s*\[main\]/);
  assert.match(workflow, /branch: \$\{\{ github\.ref_name \}\}/);
});
