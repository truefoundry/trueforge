import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execPath, platform } from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const win32 = platform === 'win32';
const shell = win32 ? { shell: true } : {};
const host = '127.0.0.1';
const port = 18_790;
const origin = `http://${host}:${String(port)}`;
const packDir = await mkdtemp(path.join(tmpdir(), 'trueforge-pack-'));
const consumerDir = await mkdtemp(path.join(tmpdir(), 'trueforge-npx-'));
let child;

try {
  for (const filter of ['@truefoundry/trueforge-core', '@truefoundry/trueforge-sdk', '@truefoundry/trueforge']) {
    execFileSync('pnpm', ['--filter', filter, 'pack', '--pack-destination', packDir], {
      cwd: rootDir,
      stdio: 'pipe',
      ...shell,
    });
  }

  const tarballs = (await readdir(packDir)).filter(name => name.endsWith('.tgz')).map(name => path.join(packDir, name));
  execFileSync('npm', ['install', ...tarballs], { cwd: consumerDir, stdio: 'inherit', ...shell });

  child = spawn(
    execPath,
    [path.join(consumerDir, 'node_modules', '@truefoundry', 'trueforge', 'dist', 'cli.js'), '--port', String(port)],
    {
      cwd: consumerDir,
      env: {
        ...process.env,
        HOST: host,
        STANDALONE: 'true',
        SQLITE_PATH: path.join(consumerDir, 'db.sqlite'),
        NODE_ENV: 'production',
      },
      stdio: 'inherit',
    },
  );

  const deadline = Date.now() + 90_000;
  let lastError;
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`CLI exited before ready (code=${String(child.exitCode)})`);
    }
    try {
      const signal = globalThis.AbortSignal.timeout(2_000);
      const [health, ui] = await Promise.all([
        globalThis.fetch(`${origin}/healthz`, { signal }),
        globalThis.fetch(`${origin}/`, { signal }),
      ]);
      const html = await ui.text();
      if (health.ok && ui.ok && html.includes('id="root"')) {
        ready = true;
        break;
      }
      lastError = new Error(`healthz=${String(health.status)} ui=${String(ui.status)}`);
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }
  if (!ready) {
    throw new Error('packed CLI did not become ready', { cause: lastError });
  }
  console.log('packed CLI healthz and UI OK');
} finally {
  if (child?.pid !== undefined) {
    try {
      if (win32) {
        execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        child.kill('SIGTERM');
      }
    } catch {
      // already gone
    }
  }
  await rm(packDir, { recursive: true, force: true });
  await rm(consumerDir, { recursive: true, force: true });
}
