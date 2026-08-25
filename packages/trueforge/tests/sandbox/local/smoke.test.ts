/**
 * LocalSandboxProvider smoke (macOS host or Linux via Lima)
 * plus Code Mode UDS and security probes. Run via `pnpm smoke`.
 */
import { getDefaultWritePaths, SandboxManager } from '@anthropic-ai/sandbox-runtime';
import { CodeModeDispatcher, type IToolSet } from '@truefoundry/trueforge-core/core';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, realpath, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ulid } from 'ulid';
import { createLogger } from 'winston';
import {
  CodeModeUdsTransport,
  installMcpFixture,
  localMcpClientRemotePath,
} from '../../../src/sandbox/local/core/CodeModeUdsTransport.js';
import {
  commandPath,
  createSandbox,
  MAX_OUTPUT_BYTES,
  platformAllowRead,
  removeSandbox,
  runSupervisorSession,
} from '../../../src/sandbox/local/core/hostRun.js';
import { LocalSandboxProvider } from '../../../src/sandbox/local/provider/LocalSandboxProvider.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const SANDBOXES = join(ROOT, 'sandboxes');
const DENY_READ_SECRET = join(SANDBOXES, '.poc-deny-read-secret');
const DEFAULT_TMP_CLAUDE = '/tmp/claude';
const DELETE_TARGET = join(DEFAULT_TMP_CLAUDE, 'poc-delete-target.txt');
const SECRET_CONTENTS = 'host-secret-should-not-leak\n';
const HOST_HOME = process.env['HOME'];
const ENV_LEAK_MARKER = 'TFY_SMOKE_HOST_SECRET';
const ENV_LEAK_VALUE = 'host-env-must-not-reach-sandbox';
const ENV_INHERIT_MARKER = 'TFY_SMOKE_INHERIT';
const ENV_INHERIT_VALUE = `inherit-${randomUUID()}`;
const ENV_PEER_MARKER = 'TFY_SMOKE_PEER_ENV';
const ENV_PEER_VALUE = `peer-secret-${randomUUID()}`;
/** Product-shaped allowlist for smoke Code Mode client (demo/ping only). */
const TFY_MCP_SERVERS_DEMO = Buffer.from(JSON.stringify({ demo: { allowed_tools: ['ping'] } }), 'utf8').toString(
  'base64',
);
// Package-root resolve: Jest's CJS transform breaks import.meta.resolve.
const SRT_VENDOR = join(
  dirname(createRequire(import.meta.url).resolve('@anthropic-ai/sandbox-runtime/package.json')),
  'vendor',
);
async function prepareHostProbeFiles(): Promise<void> {
  await mkdir(DEFAULT_TMP_CLAUDE, { recursive: true, mode: 0o700 });
  await mkdir(SANDBOXES, { recursive: true, mode: 0o700 });
  await writeFile(DELETE_TARGET, 'delete-me\n', { mode: 0o600 });
  await writeFile(DENY_READ_SECRET, SECRET_CONTENTS, { mode: 0o600 });
}

