/**
 * Probe: can an SRT-sandboxed command reach a host-owned 127.0.0.1 listener?
 * allowLocalBinding is session-scoped (initialize), not per-exec.
 */
import { getDefaultWritePaths, SandboxManager } from '@anthropic-ai/sandbox-runtime';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const sandboxRootPath = join(ROOT, 'sandboxes', `probe-loopback-${randomUUID()}`);
const SRT_VENDOR = join(
  dirname(fileURLToPath(import.meta.resolve('@anthropic-ai/sandbox-runtime/package.json'))),
  'vendor',
);

function denySharedDefaultWritePaths(): string[] {
  return getDefaultWritePaths().filter(path => !path.startsWith('/dev/'));
}

function platformAllowRead(): string[] {
  const common = [sandboxRootPath, '/usr/bin', '/bin', '/usr/sbin', '/sbin', '/usr/lib', '/dev', SRT_VENDOR];
  if (process.platform === 'darwin') {
    return [
      ...common,
      '/System/Library',
      '/Library',
      '/opt/homebrew',
      '/opt/homebrew/bin',
      '/private/var/db/dyld',
      '/private/var/select',
    ];
  }
  return [...common, '/lib', '/lib64', '/usr/lib64', '/usr/local', '/etc', '/proc', '/sys'];
}

async function listenHost(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('host-loopback-ok\n');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });
  const addr = server.address();
  if (addr === null || typeof addr === 'string') {
    throw new Error('expected TCP address');
  }
  return {
    port: addr.port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close(err => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      }),
  };
}

async function runSandboxed(params: { label: string; command: string; allowedDomains: string[] }): Promise<void> {
  const wrap = await SandboxManager.wrapWithSandboxArgv(
    params.command,
    '/bin/bash',
    {
      filesystem: {
        allowWrite: [sandboxRootPath],
        denyWrite: denySharedDefaultWritePaths(),
        denyRead: ['/'],
        allowRead: platformAllowRead(),
      },
      network: {
        allowedDomains: params.allowedDomains,
        deniedDomains: [],
      },
    },
    undefined,
    sandboxRootPath,
    { commandId: randomUUID(), commandText: params.command },
  );
  const [argv0, ...argvRest] = wrap.argv;
  if (argv0 === undefined) {
    throw new Error('empty argv');
  }

  const result = await new Promise<{ code: number | null; out: string }>((resolve, reject) => {
    const child = spawn(argv0, argvRest, {
      cwd: sandboxRootPath,
      env: {
        HOME: join(sandboxRootPath, '.home'),
        TMPDIR: join(sandboxRootPath, '.tmp'),
        PATH: process.platform === 'darwin' ? '/opt/homebrew/bin:/usr/bin:/bin' : '/usr/bin:/bin',
        ...wrap.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (c: Buffer) => {
      out += c.toString('utf8');
    });
    child.stderr.on('data', (c: Buffer) => {
      out += c.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', code => {
      resolve({ code, out });
    });
  });

  const preview = result.out.replace(/\s+/g, ' ').trim().slice(0, 280);
  console.log(`[${process.platform}] ${params.label}: exit=${String(result.code)} out=${JSON.stringify(preview)}`);
}

async function runSuite(params: { allowLocalBinding: boolean; hostPort: number }): Promise<void> {
  await SandboxManager.reset().catch(() => undefined);
  await SandboxManager.initialize({
    network: {
      allowedDomains: [],
      deniedDomains: [],
      allowLocalBinding: params.allowLocalBinding,
    },
    filesystem: {
      allowWrite: [],
      denyWrite: denySharedDefaultWritePaths(),
      denyRead: ['/'],
      allowRead: platformAllowRead(),
    },
  });

  console.log(`\n=== ${process.platform} session allowLocalBinding=${String(params.allowLocalBinding)} ===`);

  const connectCmd = [
    "python3 - <<'PY'",
    'import socket,sys',
    `port=${String(params.hostPort)}`,
    'try:',
    '  s=socket.create_connection(("127.0.0.1", port), timeout=2)',
    '  s.sendall(b"GET / HTTP/1.0\\r\\nHost: 127.0.0.1\\r\\n\\r\\n")',
    '  data=s.recv(200).decode("utf-8","replace")',
    '  s.close()',
    '  print("CONNECT_OK", "host-loopback-ok" in data, repr(data[:80]))',
    '  sys.exit(0 if "host-loopback-ok" in data else 1)',
    'except OSError as e:',
    '  print("CONNECT_FAIL", type(e).__name__, e)',
    '  sys.exit(2)',
    'PY',
  ].join('\n');

  const bindCmd = [
    "python3 - <<'PY'",
    'import socket,sys',
    'try:',
    '  s=socket.socket(socket.AF_INET, socket.SOCK_STREAM)',
    '  s.bind(("127.0.0.1", 0))',
    '  print("BIND_OK", s.getsockname())',
    '  s.close()',
    '  sys.exit(0)',
    'except OSError as e:',
    '  print("BIND_FAIL", type(e).__name__, e)',
    '  sys.exit(2)',
    'PY',
  ].join('\n');

  const ifacesCmd = [
    "python3 - <<'PY'",
    'import socket,sys',
    'print("hostname", socket.gethostname())',
    'try:',
    '  print("primary", socket.gethostbyname(socket.gethostname()))',
    'except OSError as e:',
    '  print("primary_fail", e)',
    'try:',
    '  s=socket.socket(socket.AF_INET, socket.SOCK_DGRAM)',
    '  s.connect(("8.8.8.8", 80))',
    '  print("udp_route_ip", s.getsockname()[0])',
    '  s.close()',
    'except OSError as e:',
    '  print("udp_route_fail", e)',
    'PY',
  ].join('\n');

  await runSandboxed({
    label: 'ifaces/route probe',
    command: ifacesCmd,
    allowedDomains: [],
  });
  await runSandboxed({
    label: 'connect host port (allowedDomains=[])',
    command: connectCmd,
    allowedDomains: [],
  });
  await runSandboxed({
    label: `connect host port (allowedDomains=127.0.0.1:${String(params.hostPort)})`,
    command: connectCmd,
    allowedDomains: [`127.0.0.1:${String(params.hostPort)}`],
  });
  await runSandboxed({
    label: 'bind sandbox 127.0.0.1:0',
    command: bindCmd,
    allowedDomains: [],
  });
}

async function main(): Promise<void> {
  await mkdir(join(sandboxRootPath, '.tmp'), { recursive: true, mode: 0o700 });
  await mkdir(join(sandboxRootPath, '.home'), { recursive: true, mode: 0o700 });

  const host = await listenHost();
  console.log(`[${process.platform}] host listener 127.0.0.1:${String(host.port)}`);

  try {
    await runSuite({ allowLocalBinding: false, hostPort: host.port });
    await runSuite({ allowLocalBinding: true, hostPort: host.port });
  } finally {
    await host.close();
    await SandboxManager.reset().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
