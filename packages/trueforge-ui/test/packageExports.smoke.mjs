import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execPath } from 'node:process';
import { fileURLToPath, URL } from 'node:url';

// Create a temporary directory to test the package exports
const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const tempDir = await mkdtemp(path.join(packageRoot, 'test', '.package-smoke-'));

try {
  // create a tarball of the package
  execFileSync('pnpm', ['pack', '--pack-destination', tempDir], {
    cwd: packageRoot,
    stdio: 'inherit',
  });

  // confirm that the tarball was created
  const tarballs = (await readdir(tempDir)).filter(file => file.endsWith('.tgz'));
  assert.equal(tarballs.length, 1, 'Expected pnpm pack to create one tarball');
  const [tarballName] = tarballs;
  assert.ok(tarballName);

  // extract the tarball into a temporary directory
  const packageDir = path.join(tempDir, 'node_modules', '@truefoundry', 'trueforge-ui');
  await mkdir(packageDir, { recursive: true });
  execFileSync('tar', ['-xzf', path.join(tempDir, tarballName), '--strip-components=1', '-C', packageDir]);

  // Plugin adapter depends on @truefoundry/trueforge-sdk (workspace:* in monorepo) — expose it to the smoke consumer.
  await symlink(
    path.resolve(packageRoot, '../trueforge-sdk'),
    path.join(tempDir, 'node_modules', '@truefoundry', 'trueforge-sdk'),
  );

  // create a package.json for the consumer
  await writeFile(
    path.join(tempDir, 'package.json'),
    `${JSON.stringify({ name: 'trueforge-ui-package-smoke', private: true, type: 'module' }, null, 2)}\n`,
  );

  // create a consumer.mjs file that imports the package and verifies that the package exports are valid
  await writeFile(
    path.join(tempDir, 'consumer.mjs'),
    `import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const sdk = await import('@truefoundry/trueforge-ui');
const assistantUi = await import('@truefoundry/trueforge-ui/assistant-ui');
const trueforgeAdapter = await import('@truefoundry/trueforge-ui/plugins/trueforge-agent-server-adapter');

assert.equal(typeof sdk.TrueForgeUI, 'function');
assert.equal(typeof sdk.createTrueFoundryServer, 'function');
assert.equal(typeof sdk.useMCPAuth, 'function');
assert.equal(typeof assistantUi.useAui, 'function');
assert.equal(typeof assistantUi.useAuiState, 'function');
assert.equal(typeof trueforgeAdapter.createTrueForgeAgentUIServer, 'function');

const stylesPath = fileURLToPath(import.meta.resolve('@truefoundry/trueforge-ui/styles.css'));
await access(stylesPath);

const { readdir, readFile } = await import('node:fs/promises');
const { dirname, join } = await import('node:path');
const packageDist = dirname(fileURLToPath(import.meta.resolve('@truefoundry/trueforge-ui')));
const jsFiles = (await readdir(packageDist)).filter(name => name.endsWith('.js'));
const embedded = await Promise.all(jsFiles.map(name => readFile(join(packageDist, name), 'utf8')));
assert.ok(
  embedded.some(source => source.includes('trueforge-ui-styles') && source.includes('--color-indigo-500')),
  'Expected bundled JS to embed SDK stylesheet',
);
`,
  );

  // execute the consumer.mjs file in the temporary directory
  execFileSync(execPath, ['consumer.mjs'], {
    cwd: tempDir,
    stdio: 'inherit',
  });
} finally {
  // clean up the temporary directory
  await rm(tempDir, { recursive: true, force: true });
}