async function cleanupHostProbeFiles(): Promise<void> {
  await rm(DELETE_TARGET, { force: true });
  await rm(DENY_READ_SECRET, { force: true });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

/**
 * After initSrt grants the Code Mode parent, a sock under that parent is
 * connectable; a leftover host /tmp sock outside the parent is not.
 */
async function smokeCodeModeSocketParentAllow(params: {
  sandboxRootPath: string;
  codeModeSocketParentPath: string;
  shell: string;
  platform: 'darwin' | 'linux';
}): Promise<void> {
  const parent = await realpath(params.codeModeSocketParentPath);
  const allowedSock = join(parent, ulid().toLowerCase());
  const leftoverSock = join('/tmp', `tfy-srt-leak-${ulid().toLowerCase().slice(0, 10)}`);
  await unlink(allowedSock).catch(() => undefined);
  await unlink(leftoverSock).catch(() => undefined);

  const listen = async (path: string): Promise<{ close: () => Promise<void> }> => {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(path, () => {
        server.off('error', reject);
        resolve();
      });
    });
    server.on('connection', socket => {
      socket.end();
    });
    return {
      close: async () => {
        await new Promise<void>(resolve => {
          server.close(() => {
            resolve();
          });
        });
        await unlink(path).catch(() => undefined);
      },
    };
  };

  const connectCmd = (path: string): string =>
    [
      "python3 - <<'PY'",
      'import socket, sys',
      `path = ${JSON.stringify(path)}`,
      's = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)',
      'try:',
      '  s.connect(path)',
      '  print("connected")',
      'except OSError as e:',
      '  print(type(e).__name__, e, file=sys.stderr)',
      '  sys.exit(1)',
      'finally:',
      '  s.close()',
      'PY',
    ].join('\n');

  const allowed = await listen(allowedSock);
  const leftover = await listen(leftoverSock);
  try {
    const ok = await runSupervisorSession({
      sandboxRootPath: params.sandboxRootPath,
      shell: params.shell,
      platform: params.platform,
      command: connectCmd(allowedSock),
      timeoutMs: 10_000,
    });
    assert.equal(ok.exitCode, 0, ok.stderrText);
    assert.match(ok.stdoutText, /connected/);

    const blocked = await runSupervisorSession({
      sandboxRootPath: params.sandboxRootPath,
      shell: params.shell,
      platform: params.platform,
      command: connectCmd(leftoverSock),
      timeoutMs: 10_000,
    });
    assert.notEqual(blocked.exitCode, 0, 'connect to leftover /tmp sock must fail');
    assert.ok(!blocked.stdoutText.includes('connected'));
    console.log('ok: SRT allows Code Mode parent UDS and denies leftover host /tmp sock');
  } finally {
    await allowed.close();
    await leftover.close();
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function makeSilentCodeModeLogger() {
  const logger = {
    error: () => undefined,
    child: () => logger,
  };
  return logger;
}

function makeDemoToolSet(params: { onRequest?: () => void }): IToolSet {
  return {
    name: 'demo',
    id: 'demo',
    preload: true,
    hasPreloadedTools: true,
    listTools: () => {
      params.onRequest?.();
      return Promise.resolve({
        result: {
          tools: [
            {
              name: 'ping',
              description: 'ping',
              inputSchema: { type: 'object' as const, properties: {} },
              preload: true,
            },
          ],
        },
        wasInitialized: undefined,
      });
    },
    callTool: async request => {
      params.onRequest?.();
      const args = request.arguments ?? {};
      const delayRaw = args['delay_ms'];
      const delayMs = typeof delayRaw === 'number' && Number.isFinite(delayRaw) ? delayRaw : 0;
      if (delayMs > 0) await sleep(delayMs);
      return {
        result: {
          content: [{ type: 'text' as const, text: JSON.stringify({ echo: args }) }],
          isError: false,
        },
        wasInitialized: undefined,
      };
    },
    toolCallInfo: () => undefined,
  };
}

async function withCodeModeTransport(params: {
  codeModeSocketParentPath: string;
  sandboxRootPath: string;
  maxMessageBytes?: number;
  onProtocolError?: (message: string) => void;
  onRequest?: () => void;
  run: (env: Record<string, string>) => Promise<void>;
}): Promise<void> {
  const transport = new CodeModeUdsTransport({
    codeModeSocketParentPath: params.codeModeSocketParentPath,
    clientRemotePath: localMcpClientRemotePath,
    ...(params.maxMessageBytes === undefined ? {} : { maxMessageBytes: params.maxMessageBytes }),
    ...(params.onProtocolError === undefined ? {} : { onProtocolError: params.onProtocolError }),
  });
  const dispatcher = new CodeModeDispatcher({
    toolSets: [makeDemoToolSet({ onRequest: params.onRequest })],
    logger: makeSilentCodeModeLogger(),
  });
  const install = transport.getClientInstall({ sandboxId: params.sandboxRootPath });
  try {
    const { env } = await transport.start({
      codeModeDispatcher: dispatcher,
      sandboxId: params.sandboxRootPath,
      requestTimeoutSeconds: 60,
    });
    await params.run({
      ...env,
      PYTHONPATH: dirname(install.remotePath),
      TFY_MCP_SERVERS: TFY_MCP_SERVERS_DEMO,
      TFY_ENABLE_AGENT_APPROVALS: 'true',
    });
  } finally {
    dispatcher.close();
    await transport.stop();
  }
}

async function smokeCodeMode(params: {
  sandboxRootPath: string;
  codeModeSocketParentPath: string;
  shell: string;
  platform: 'darwin' | 'linux';
}): Promise<void> {
  await installMcpFixture(params.sandboxRootPath);
  let toolRequests = 0;

  await withCodeModeTransport({
    codeModeSocketParentPath: params.codeModeSocketParentPath,
    sandboxRootPath: params.sandboxRootPath,
    onRequest: () => {
      toolRequests += 1;
    },
    run: async env => {
      const sockPath = env['TFY_MCP_SOCK'];
      assert.ok(sockPath !== undefined && sockPath.length > 0);
      const sockStat = await stat(sockPath);
      assert.equal(sockStat.mode & 0o777, 0o600, `Code Mode sock must be 0600: ${sockPath}`);
      const parentStat = await stat(params.codeModeSocketParentPath);
      assert.equal(
        parentStat.mode & 0o777,
        0o700,
        `Code Mode sock parent must be 0700: ${params.codeModeSocketParentPath}`,
      );
      console.log('ok: Code Mode UDS parent 0700 + sock 0600');

      const call = await runSupervisorSession({
        sandboxRootPath: params.sandboxRootPath,
        shell: params.shell,
        platform: params.platform,
        command: `mcp-client call-tool demo ping '${JSON.stringify({ message: 'poc' })}'`,
        env,
        timeoutMs: 15_000,
      });
      assert.equal(call.protocolError, undefined, call.protocolError);
      assert.equal(call.exitCode, 0, call.stderrText);
      const callJson: unknown = JSON.parse(call.stdoutText.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? '');
      assert.ok(callJson !== null && typeof callJson === 'object');
      assert.ok('echo' in callJson);
      console.log('ok: Code Mode call-tool (UDS)');
    },
  });

  const oversizeCap = 1024;
  let oversizeError: string | undefined;
  await withCodeModeTransport({
    codeModeSocketParentPath: params.codeModeSocketParentPath,
    sandboxRootPath: params.sandboxRootPath,
    maxMessageBytes: oversizeCap,
    onProtocolError: message => {
      oversizeError = message;
    },
    run: async env => {
      const oversize = await runSupervisorSession({
        sandboxRootPath: params.sandboxRootPath,
        shell: params.shell,
        platform: params.platform,
        command: [
          "python3 - <<'PY'",
          'import os, socket, time',
          'path = os.environ["TFY_MCP_SOCK"]',
          's = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)',
          's.connect(path)',
          `s.sendall(b"x" * ${String(oversizeCap + 1)})`,
          's.shutdown(socket.SHUT_WR)',
          'time.sleep(1)',
          'PY',
        ].join('\n'),
        env,
        timeoutMs: 10_000,
      });
      assert.equal(oversize.exitCode, 0, oversize.stderrText);
      assert.match(String(oversizeError), /exceeds max/);
      console.log('ok: Code Mode oversized message is terminal');
    },
  });

  let badJsonError: string | undefined;
  await withCodeModeTransport({
    codeModeSocketParentPath: params.codeModeSocketParentPath,
    sandboxRootPath: params.sandboxRootPath,
    onProtocolError: message => {
      badJsonError = message;
    },
    run: async env => {
      const badJson = await runSupervisorSession({
        sandboxRootPath: params.sandboxRootPath,
        shell: params.shell,
        platform: params.platform,
        command: [
          "python3 - <<'PY'",
          'import os, socket, time',
          'path = os.environ["TFY_MCP_SOCK"]',
          's = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)',
          's.connect(path)',
          's.sendall(b"not")',
          's.shutdown(socket.SHUT_WR)',
          'time.sleep(1)',
          'PY',
        ].join('\n'),
        env,
        timeoutMs: 10_000,
      });
      assert.equal(badJson.exitCode, 0, badJson.stderrText);
      assert.match(String(badJsonError), /invalid JSON message/);
      console.log('ok: Code Mode malformed JSON message is terminal');
    },
  });

  await withCodeModeTransport({
    codeModeSocketParentPath: params.codeModeSocketParentPath,
    sandboxRootPath: params.sandboxRootPath,
    onRequest: () => {
      toolRequests += 1;
    },
    run: async env => {
      const multiplex = await runSupervisorSession({
        sandboxRootPath: params.sandboxRootPath,
        shell: params.shell,
        platform: params.platform,
        command: [
          "python3 - <<'PY'",
          'import asyncio, json, time',
          'from mcp_client import call_tool',
          'async def main():',
          '  started = time.monotonic()',
          '  results = await asyncio.gather(',
          '    call_tool("demo", "ping", {"message": "m0", "delay_ms": 150}),',
          '    call_tool("demo", "ping", {"message": "m1", "delay_ms": 150}),',
          '  )',
          '  print("multiplex-ok", int((time.monotonic() - started) * 1000), json.dumps(results))',
          'asyncio.run(main())',
          'PY',
        ].join('\n'),
        env,
        timeoutMs: 15_000,
      });
      assert.equal(multiplex.protocolError, undefined, multiplex.protocolError);
      assert.equal(multiplex.exitCode, 0, multiplex.stderrText);
      const multiplexMatch = /multiplex-ok (\d+)/.exec(multiplex.stdoutText);
      assert.ok(multiplexMatch, multiplex.stdoutText);
      const multiplexMs = Number(multiplexMatch[1]);
      assert.ok(multiplexMs < 280, `multiplex looked serial: gather ${String(multiplexMs)}ms (expected < 280ms)`);
      console.log('ok: Code Mode concurrent UDS multiplex', `${String(multiplexMs)}ms`);
    },
  });

  const beforeMissing = toolRequests;
  await withCodeModeTransport({
    codeModeSocketParentPath: params.codeModeSocketParentPath,
    sandboxRootPath: params.sandboxRootPath,
    onRequest: () => {
      toolRequests += 1;
    },
    run: async env => {
      const missingSock = await runSupervisorSession({
        sandboxRootPath: params.sandboxRootPath,
        shell: params.shell,
        platform: params.platform,
        command: [
          'set -euo pipefail',
          'unset TFY_MCP_SOCK',
          `if mcp-client call-tool demo ping '${JSON.stringify({ message: 'x' })}'; then`,
          '  echo "expected missing-sock failure" >&2',
          '  exit 1',
          'fi',
          'echo ok-missing-sock',
        ].join('\n'),
        env,
        timeoutMs: 10_000,
      });
      assert.equal(missingSock.exitCode, 0, missingSock.stderrText);
      assert.match(missingSock.stdoutText, /ok-missing-sock/);
      assert.equal(toolRequests, beforeMissing, 'missing sock must not deliver tool requests');
      console.log('ok: Code Mode requires TFY_MCP_SOCK');
    },
  });

  let hostInjected = 0;
  let holdPid: number | undefined;
  await withCodeModeTransport({
    codeModeSocketParentPath: params.codeModeSocketParentPath,
    sandboxRootPath: params.sandboxRootPath,
    onRequest: () => {
      hostInjected += 1;
    },
    run: async env => {
      const holdSession = runSupervisorSession({
        sandboxRootPath: params.sandboxRootPath,
        shell: params.shell,
        platform: params.platform,
        command: [
          'set -euo pipefail',
          "python3 - <<'PY'",
          'import os, time',
          'open(".uds-ready", "w").write(os.environ["TFY_MCP_SOCK"] + "\\n")',
          'time.sleep(60)',
          'PY',
        ].join('\n'),
        env,
        onChildSpawn: pid => {
          holdPid = pid;
        },
        timeoutMs: 15_000,
      });
      let sockFromSandbox = '';
      for (let i = 0; i < 80 && sockFromSandbox === ''; i++) {
        try {
          sockFromSandbox = (await readFile(join(params.sandboxRootPath, '.uds-ready'), 'utf8')).trim();
        } catch {
          await sleep(50);
        }
      }
      assert.match(sockFromSandbox, /^\//, 'sandbox never published absolute TFY_MCP_SOCK');
      const hostSockPath = sockFromSandbox.startsWith('/')
        ? sockFromSandbox
        : join(params.sandboxRootPath, sockFromSandbox);
      const hostConnect = await new Promise<{ code: number | null; err: string }>((resolve, reject) => {
        const child = spawn(
          'python3',
          [
            '-c',
            [
              'import os, socket, sys, json',
              'path = sys.argv[1]',
              'req = {"op":"list_tools","server":"demo"}',
              'body = json.dumps(req).encode()',
              's = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)',
              'if len(path.encode()) >= 104:',
              '  os.chdir(os.path.dirname(path))',
              '  path = os.path.basename(path)',
              's.connect(path)',
              's.sendall(body)',
              's.shutdown(socket.SHUT_WR)',
              'chunks = []',
              'while True:',
              '  c = s.recv(65536)',
              '  if not c: break',
              '  chunks.append(c)',
              'print(b"".join(chunks).decode())',
            ].join('\n'),
            hostSockPath,
          ],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let err = '';
        child.stderr?.on('data', (c: Buffer) => {
          err += c.toString('utf8');
        });
        child.on('error', reject);
        child.on('close', code => resolve({ code, err }));
      });
      assert.equal(hostConnect.code, 0, hostConnect.err);
      for (let i = 0; i < 50 && hostInjected === 0; i++) {
        await sleep(50);
      }
      assert.equal(hostInjected, 1, 'same-UID host connect to Code Mode UDS must work');
      console.log('ok: same-UID host can connect to Code Mode UDS (expected for path UDS)');
      if (holdPid !== undefined) {
        try {
          process.kill(-holdPid, 'SIGKILL');
        } catch {
          try {
            process.kill(holdPid, 'SIGKILL');
          } catch {
            // already gone
          }
        }
      }
      await holdSession;
    },
  });
}

/**
 * Prove Unix env inheritance with no explicit env= copying:
 * 1) curated exec env → python child → python grandchild
 * 2) bash `cmd1 & cmd2` — both jobs are shell children and must see the marker
 */
async function smokeEnvInheritance(provider: LocalSandboxProvider, sandboxId: string): Promise<void> {
  const pyResult = await provider.exec({
    sandboxId,
    env: { [ENV_INHERIT_MARKER]: ENV_INHERIT_VALUE },
    command: [
      "python3 - <<'PY'",
      'import os, subprocess, sys',
      `marker = ${JSON.stringify(ENV_INHERIT_MARKER)}`,
      `expected = ${JSON.stringify(ENV_INHERIT_VALUE)}`,
      'child_val = os.environ.get(marker)',
      'if child_val != expected:',
      '  print(f"child-missing:{child_val!r}", file=sys.stderr)',
      '  raise SystemExit(1)',
      '# Grandchild: subprocess with default env inheritance (no env= override).',
      'grand = subprocess.run(',
      '  [sys.executable, "-c", f"import os; print(os.environ[{marker!r}])"],',
      '  check=True,',
      '  capture_output=True,',
      '  text=True,',
      ')',
      'got = grand.stdout.strip()',
      'if got != expected:',
      '  print(f"grandchild-missing:{got!r}", file=sys.stderr)',
      '  raise SystemExit(1)',
      'print("env-inherit-ok", expected)',
      'PY',
    ].join('\n'),
  });
  assert.equal(pyResult.success, true, JSON.stringify(pyResult));
  if (!pyResult.success) throw new Error('unreachable');
  assert.equal(pyResult.response.exitCode, 0, pyResult.response.result);
  assert.match(pyResult.response.result, new RegExp(`env-inherit-ok ${ENV_INHERIT_VALUE}`));
  console.log('ok: env auto-inherits parent → child → grandchild (no extra code)');

  // Background job + foreground job are both subprocesses of the exec shell.
  const marker = ENV_INHERIT_MARKER;
  const expected = ENV_INHERIT_VALUE;
  const bashResult = await provider.exec({
    sandboxId,
    env: { [marker]: expected },
    command: [
      // sandbox-local file (mktemp may target a denied host TMPDIR)
      'bg_out="./.tfy-smoke-env-bg"',
      // command 1: background — writes marker value then exits
      `( printenv ${marker} > "$bg_out" ) &`,
      'bg_pid=$!',
      // command 2: foreground — must see the same env
      `fg_val="$(printenv ${marker})"`,
      'wait "$bg_pid"',
      'bg_val="$(cat "$bg_out")"',
      'rm -f "$bg_out"',
      `test "$fg_val" = ${JSON.stringify(expected)} || { echo "fg-missing:$fg_val" >&2; exit 1; }`,
      `test "$bg_val" = ${JSON.stringify(expected)} || { echo "bg-missing:$bg_val" >&2; exit 1; }`,
      `echo "env-bg-ok ${expected}"`,
    ].join('\n'),
  });
  assert.equal(bashResult.success, true, JSON.stringify(bashResult));
  if (!bashResult.success) throw new Error('unreachable');
  assert.equal(bashResult.response.exitCode, 0, bashResult.response.result);
  assert.match(bashResult.response.result, new RegExp(`env-bg-ok ${expected}`));
  console.log('ok: env auto-inherits to bash background + foreground jobs (cmd1 & cmd2)');
}

function runCapture(command: string, args: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout?.on('data', (c: Buffer) => {
      out += c.toString('utf8');
    });
    child.stderr?.on('data', (c: Buffer) => {
      out += c.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', code => resolve({ code, out }));
  });
}

function assertPeerSecretAbsent(label: string, sample: string): void {
  assert.ok(
    !sample.includes(ENV_PEER_VALUE),
    `${label} unexpectedly exposed peer env secret:\n${sample.slice(0, 2000)}`,
  );
}

function assertPeerSecretPresent(label: string, sample: string): void {
  assert.ok(
    sample.includes(ENV_PEER_VALUE),
    `${label} did not expose peer env secret (expected same-UID visibility):\n${sample.slice(0, 2000)}`,
  );
}

/**
 * Prove kernel UDS peer credentials on accept:
 * - Linux: SO_PEERCRED → peer pid/uid/gid
 * - macOS: LOCAL_PEERPID + getpeereid → peer pid/uid/gid
 * Identity comes from the kernel, not from client-supplied fields.
 */
async function smokeUdsPeerCredentials(): Promise<void> {
  const sockPath = join(tmpdir(), `cm-pc-${ulid().toLowerCase().slice(0, 10)}`);
  await unlink(sockPath).catch(() => undefined);

  const script = [
    'import ctypes, json, os, platform, socket, struct',
    `path = ${JSON.stringify(sockPath)}`,
    'srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)',
    'try:',
    '  try: os.unlink(path)',
    '  except FileNotFoundError: pass',
    '  srv.bind(path)',
    '  srv.listen(1)',
    '  child = os.fork()',
    '  if child == 0:',
    '    c = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)',
    '    c.connect(path)',
    '    c.sendall(b"hi")',
    '    try: c.recv(1)',
    '    except OSError: pass',
    '    c.close()',
    '    os._exit(0)',
    '  conn, _ = srv.accept()',
    '  _ = conn.recv(16)',
    '  if platform.system() == "Linux":',
    '    SO_PEERCRED = 17',
    "    raw = conn.getsockopt(socket.SOL_SOCKET, SO_PEERCRED, struct.calcsize('iii'))",
    "    peer_pid, peer_uid, peer_gid = struct.unpack('iii', raw)",
    '    method = "SO_PEERCRED"',
    '  else:',
    '    SOL_LOCAL, LOCAL_PEERPID = 0, 2',
    '    raw = conn.getsockopt(SOL_LOCAL, LOCAL_PEERPID, 4)',
    "    peer_pid = struct.unpack('I', raw)[0]",
    '    libc = ctypes.CDLL(None)',
    '    uid = ctypes.c_uint()',
    '    gid = ctypes.c_uint()',
    '    rc = libc.getpeereid(ctypes.c_int(conn.fileno()), ctypes.byref(uid), ctypes.byref(gid))',
    '    if rc != 0:',
    '      raise SystemExit(f"getpeereid failed rc={rc} errno={ctypes.get_errno()}")',
    '    peer_uid, peer_gid = uid.value, gid.value',
    '    method = "LOCAL_PEERPID+getpeereid"',
    '  conn.close()',
    '  os.waitpid(child, 0)',
    '  print(json.dumps({',
    '    "method": method,',
    '    "peer_pid": peer_pid,',
    '    "peer_uid": peer_uid,',
    '    "peer_gid": peer_gid,',
    '    "child_pid": child,',
    '    "self_uid": os.getuid(),',
    '    "self_gid": os.getgid(),',
    '  }))',
    'finally:',
    '  srv.close()',
    '  try: os.unlink(path)',
    '  except FileNotFoundError: pass',
  ].join('\n');

  try {
    const probe = await runCapture('python3', ['-c', script]);
    assert.equal(probe.code, 0, probe.out);
    const line = probe.out.trim().split(/\r?\n/).filter(Boolean).at(-1);
    assert.ok(line !== undefined && line.length > 0, `empty peercred probe output: ${probe.out}`);
    const parsed: unknown = JSON.parse(line);
    assert.ok(parsed !== null && typeof parsed === 'object');
    assert.ok('method' in parsed && typeof parsed.method === 'string');
    assert.ok('peer_pid' in parsed && typeof parsed.peer_pid === 'number');
    assert.ok('peer_uid' in parsed && typeof parsed.peer_uid === 'number');
    assert.ok('peer_gid' in parsed && typeof parsed.peer_gid === 'number');
    assert.ok('child_pid' in parsed && typeof parsed.child_pid === 'number');
    assert.ok('self_uid' in parsed && typeof parsed.self_uid === 'number');
    assert.ok('self_gid' in parsed && typeof parsed.self_gid === 'number');
    assert.equal(parsed.peer_pid, parsed.child_pid, 'peer pid must match connecting child');
    assert.equal(parsed.peer_uid, parsed.self_uid, 'peer uid must match listener uid (same-UID connect)');
    assert.equal(parsed.peer_gid, parsed.self_gid, 'peer gid must match listener gid (same-UID connect)');
    if (process.platform === 'linux') {
      assert.equal(parsed.method, 'SO_PEERCRED');
    } else {
      assert.equal(parsed.method, 'LOCAL_PEERPID+getpeereid');
    }
    console.log(
      `ok: proved UDS peer credentials via ${parsed.method} (pid=${String(parsed.peer_pid)} uid=${String(parsed.peer_uid)} gid=${String(parsed.peer_gid)})`,
    );
  } finally {
    await unlink(sockPath).catch(() => undefined);
  }
}

/**
 * Same-UID peer env visibility (host processes, not sandbox policy).
 * Proves the easy leak path on each OS — not that env is protected.
 * - Linux: `/proc/<pid>/environ` contains the peer secret
 * - macOS: `ps -E -p <pid>` contains the peer secret; plain `ps -o command=` does not
 */
async function smokeSameUidEnvironRead(): Promise<void> {
  const holder = spawn(
    'python3',
    ['-c', ['import os, time', 'print(os.getpid(), flush=True)', 'time.sleep(30)'].join('\n')],
    {
      env: {
        PATH: process.env['PATH'] ?? '/usr/bin:/bin',
        [ENV_PEER_MARKER]: ENV_PEER_VALUE,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let pidLine = '';
  holder.stdout?.on('data', (chunk: Buffer) => {
    pidLine += chunk.toString('utf8');
  });

  try {
    for (let i = 0; i < 50 && !/^\d+/m.test(pidLine); i++) {
      await sleep(50);
    }
    const peerPid = Number(pidLine.trim().split(/\s+/)[0]);
    assert.ok(Number.isInteger(peerPid) && peerPid > 0, `holder pid missing: ${pidLine}`);

    if (process.platform === 'linux') {
      const environ = await readFile(`/proc/${String(peerPid)}/environ`);
      const decoded = environ.toString('utf8').replaceAll('\0', '\n');
      assertPeerSecretPresent('/proc/<pid>/environ', decoded);
      console.log('ok: proved Linux same-UID env leak via /proc/<pid>/environ');
      return;
    }

    // Prove macOS same-UID env is easy to read via the common `ps -E` path.
    const psPlain = await runCapture('ps', ['-p', String(peerPid), '-ww', '-o', 'command=']);
    assert.equal(psPlain.code, 0, `ps -o command= failed: ${psPlain.out}`);
    assertPeerSecretAbsent('ps -o command=', psPlain.out);

    const psE = await runCapture('ps', ['-E', '-p', String(peerPid), '-ww']);
    assert.equal(psE.code, 0, `ps -E failed: ${psE.out}`);
    assertPeerSecretPresent('ps -E -p', psE.out);
    assert.match(psE.out, new RegExp(`${ENV_PEER_MARKER}=${ENV_PEER_VALUE}`));
    console.log('ok: proved macOS same-UID env leak via ps -E (plain ps hid it)');
  } finally {
    holder.kill('SIGKILL');
    await new Promise<void>(resolve => {
      holder.on('close', () => resolve());
      setTimeout(resolve, 1000);
    });
  }
}

/**
 * Same-UID access to another process's pipe / socketpair ends (host, not SRT).
 * - Linux pipe: `open(/proc/<pid>/fd/N)` duplicates the fd
 * - Linux socketpair: `open(/proc/...)` fails (ENXIO); `pidfd_getfd` steals it
 * - macOS: no `/proc/<pid>/fd` (ENOENT)
 */
async function smokeSameUidInheritedFdAccess(): Promise<void> {
  const PIPE_SECRET = 'pipe-secret-marker';
  const SOCK_SECRET = 'sock-secret-marker';
  const script = [
    'import ctypes, json, os, platform, socket, subprocess, sys',
    `PIPE_SECRET = ${JSON.stringify(PIPE_SECRET)}.encode()`,
    `SOCK_SECRET = ${JSON.stringify(SOCK_SECRET)}.encode()`,
    'holder = subprocess.Popen(',
    '  [sys.executable, "-c",',
    '   "import os, socket, time\\n"',
    '   "r, w = os.pipe()\\n"',
    '   "os.write(w, " + repr(PIPE_SECRET) + ")\\n"',
    '   "a, b = socket.socketpair()\\n"',
    '   "b.sendall(" + repr(SOCK_SECRET) + ")\\n"',
    '   "print(os.getpid(), r, a.fileno(), flush=True)\\n"',
    '   "time.sleep(60)\\n"],',
    '  stdout=subprocess.PIPE, text=True,',
    ')',
    'try:',
    '  line = holder.stdout.readline().strip()',
    '  parts = line.split()',
    '  if len(parts) != 3:',
    '    raise SystemExit(f"bad holder line: {line!r}")',
    '  pid, pipe_fd, sock_fd = map(int, parts)',
    '  if platform.system() != "Linux":',
    '    path = f"/proc/{pid}/fd/{pipe_fd}"',
    '    try:',
    '      open(path, "rb").close()',
    '      raise SystemExit(f"unexpected open ok: {path}")',
    '    except FileNotFoundError:',
    '      print(json.dumps({"platform": "darwin", "proc_fd": "ENOENT"}))',
    '      raise SystemExit(0)',
    '  pipe_path = f"/proc/{pid}/fd/{pipe_fd}"',
    '  with open(pipe_path, "rb", buffering=0) as f:',
    '    pipe_data = f.read(64)',
    '  if pipe_data != PIPE_SECRET:',
    '    raise SystemExit(f"pipe steal mismatch: {pipe_data!r}")',
    '  sock_path = f"/proc/{pid}/fd/{sock_fd}"',
    '  sock_open_err = None',
    '  try:',
    '    open(sock_path, "rb", buffering=0).close()',
    '    raise SystemExit("socketpair open(/proc) unexpectedly succeeded")',
    '  except OSError as e:',
    '    sock_open_err = e.errno',
    '  libc = ctypes.CDLL(None, use_errno=True)',
    '  libc.pidfd_open.argtypes = [ctypes.c_int, ctypes.c_uint]',
    '  libc.pidfd_open.restype = ctypes.c_int',
    '  libc.pidfd_getfd.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint]',
    '  libc.pidfd_getfd.restype = ctypes.c_int',
    '  pidfd = libc.pidfd_open(pid, 0)',
    '  if pidfd < 0:',
    '    raise SystemExit(f"pidfd_open failed errno={ctypes.get_errno()}")',
    '  stolen = libc.pidfd_getfd(pidfd, sock_fd, 0)',
    '  if stolen < 0:',
    '    raise SystemExit(f"pidfd_getfd failed errno={ctypes.get_errno()}")',
    '  sock_data = os.read(stolen, 64)',
    '  os.close(stolen)',
    '  os.close(pidfd)',
    '  if sock_data != SOCK_SECRET:',
    '    raise SystemExit(f"socketpair steal mismatch: {sock_data!r}")',
    '  print(json.dumps({',
    '    "platform": "linux",',
    '    "pipe_via": "open(/proc/pid/fd)",',
    '    "socketpair_open_errno": sock_open_err,',
    '    "socketpair_via": "pidfd_getfd",',
    '    "holder_pid": pid,',
    '  }))',
    'finally:',
    '  holder.kill()',
    '  try: holder.wait(timeout=2)',
    '  except Exception: pass',
  ].join('\n');

  const probe = await runCapture('python3', ['-c', script]);
  assert.equal(probe.code, 0, probe.out);
  const line = probe.out.trim().split(/\r?\n/).filter(Boolean).at(-1);
  assert.ok(line !== undefined && line.length > 0, `empty inherited-fd probe output: ${probe.out}`);
  const parsed: unknown = JSON.parse(line);
  assert.ok(parsed !== null && typeof parsed === 'object');
  assert.ok('platform' in parsed && typeof parsed.platform === 'string');
  if (process.platform === 'linux') {
    assert.equal(parsed.platform, 'linux');
    assert.ok('pipe_via' in parsed && parsed.pipe_via === 'open(/proc/pid/fd)');
    assert.ok('socketpair_via' in parsed && parsed.socketpair_via === 'pidfd_getfd');
    console.log(
      `ok: proved Linux same-UID fd steal (pipe via /proc/pid/fd; socketpair via pidfd_getfd) pid=${String(
        'holder_pid' in parsed ? parsed.holder_pid : '?',
      )}`,
    );
    return;
  }
  assert.equal(parsed.platform, 'darwin');
  assert.ok('proc_fd' in parsed && parsed.proc_fd === 'ENOENT');
  console.log('ok: macOS has no /proc/<pid>/fd same-UID steal path (ENOENT)');
}

/**
 * Exec timeout must SIGKILL the process group — not only the direct child —
 * so a forked `while True` grandchild dies too.
 */
async function smokeProcessGroupTimeout(params: {
  sandboxRootPath: string;
  shell: string;
  platform: 'darwin' | 'linux';
}): Promise<void> {
  const session = await runSupervisorSession({
    sandboxRootPath: params.sandboxRootPath,
    shell: params.shell,
    platform: params.platform,
    command: [
      "python3 - <<'PY'",
      'import os, time',
      'open("leader.pid","w").write(str(os.getpid()))',
      'child = os.fork()',
      'if child == 0:',
      '  while True:',
      '    time.sleep(1)',
      'open("grandchild.pid","w").write(str(child))',
      'time.sleep(3600)',
      'PY',
    ].join('\n'),
    timeoutMs: 1500,
  });
  assert.equal(session.timedOut, true, 'session should time out');
  const leaderPid = Number((await readFile(join(params.sandboxRootPath, 'leader.pid'), 'utf8')).trim());
  const grandchildPid = Number((await readFile(join(params.sandboxRootPath, 'grandchild.pid'), 'utf8')).trim());
  assert.ok(leaderPid > 0 && grandchildPid > 0);
  // Give the kernel a moment after SIGKILL.
  await sleep(200);
  assert.equal(pidAlive(leaderPid), false, `leader ${String(leaderPid)} still alive`);
  assert.equal(pidAlive(grandchildPid), false, `grandchild ${String(grandchildPid)} still alive`);
  console.log('ok: exec timeout kills process group (leader + while-True grandchild)');
}

async function assertExecFails(
  provider: LocalSandboxProvider,
  sandboxId: string,
  command: string,
  label: string,
  options?: {
    timeoutSeconds?: number;
    /** Reject these exits as "wrong reason" (e.g. 127 = command missing). */
    forbidExitCodes?: number[];
    /** Require output evidence of policy/IO denial, not just any failure. */
    outputMustMatch?: RegExp;
  },
): Promise<{ exitCode: number; result: string }> {
  const result = await provider.exec({
    sandboxId,
    command,
    ...(options?.timeoutSeconds === undefined ? {} : { timeoutSeconds: options.timeoutSeconds }),
  });
  assert.equal(result.success, true, `${label}: provider error ${JSON.stringify(result)}`);
  if (!result.success) throw new Error('unreachable');
  assert.notEqual(result.response.exitCode, 0, `${label}: expected non-zero exit\n${result.response.result}`);
  if (options?.forbidExitCodes?.includes(result.response.exitCode)) {
    assert.fail(`${label}: exit ${String(result.response.exitCode)} is not a policy denial\n${result.response.result}`);
  }
  if (options?.outputMustMatch !== undefined) {
    assert.match(
      result.response.result,
      options.outputMustMatch,
      `${label}: output lacked denial evidence\n${result.response.result}`,
    );
  }
  console.log(`ok: ${label}`);
  return { exitCode: result.response.exitCode, result: result.response.result };
}

/**
 * Host TCP listeners on loopback must be unreachable from the sandbox
 * (macOS Seatbelt deny, or Linux netns isolation).
 */
async function smokeLoopbackDenied(provider: LocalSandboxProvider, sandboxId: string): Promise<void> {
  const listen = async (host: string): Promise<{ port: number; close: () => Promise<void> }> => {
    const server = createServer(socket => {
      socket.end('loopback-open\n');
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, host, () => resolve());
    });
    const addr = server.address();
    if (addr === null || typeof addr === 'string') {
      throw new Error(`expected TCP address for ${host}`);
    }
    return {
      port: addr.port,
      close: () =>
        new Promise((resolve, reject) => {
          server.close(err => (err ? reject(err) : resolve()));
        }),
    };
  };

  const v4 = await listen('127.0.0.1');
  let v6: { port: number; close: () => Promise<void> } | undefined;
  try {
    v6 = await listen('::1');
  } catch {
    v6 = undefined;
  }

  try {
    await assertExecFails(
      provider,
      sandboxId,
      [
        "python3 - <<'PY'",
        'import socket, sys',
        `port = ${String(v4.port)}`,
        'try:',
        '  s = socket.create_connection(("127.0.0.1", port), timeout=2)',
        '  data = s.recv(64)',
        '  s.close()',
        '  print("loopback-v4-open", data)',
        '  raise SystemExit(0)',
        'except OSError as e:',
        '  print("loopback-v4-blocked", type(e).__name__, e)',
        '  raise SystemExit(2)',
        'PY',
      ].join('\n'),
      'host 127.0.0.1 listener unreachable from sandbox',
      { outputMustMatch: /loopback-v4-blocked/ },
    );

    if (v6 !== undefined) {
      const v6Port = v6.port;
      await assertExecFails(
        provider,
        sandboxId,
        [
          "python3 - <<'PY'",
          'import socket, sys',
          `port = ${String(v6Port)}`,
          'try:',
          '  s = socket.create_connection(("::1", port), timeout=2)',
          '  data = s.recv(64)',
          '  s.close()',
          '  print("loopback-v6-open", data)',
          '  raise SystemExit(0)',
          'except OSError as e:',
          '  print("loopback-v6-blocked", type(e).__name__, e)',
          '  raise SystemExit(2)',
          'PY',
        ].join('\n'),
        'host ::1 listener unreachable from sandbox',
        { outputMustMatch: /loopback-v6-blocked/ },
      );
    } else {
      console.log('ok: skip ::1 listener (host cannot bind)');
    }

    // Private / link-local: no controlled listener; still must not connect.
    await assertExecFails(
      provider,
      sandboxId,
      [
        "python3 - <<'PY'",
        'import socket, sys',
        'targets = [("10.255.255.1", 9), ("169.254.169.254", 80), ("192.168.255.1", 9)]',
        'opened = []',
        'for host, port in targets:',
        '  try:',
        '    s = socket.create_connection((host, port), timeout=1)',
        '    s.close()',
        '    opened.append(f"{host}:{port}")',
        '  except OSError as e:',
        '    print(f"private-blocked {host}:{port} {type(e).__name__}")',
        'if opened:',
        '  print("private-open", opened)',
        '  raise SystemExit(0)',
        'raise SystemExit(2)',
        'PY',
      ].join('\n'),
      'private/link-local TCP connect denied',
      { outputMustMatch: /private-blocked/ },
    );
  } finally {
    await v4.close().catch(() => undefined);
    if (v6 !== undefined) {
      await v6.close().catch(() => undefined);
    }
  }
}

/**
 * setsid/double-fork vs kill(-pgid):
 * - macOS: no PID ns — escape leaves the process group and survives killpg
 *   (known limitation; host must reap via the written host pid).
 * - Linux SRT: PID ns + die-with-parent — escape dies with the sandbox; in-ns
 *   pids are not host-visible, so we watch a heartbeat file instead of kill(pid).
 */
async function smokeSetsidEscapeSurvivesKillpg(params: {
  sandboxRootPath: string;
  shell: string;
  platform: 'darwin' | 'linux';
}): Promise<void> {
  const heartbeatPath = join(params.sandboxRootPath, 'escaped.heartbeat');
  // Escaped child drops stdio so host pipes can close after killpg.
  // Cap wait: SRT wrapper teardown can still lag; do not hang the suite.
  const sessionPromise = runSupervisorSession({
    sandboxRootPath: params.sandboxRootPath,
    shell: params.shell,
    platform: params.platform,
    command: [
      "python3 - <<'PY'",
      'import os, time',
      'open("leader.pid", "w", encoding="utf-8").write(str(os.getpid()))',
      'child = os.fork()',
      'if child == 0:',
      '  os.setsid()',
      '  grand = os.fork()',
      '  if grand > 0:',
      '    os._exit(0)',
      '  dn = os.open("/dev/null", os.O_RDWR)',
      '  os.dup2(dn, 0); os.dup2(dn, 1); os.dup2(dn, 2)',
      '  if dn > 2: os.close(dn)',
      '  # Close Code Mode fds if present so host is not held open.',
      '  for fd in (3, 4):',
      '    try: os.close(fd)',
      '    except OSError: pass',
      '  open("escaped.pid", "w", encoding="utf-8").write(str(os.getpid()))',
      '  n = 0',
      '  while True:',
      '    n += 1',
      '    open("escaped.heartbeat", "w", encoding="utf-8").write(str(n))',
      '    time.sleep(0.2)',
      'os.waitpid(child, 0)',
      'time.sleep(3600)',
      'PY',
    ].join('\n'),
    timeoutMs: 1500,
  });

  let escapedRaw = '';
  for (let i = 0; i < 60 && !/^\d+$/.test(escapedRaw); i++) {
    try {
      escapedRaw = (await readFile(join(params.sandboxRootPath, 'escaped.pid'), 'utf8')).trim();
    } catch {
      // not yet
    }
    await sleep(50);
  }
  assert.match(escapedRaw, /^\d+$/, 'escaped.pid missing — setsid child never started');
  const escapedPid = Number(escapedRaw);

  let heartbeatBeforeSession = '';
  for (let i = 0; i < 40 && heartbeatBeforeSession === ''; i++) {
    try {
      heartbeatBeforeSession = (await readFile(heartbeatPath, 'utf8')).trim();
    } catch {
      // not yet
    }
    await sleep(50);
  }
  assert.match(heartbeatBeforeSession, /^\d+$/, 'escaped.heartbeat missing — escape never ran');

  const sessionOrTimeout = await Promise.race([
    sessionPromise.then(session => ({ kind: 'session' as const, session })),
    sleep(5000).then(() => ({ kind: 'hung' as const })),
  ]);
  if (sessionOrTimeout.kind === 'hung') {
    // Last resort: session did not settle after killpg (SRT wrapper leak).
    if (process.platform === 'darwin') {
      try {
        process.kill(escapedPid, 'SIGKILL');
      } catch {
        // ignore
      }
    }
    assert.fail('runSupervisorSession hung after timeout — killpg did not finish teardown');
  }
  const { session } = sessionOrTimeout;
  assert.equal(session.timedOut, true, 'session should time out');
  await sleep(500);

  const hb1 = (await readFile(heartbeatPath, 'utf8')).trim();
  await sleep(600);
  const hb2 = (await readFile(heartbeatPath, 'utf8')).trim();

  if (process.platform === 'linux') {
    // In-ns pid is not the host pid; survival is judged by heartbeat freeze.
    assert.equal(hb2, hb1, 'Linux: setsid escape should die with PID ns / die-with-parent (heartbeat still advancing)');
    console.log('ok: setsid escape dies with Linux PID ns / die-with-parent');
    return;
  }

  // macOS: host-visible pid; kill(-pgid) misses the new session.
  assert.notEqual(hb2, hb1, 'macOS: expected setsid escape to keep writing heartbeat after kill(-pgid)');
  assert.equal(pidAlive(escapedPid), true, `expected setsid escape pid ${String(escapedPid)} to survive kill(-pgid)`);
  try {
    process.kill(escapedPid, 'SIGKILL');
  } catch {
    // already gone
  }
  console.log('ok: setsid/double-fork escape survives killpg on macOS (known limitation)');
}

/**
 * Match hostRun AF_UNIX policy (Linux allowAllUnixSockets; macOS allowUnixSockets=[sandboxRoot]),
 * then prove pathname connect is still gated by allowRead (FS) / seatbelt, not by the Unix-socket toggle alone.
 * On Linux, also prove /proc/net/unix is the sandbox netns table (host abstract absent).
 */
async function smokeUnixSocketFsGate(): Promise<void> {
  // Keep paths short: macOS sun_path is ~104 bytes (long sandbox path UUIDs → EINVAL).
  const id = randomUUID().replaceAll('-', '').slice(0, 8);
  const sandboxRootPath = join(SANDBOXES, `u${id}`);
  const insideSock = join(sandboxRootPath, 'c.sock');
  const outsideSock = join(SANDBOXES, `o${id}.sock`);
  // Host-owned fake Docker socket (path shape only) — must not be in allowRead / allowUnixSockets.
  const emulatedDockerRoot = join(SANDBOXES, `v${id}`);
  const emulatedDockerSock = join(emulatedDockerRoot, 'run', 'docker.sock');
  const hostAbstractName = `\0tfy-abs-${id}`;
  const hostAbstractProcMarker = `@tfy-abs-${id}`;

  const platform = process.platform === 'darwin' ? 'darwin' : 'linux';
  const allowRead = [sandboxRootPath, ...platformAllowRead(platform)];

  const denyWrite = getDefaultWritePaths().filter(path => !path.startsWith('/dev/'));

  const listenUds = async (path: string): Promise<{ close: () => Promise<void> }> => {
    await unlink(path).catch(() => undefined);
    const server = createServer(socket => {
      socket.end('uds-ok\n');
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(path, () => resolve());
    });
    return {
      close: async () => {
        await new Promise<void>(resolve => {
          server.close(() => resolve());
        });
        await unlink(path).catch(() => undefined);
      },
    };
  };

  const runSandboxed = async (command: string): Promise<{ code: number | null; out: string }> => {
    const wrap = await SandboxManager.wrapWithSandboxArgv(
      command,
      '/bin/bash',
      {
        filesystem: {
          allowWrite: [sandboxRootPath],
          denyWrite,
          denyRead: ['/'],
          allowRead,
        },
        network: { allowedDomains: [], deniedDomains: [] },
      },
      undefined,
      sandboxRootPath,
      { commandId: randomUUID(), commandText: command },
    );
    const [argv0, ...argvRest] = wrap.argv;
    if (argv0 === undefined) throw new Error('empty argv');
    return await new Promise((resolve, reject) => {
      const child = spawn(argv0, argvRest, {
        cwd: sandboxRootPath,
        env: {
          HOME: join(sandboxRootPath, '.home'),
          TMPDIR: join(sandboxRootPath, '.tmp'),
          PATH: commandPath(platform),
          ...wrap.env,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout?.on('data', (c: Buffer) => {
        out += c.toString('utf8');
      });
      child.stderr?.on('data', (c: Buffer) => {
        out += c.toString('utf8');
      });
      child.on('error', reject);
      child.on('close', code => resolve({ code, out }));
    });
  };

  const connectScript = (sockPath: string): string =>
    [
      "python3 - <<'PY'",
      'import socket, sys',
      `path = ${JSON.stringify(sockPath)}`,
      'try:',
      '  s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)',
      '  s.settimeout(2)',
      '  s.connect(path)',
      '  data = s.recv(64)',
      '  s.close()',
      '  print("CONNECT_OK", data)',
      '  sys.exit(0)',
      'except OSError as e:',
      '  print("CONNECT_FAIL", type(e).__name__, e.errno, e)',
      '  sys.exit(2)',
      'PY',
    ].join('\n');

  /** Prove path is not discoverable/readable and connect also fails (no discover-then-connect shortcut). */
  const discoverAndConnectDeniedScript = (sockPath: string): string =>
    [
      "python3 - <<'PY'",
      'import os, socket, stat, sys',
      `path = ${JSON.stringify(sockPath)}`,
      'parent = os.path.dirname(path)',
      'base = os.path.basename(path)',
      'discover_ok = False',
      'try:',
      '  st = os.stat(path)',
      '  print("STAT_OK", int(st.st_mode))',
      '  if stat.S_ISSOCK(st.st_mode):',
      '    discover_ok = True',
      '    print("DISCOVER_STAT_SOCK")',
      'except OSError as e:',
      '  print("STAT_FAIL", type(e).__name__, getattr(e, "errno", None))',
      'try:',
      '  if os.path.exists(path):',
      '    discover_ok = True',
      '    print("DISCOVER_EXISTS")',
      '  else:',
      '    print("EXISTS_FALSE")',
      'except OSError as e:',
      '  print("EXISTS_FAIL", type(e).__name__, getattr(e, "errno", None))',
      'try:',
      '  names = os.listdir(parent)',
      '  print("LISTDIR_OK", names)',
      '  if base in names:',
      '    discover_ok = True',
      '    print("DISCOVER_LISTDIR")',
      'except OSError as e:',
      '  print("LISTDIR_FAIL", type(e).__name__, getattr(e, "errno", None))',
      'if discover_ok:',
      '  print("DISCOVER_REACHABLE")',
      '  sys.exit(1)',
      'print("DISCOVER_DENIED")',
      'try:',
      '  s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)',
      '  s.settimeout(2)',
      '  s.connect(path)',
      '  s.close()',
      '  print("CONNECT_OK")',
      '  sys.exit(2)',
      'except OSError as e:',
      '  print("CONNECT_FAIL", type(e).__name__, getattr(e, "errno", None))',
      '  sys.exit(0)',
      'PY',
    ].join('\n');

  await mkdir(join(sandboxRootPath, '.tmp'), { recursive: true, mode: 0o700 });
  await mkdir(join(sandboxRootPath, '.home'), { recursive: true, mode: 0o700 });
  await mkdir(dirname(emulatedDockerSock), { recursive: true, mode: 0o700 });
  const inside = await listenUds(insideSock);
  const outside = await listenUds(outsideSock);
  const emulatedDocker = await listenUds(emulatedDockerSock);

  // Match hostRun: Linux allowAll + FS gate; macOS allowUnixSockets=[sandboxRootPath] (FS does not gate UDS).
  const network =
    process.platform === 'darwin'
      ? {
          allowedDomains: [] as string[],
          deniedDomains: [] as string[],
          allowAllUnixSockets: false,
          allowUnixSockets: [sandboxRootPath],
        }
      : {
          allowedDomains: [] as string[],
          deniedDomains: [] as string[],
          allowAllUnixSockets: true,
        };

  await SandboxManager.initialize({
    network,
    filesystem: {
      allowWrite: [],
      denyWrite,
      denyRead: ['/'],
      allowRead,
    },
  });

  let hostAbstract: { close: () => Promise<void> } | undefined;
  try {
    const ok = await runSandboxed(connectScript(insideSock));
    assert.equal(ok.code, 0, `inside sock should connect:\n${ok.out}`);
    assert.match(ok.out, /CONNECT_OK/);
    console.log('ok: sandbox can connect to sandbox UDS (allowRead)');

    await access(outsideSock);
    const denied = await runSandboxed(connectScript(outsideSock));
    assert.notEqual(denied.code, 0, `outside sock must not connect:\n${denied.out}`);
    assert.match(denied.out, /CONNECT_FAIL/);
    console.log(
      process.platform === 'linux'
        ? 'ok: FS-denied path UDS connect fails under allowAllUnixSockets'
        : 'ok: path outside allowUnixSockets=[sandboxRootPath] connect fails (macOS seatbelt)',
    );

    // Prove the emulated docker listener is live on the host, then denied from the sandbox.
    const hostDockerConnect = await new Promise<{ code: number | null; out: string }>((resolve, reject) => {
      const child = spawn(
        'python3',
        [
          '-c',
          [
            'import socket, sys',
            'path = sys.argv[1]',
            's = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)',
            's.settimeout(2)',
            's.connect(path)',
            'print(s.recv(64))',
            's.close()',
          ].join('\n'),
          emulatedDockerSock,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let out = '';
      child.stdout?.on('data', (c: Buffer) => {
        out += c.toString('utf8');
      });
      child.stderr?.on('data', (c: Buffer) => {
        out += c.toString('utf8');
      });
      child.on('error', reject);
      child.on('close', code => resolve({ code, out }));
    });
    assert.equal(hostDockerConnect.code, 0, `host must reach emulated docker.sock:\n${hostDockerConnect.out}`);
    assert.match(hostDockerConnect.out, /uds-ok/);
    console.log('ok: host can connect to emulated docker.sock');

    const dockerDenied = await runSandboxed(connectScript(emulatedDockerSock));
    assert.notEqual(dockerDenied.code, 0, `sandbox must not connect to emulated docker.sock:\n${dockerDenied.out}`);
    assert.match(dockerDenied.out, /CONNECT_FAIL/);
    console.log('ok: sandbox cannot connect to host-created emulated docker.sock');

    const inventory = await runSandboxed(
      [
        "python3 - <<'PY'",
        'import os, socket, stat, sys',
        'roots = ["/dev", "/etc", "/usr"]',
        'found = []',
        'for root in roots:',
        '  if not os.path.isdir(root):',
        '    continue',
        '  for dirpath, dirnames, filenames in os.walk(root):',
        '    if dirpath.count(os.sep) - root.count(os.sep) > 3:',
        '      dirnames[:] = []',
        '      continue',
        '    for name in filenames:',
        '      p = os.path.join(dirpath, name)',
        '      try:',
        '        st = os.stat(p)',
        '      except OSError:',
        '        continue',
        '      if stat.S_ISSOCK(st.st_mode):',
        '        found.append(p)',
        'print("FOUND", len(found))',
        'for p in found[:20]:',
        '  print("SOCK", p)',
        'bad = 0',
        'for p in found:',
        '  try:',
        '    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)',
        '    s.settimeout(0.3)',
        '    s.connect(p)',
        '    s.close()',
        '    print("CONNECTED", p)',
        '    bad += 1',
        '  except OSError as e:',
        '    print("BLOCKED_OR_USELESS", p, type(e).__name__)',
        'sys.exit(1 if bad else 0)',
        'PY',
      ].join('\n'),
    );
    const invLines = inventory.out.trim().split('\n').slice(0, 40);
    console.log(invLines.join('\n'));
    assert.equal(inventory.code, 0, `sandbox connected to a socket under /dev|/etc|/usr:\n${inventory.out}`);
    console.log('ok: no successful connect to sockets under /dev|/etc|/usr (if any visible)');

    if (process.platform === 'linux') {
      // Host abstract listener (Linux-only). Sandbox has --unshare-net → own /proc/net/unix.
      const absServer = createServer(socket => {
        socket.end('abs-ok\n');
      });
      await new Promise<void>((resolve, reject) => {
        absServer.once('error', reject);
        absServer.listen(hostAbstractName, () => resolve());
      });
      hostAbstract = {
        close: async () => {
          await new Promise<void>(resolve => {
            absServer.close(() => resolve());
          });
        },
      };

      const hostProc = await readFile('/proc/net/unix', 'utf8');
      assert.match(
        hostProc,
        new RegExp(hostAbstractProcMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        'host /proc/net/unix must list the abstract listener',
      );

      const procUnix = await runSandboxed(
        [
          "python3 - <<'PY'",
          'import sys',
          `marker = ${JSON.stringify(hostAbstractProcMarker)}`,
          'path = "/proc/net/unix"',
          'try:',
          '  text = open(path, "r", encoding="utf-8", errors="replace").read()',
          'except OSError as e:',
          '  print("PROC_NET_UNIX_UNREADABLE", getattr(e, "errno", None), e)',
          '  sys.exit(2)',
          'print("PROC_NET_UNIX_READABLE", "bytes", len(text), "lines", len(text.splitlines()))',
          'if marker in text:',
          '  print("HOST_ABSTRACT_VISIBLE", marker)',
          '  sys.exit(3)',
          'print("HOST_ABSTRACT_ABSENT", marker)',
          // Also prove connect to host abstract fails (different netns).
          'import socket',
          `abs_name = ${JSON.stringify(hostAbstractName)}`,
          'try:',
          '  s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)',
          '  s.settimeout(1)',
          '  s.connect(abs_name)',
          '  s.close()',
          '  print("HOST_ABSTRACT_CONNECT_OK")',
          '  sys.exit(4)',
          'except OSError as e:',
          '  print("HOST_ABSTRACT_CONNECT_FAIL", type(e).__name__, getattr(e, "errno", None))',
          'sys.exit(0)',
          'PY',
        ].join('\n'),
      );
      assert.equal(procUnix.code, 0, procUnix.out);
      assert.match(procUnix.out, /PROC_NET_UNIX_READABLE/);
      assert.match(procUnix.out, /HOST_ABSTRACT_ABSENT/);
      assert.match(procUnix.out, /HOST_ABSTRACT_CONNECT_FAIL/);
      console.log('ok: /proc/net/unix is sandbox netns (host abstract not listed / not connectable)');
      console.log(procUnix.out.trim().split('\n').filter(Boolean).join(' | '));
    } else {
      console.log('ok: skip Linux abstract /proc/net/unix netns probe (not Linux)');
    }

    console.log(
      process.platform === 'linux'
        ? 'ok: Linux allowAllUnixSockets + FS allowRead gates pathname UDS'
        : 'ok: macOS allowUnixSockets=[sandboxRootPath] gates pathname UDS (not allowRead)',
    );
  } finally {
    await hostAbstract?.close().catch(() => undefined);
    await emulatedDocker.close().catch(() => undefined);
    await inside.close().catch(() => undefined);
    await outside.close().catch(() => undefined);
    await SandboxManager.reset().catch(() => undefined);
    await removeSandbox(sandboxRootPath).catch(() => undefined);
    await rm(emulatedDockerRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function smokeHostPackageManagerDenied(provider: LocalSandboxProvider, sandboxId: string): Promise<void> {
  if (process.platform === 'darwin') {
    await assertExecFails(
      provider,
      sandboxId,
      "printf 'poc\\n' > /opt/homebrew/Cellar/.tfy-poc-write || exit 2",
      'host Homebrew Cellar write denied',
      { outputMustMatch: /Permission|Read-only|Operation not permitted|denied|No such|cannot/i },
    );
    // Prefer reinstall so an already-installed keg cannot no-op to exit 0.
    // Brew also needs host API/cache reads + network; both are denied under SRT.
    await assertExecFails(
      provider,
      sandboxId,
      [
        'set +e',
        'command -v brew >/dev/null 2>&1 || { echo "brew-missing" >&2; exit 127; }',
        'export HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_ANALYTICS=1 HOMEBREW_NO_ENV_HINTS=1',
        'brew install lima',
        'install_rc=$?',
        'if [ "$install_rc" -eq 0 ]; then',
        '  brew reinstall lima',
        '  install_rc=$?',
        'fi',
        'exit "$install_rc"',
      ].join('\n'),
      'brew install/reinstall lima denied',
      {
        // Brew may stall on network/API; fail-closed quickly under SRT.
        timeoutSeconds: 20,
        forbidExitCodes: [127],
        outputMustMatch: /not writable|Permission|Operation not permitted|Read-only|denied|Failed to download|Error:/i,
      },
    );
    return;
  }

  await assertExecFails(
    provider,
    sandboxId,
    "printf 'poc\\n' > /usr/bin/.tfy-poc-write || exit 2",
    'host /usr/bin write denied',
    { outputMustMatch: /Permission|Read-only|Operation not permitted|denied|No such file|cannot/i },
  );
  await assertExecFails(
    provider,
    sandboxId,
    [
      'set +e',
      'command -v apt-get >/dev/null 2>&1 || { echo "apt-get-missing" >&2; exit 127; }',
      'export DEBIAN_FRONTEND=noninteractive',
      'apt-get install -y cowsay',
      'exit $?',
    ].join('\n'),
    'apt-get install denied',
    {
      timeoutSeconds: 20,
      forbidExitCodes: [127],
      outputMustMatch: /Permission|Read-only|Operation not permitted|denied|not open|Could not|E:/i,
    },
  );
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    console.error('smoke: skipping (darwin/linux only)');
    process.exit(0);
  }

  process.env[ENV_LEAK_MARKER] = ENV_LEAK_VALUE;

  const support = await LocalSandboxProvider.isSupported();
  assert.equal(support.supported, true, support.supported ? '' : support.reason);
  console.log('ok: LocalSandboxProvider.isSupported');

  const sandboxRootPathParent = await mkdtemp(join(tmpdir(), 'tfy-local-sandbox-smoke-'));
  const codeModeSocketParentPath = join(tmpdir(), 'cm');
  await mkdir(codeModeSocketParentPath, { recursive: true, mode: 0o700 });
  if (!support.supported) {
    throw new Error(support.reason);
  }
  const provider = new LocalSandboxProvider({
    sandboxRootPathParent,
    codeModeSocketParentPath,
    support,
    logger: createLogger({ silent: true }),
  });
  const instructions = provider.getAdditionalInstructions();
  assert.match(instructions, /sandbox shell: \S+/);
  assert.match(instructions, /virtualenv lives at \.venv/);
  console.log('ok: getAdditionalInstructions names shell and python');
  await prepareHostProbeFiles();
  let codeModeSandboxRootPath: string | undefined;
  try {
    const { sandboxId } = await provider.createSandbox();
    console.log('sandboxId', sandboxId);

    const printf = await provider.exec({
      sandboxId,
      command: "printf 'poc-ok\\n'",
    });
    assert.equal(printf.success, true);
    if (!printf.success) throw new Error('unreachable');
    assert.equal(printf.response.exitCode, 0);
    assert.equal(printf.response.result, 'poc-ok\n');
    console.log('ok: provider exec printf');

    if (support.platform === 'darwin') {
      const opensslCnf = await provider.exec({
        sandboxId,
        command: "python3 -c \"p=open('/etc/ssl/openssl.cnf'); p.read(); p.close(); print('openssl-cnf-ok')\"",
      });
      assert.equal(opensslCnf.success, true);
      if (!opensslCnf.success) throw new Error('unreachable');
      assert.equal(opensslCnf.response.exitCode, 0, opensslCnf.response.result);
      assert.match(opensslCnf.response.result, /openssl-cnf-ok/);
      console.log('ok: darwin can read /etc/ssl/openssl.cnf (LibreSSL symlink spelling)');
    }

    await smokeCodeModeSocketParentAllow({
      sandboxRootPath: sandboxId,
      codeModeSocketParentPath,
      shell: support.shell,
      platform: support.platform,
    });

    const write = await provider.exec({
      sandboxId,
      command: "printf 'sandbox-ok\\n' > note.txt && cat note.txt",
    });
    assert.equal(write.success, true);
    if (!write.success) throw new Error('unreachable');
    assert.equal(write.response.exitCode, 0);
    assert.equal(write.response.result, 'sandbox-ok\n');
    console.log('ok: sandbox-local write/read');

    await provider.uploadFile({
      sandboxId,
      remotePath: 'uploads/hello.txt',
      content: Buffer.from('upload-ok\n'),
    });
    const downloaded = await provider.downloadFile({
      sandboxId,
      path: 'uploads/hello.txt',
    });
    assert.equal(downloaded.toString('utf8'), 'upload-ok\n');
    const catUpload = await provider.exec({
      sandboxId,
      command: 'cat uploads/hello.txt',
    });
    assert.equal(catUpload.success, true);
    if (!catUpload.success) throw new Error('unreachable');
    assert.equal(catUpload.response.result, 'upload-ok\n');
    console.log('ok: upload/download');

    await assertExecFails(
      provider,
      sandboxId,
      "printf 'leak\\n' > /tmp/claude/poc-should-fail.txt || exit 2",
      'SRT default /tmp/claude write denied',
      { outputMustMatch: /Permission|Read-only|Operation not permitted|denied|No such|cannot/i },
    );

    const before = await readFile(DELETE_TARGET, 'utf8');
    assert.equal(before, 'delete-me\n');
    await assertExecFails(
      provider,
      sandboxId,
      `python3 -c 'import os; os.unlink(${JSON.stringify(DELETE_TARGET)})'`,
      'SRT default /tmp/claude delete denied',
    );
    await access(DELETE_TARGET);

    const denyRead = await provider.exec({
      sandboxId,
      command: `cat ${JSON.stringify(DENY_READ_SECRET)}`,
    });
    assert.equal(denyRead.success, true);
    if (!denyRead.success) throw new Error('unreachable');
    assert.notEqual(denyRead.response.exitCode, 0);
    assert.ok(!denyRead.response.result.includes('host-secret-should-not-leak'));
    console.log('ok: host secret outside sandbox blocked');

    assert.ok(HOST_HOME && HOST_HOME.length > 0);
    await assertExecFails(provider, sandboxId, `ls ${JSON.stringify(HOST_HOME)}`, 'host home listing denied');

    await smokeHostPackageManagerDenied(provider, sandboxId);

    // System pip install (no --user/--target): must fail closed without network.
    // Local trivial package so the failure is install/prefix write, not PyPI fetch.
    await assertExecFails(
      provider,
      sandboxId,
      [
        'set -euo pipefail',
        // ensurepip covers guests that only have python3 (no python3-pip package).
        'python3 -m pip --version >/dev/null 2>&1 || python3 -m ensurepip --upgrade >/dev/null 2>&1 || true',
        'python3 -m pip --version >/dev/null || { echo "pip-missing" >&2; exit 127; }',
        'mkdir -p tfy_poc_pip_pkg/tfy_poc_pip',
        "cat > tfy_poc_pip_pkg/setup.py <<'EOF'",
        'from setuptools import setup',
        'setup(name="tfy-poc-pip", version="0.0.1", packages=["tfy_poc_pip"])',
        'EOF',
        'touch tfy_poc_pip_pkg/tfy_poc_pip/__init__.py',
        'python3 -m pip install --no-input --no-deps --no-build-isolation ./tfy_poc_pip_pkg',
      ].join('\n'),
      'system pip install denied',
      {
        forbidExitCodes: [127],
        outputMustMatch: /Permission|Read-only|Operation not permitted|denied|ERROR:|Could not|No module|error/i,
      },
    );

    await smokeLoopbackDenied(provider, sandboxId);

    await assertExecFails(
      provider,
      sandboxId,
      'python3 -c \'import socket,sys\ntry:\n socket.create_connection(("1.1.1.1",443),timeout=2)\n print("network-open"); sys.exit(0)\nexcept OSError as e:\n print("network-blocked:%s"%e); sys.exit(2)\'',
      'egress to 1.1.1.1:443 denied',
      { outputMustMatch: /network-blocked:/ },
    );
    await assertExecFails(
      provider,
      sandboxId,
      'python3 -c \'import socket,sys\ntry:\n socket.getaddrinfo("example.com",443)\n print("dns-open"); sys.exit(0)\nexcept OSError as e:\n print("dns-blocked:%s"%e); sys.exit(2)\'',
      'DNS for example.com denied',
      { outputMustMatch: /dns-blocked:/ },
    );

    const envLeak = await provider.exec({
      sandboxId,
      command: `printenv ${ENV_LEAK_MARKER} || true`,
    });
    assert.equal(envLeak.success, true);
    if (!envLeak.success) throw new Error('unreachable');
    assert.ok(!envLeak.response.result.includes(ENV_LEAK_VALUE));
    console.log('ok: host env secret not visible in sandbox');

    await smokeEnvInheritance(provider, sandboxId);
    await smokeUdsPeerCredentials();
    await smokeSameUidEnvironRead();
    await smokeSameUidInheritedFdAccess();

    await assertExecFails(
      provider,
      sandboxId,
      `cat ${JSON.stringify('../.poc-deny-read-secret')}`,
      'path escape via .. denied',
    );

    await assertExecFails(
      provider,
      sandboxId,
      ['set -e', `ln -sf ${JSON.stringify(DENY_READ_SECRET)} escape-link`, 'cat escape-link'].join('\n'),
      'symlink escape read denied',
    );

    // Plain sandboxed open() following a sandbox→host symlink must not leak the host file.
    await assertExecFails(
      provider,
      sandboxId,
      [
        `ln -sf ${JSON.stringify(DENY_READ_SECRET)} escape-open`,
        "python3 - <<'PY'",
        'import sys',
        'try:',
        '  data = open("escape-open", "rb").read()',
        '  sys.stdout.write(data.decode("utf-8", "replace"))',
        '  raise SystemExit(0)',
        'except OSError as e:',
        '  print(f"open-blocked {type(e).__name__}", file=sys.stderr)',
        '  raise SystemExit(2)',
        'PY',
      ].join('\n'),
      'sandbox open() symlink follow read denied',
      {
        outputMustMatch: /open-blocked|Permission|Operation not permitted|denied|No such file/i,
      },
    );
    assert.equal(await readFile(DENY_READ_SECRET, 'utf8'), SECRET_CONTENTS);

    // Symlink follow write: host target must stay intact regardless of sandbox exit code.
    const writeFollow = await provider.exec({
      sandboxId,
      command: [
        `ln -sf ${JSON.stringify(DENY_READ_SECRET)} escape-open-w`,
        "python3 - <<'PY'",
        'import sys',
        'try:',
        '  open("escape-open-w", "wb").write(b"pwned-exec\\n")',
        '  print("open-write-ok")',
        '  raise SystemExit(0)',
        'except OSError as e:',
        '  print(f"open-write-blocked {type(e).__name__}", file=sys.stderr)',
        '  raise SystemExit(2)',
        'PY',
      ].join('\n'),
    });
    assert.equal(writeFollow.success, true, JSON.stringify(writeFollow));
    if (!writeFollow.success) throw new Error('unreachable');
    assert.equal(
      await readFile(DENY_READ_SECRET, 'utf8'),
      SECRET_CONTENTS,
      'sandbox symlink follow write must not mutate host secret',
    );
    if (writeFollow.response.exitCode !== 0) {
      assert.match(writeFollow.response.result, /open-write-blocked|Permission|Operation not permitted|denied/i);
    }
    console.log('ok: sandbox open() symlink follow write left host secret intact');

    // Provider upload/download: SRT must stop symlink follow from leaking or mutating the host.
    const mkDlLink = await provider.exec({
      sandboxId,
      command: `ln -sf ${JSON.stringify(DENY_READ_SECRET)} api-escape-dl && test -L api-escape-dl`,
    });
    assert.equal(mkDlLink.success, true);
    if (!mkDlLink.success) throw new Error('unreachable');
    assert.equal(mkDlLink.response.exitCode, 0, mkDlLink.response.result);
    let downloadLeaked = false;
    try {
      const leaked = await provider.downloadFile({ sandboxId, path: 'api-escape-dl' });
      downloadLeaked = leaked.toString('utf8').includes('host-secret-should-not-leak');
    } catch {
      // deny / throw is fine; host check below still runs
    }
    assert.equal(downloadLeaked, false, 'downloadFile must not return host secret via symlink');
    assert.equal(await readFile(DENY_READ_SECRET, 'utf8'), SECRET_CONTENTS);
    console.log('ok: downloadFile does not leak host via symlink (SRT)');

    const mkUlLink = await provider.exec({
      sandboxId,
      command: `ln -sf ${JSON.stringify(DENY_READ_SECRET)} api-escape-ul && test -L api-escape-ul`,
    });
    assert.equal(mkUlLink.success, true);
    if (!mkUlLink.success) throw new Error('unreachable');
    assert.equal(mkUlLink.response.exitCode, 0, mkUlLink.response.result);
    try {
      await provider.uploadFile({
        sandboxId,
        remotePath: 'api-escape-ul',
        content: Buffer.from('pwned-via-host-api\n'),
      });
    } catch {
      // deny / throw is fine; host check below is the gate
    }
    assert.equal(
      await readFile(DENY_READ_SECRET, 'utf8'),
      SECRET_CONTENTS,
      'uploadFile must not mutate host via symlink',
    );
    console.log('ok: uploadFile does not mutate host via symlink (SRT)');

    const { sandboxId: otherId } = await provider.createSandbox();
    await provider.uploadFile({
      sandboxId,
      remotePath: 'cross-secret.txt',
      content: Buffer.from('cross-sandbox-secret\n'),
    });
    const otherRead = await provider.exec({
      sandboxId: otherId,
      command: `cat ${JSON.stringify(join(sandboxId, 'cross-secret.txt'))}`,
    });
    assert.equal(otherRead.success, true);
    if (!otherRead.success) throw new Error('unreachable');
    assert.notEqual(otherRead.response.exitCode, 0);
    assert.ok(!otherRead.response.result.includes('cross-sandbox-secret'));
    console.log('ok: cross-sandbox absolute path read denied');

    const otherWrite = await provider.exec({
      sandboxId: otherId,
      command: `printf 'cross-write\\n' > ${JSON.stringify(join(sandboxId, 'cross-write.txt'))}`,
    });
    assert.equal(otherWrite.success, true);
    if (!otherWrite.success) throw new Error('unreachable');
    assert.notEqual(otherWrite.response.exitCode, 0);
    await assert.rejects(async () => readFile(join(sandboxId, 'cross-write.txt')));
    console.log('ok: cross-sandbox absolute path write denied');

    const persist1 = await provider.exec({
      sandboxId,
      command: "printf 'persist-ok\\n' > persist.txt",
    });
    assert.equal(persist1.success, true);
    if (!persist1.success) throw new Error('unreachable');
    assert.equal(persist1.response.exitCode, 0);
    const persist2 = await provider.exec({
      sandboxId,
      command: 'cat persist.txt',
    });
    assert.equal(persist2.success, true);
    if (!persist2.success) throw new Error('unreachable');
    assert.equal(persist2.response.result, 'persist-ok\n');
    console.log('ok: sandbox persists across execs');

    const flood = await provider.exec({
      sandboxId,
      command: `python3 -c 'import sys; sys.stdout.write("x" * ${String(MAX_OUTPUT_BYTES + 1)})'`,
      timeoutSeconds: 30,
    });
    assert.equal(flood.success, false);
    if (flood.success) throw new Error('unreachable');
    assert.match(flood.error, /buffered output exceeded/);
    console.log(`ok: oversized stdout is terminal (${String(MAX_OUTPUT_BYTES)} byte cap)`);

    assert.match(provider.getToolResultDumpDir(), /tool-results$/);
    assert.match(provider.getGitCredentialsPath(), /\.git-credentials$/);
    console.log('ok: dump/git credential paths');

    codeModeSandboxRootPath = await createSandbox(join(sandboxRootPathParent, `codemode-${Date.now()}`));
    await smokeProcessGroupTimeout({
      sandboxRootPath: codeModeSandboxRootPath,
      shell: support.shell,
      platform: support.platform,
    });
    await smokeSetsidEscapeSurvivesKillpg({
      sandboxRootPath: codeModeSandboxRootPath,
      shell: support.shell,
      platform: support.platform,
    });
    await smokeCodeMode({
      sandboxRootPath: codeModeSandboxRootPath,
      codeModeSocketParentPath,
      shell: support.shell,
      platform: support.platform,
    });

    console.log('all LocalSandboxProvider + Code Mode smokes passed');
  } finally {
    delete process.env[ENV_LEAK_MARKER];
    await provider.dispose();
    if (codeModeSandboxRootPath !== undefined) {
      await removeSandbox(codeModeSandboxRootPath).catch(() => undefined);
    }
    await rm(sandboxRootPathParent, { recursive: true, force: true }).catch(() => undefined);
    await cleanupHostProbeFiles().catch(() => undefined);
  }

  // Own SRT session: AF_UNIX enabled so FS / allowUnixSockets gating is what we measure.
  await smokeUnixSocketFsGate();
  console.log('all smokes passed');
}

test('local-sandbox smoke', async () => {
  await main();
}, 600_000);
