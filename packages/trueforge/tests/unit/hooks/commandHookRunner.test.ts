/**
 * Runs real commands (node one-liners via temp scripts) through the spawn path:
 * the decision contract (exit codes, stdout parsing, stderr reasons, timeouts,
 * fail modes) is the behavior under test, so nothing is mocked.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLogger } from 'winston';
import { CommandHookRunner } from '../../../src/hooks/CommandHookRunner';
import { HooksFileSchema, type HookEventName } from '../../../src/schemas/hooks';

const logger = createLogger({ silent: true });

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-hook-runner-test-'));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** Writes `script` to a temp file and returns a shell command running it with this node. */
function scriptCommand(script: string): string {
  const file = path.join(tempDir(), 'hook.js');
  fs.writeFileSync(file, script);
  return `"${process.execPath}" "${file}"`;
}

function runnerFor(event: HookEventName, entries: unknown[]): CommandHookRunner {
  const config = HooksFileSchema.parse({ version: 1, hooks: { [event]: entries } });
  return new CommandHookRunner({ config, sessionId: 'session-1', turnId: 'turn-1', logger });
}

const CALL = { toolName: 'do_thing', toolInput: { key: 'value' } };

describe('CommandHookRunner', () => {
  it('exit 0 with empty stdout allows', async () => {
    const runner = runnerFor('pre_tool_use', [{ type: 'command', command: scriptCommand('process.exit(0);') }]);
    await expect(runner.preToolUse(CALL)).resolves.toEqual({ status: 'allow' });
  });

  it('exit 0 with a deny decision on stdout denies with its reason', async () => {
    const runner = runnerFor('pre_tool_use', [
      {
        type: 'command',
        command: scriptCommand(`console.log(JSON.stringify({ status: 'deny', reason: 'policy says no' }));`),
      },
    ]);
    await expect(runner.preToolUse(CALL)).resolves.toEqual({ status: 'deny', reason: 'policy says no' });
  });

  it('exit 2 denies with trimmed stderr as the reason', async () => {
    const runner = runnerFor('pre_tool_use', [
      { type: 'command', command: scriptCommand(`process.stderr.write('bad tool\\n'); process.exit(2);`) },
    ]);
    await expect(runner.preToolUse(CALL)).resolves.toEqual({ status: 'deny', reason: 'bad tool' });
  });

  it('exit 2 with empty stderr uses a fallback reason', async () => {
    const runner = runnerFor('pre_tool_use', [{ type: 'command', command: scriptCommand('process.exit(2);') }]);
    await expect(runner.preToolUse(CALL)).resolves.toEqual({ status: 'deny', reason: 'blocked by hook' });
  });

  const failureModes = [
    { name: 'non-zero exit', script: 'process.exit(1);', timeout_ms: 30_000 },
    { name: 'unparseable stdout', script: `console.log('garbage');`, timeout_ms: 30_000 },
    { name: 'timeout', script: 'setInterval(() => {}, 1000);', timeout_ms: 300 },
  ];

  test.each(failureModes)('$name with fail_mode open allows', async ({ script, timeout_ms }) => {
    const runner = runnerFor('pre_tool_use', [
      { type: 'command', command: scriptCommand(script), fail_mode: 'open', timeout_ms },
    ]);
    await expect(runner.preToolUse(CALL)).resolves.toEqual({ status: 'allow' });
  });

  test.each(failureModes)('$name with fail_mode closed denies', async ({ script, timeout_ms }) => {
    const runner = runnerFor('pre_tool_use', [
      { type: 'command', command: scriptCommand(script), fail_mode: 'closed', timeout_ms },
    ]);
    const decision = await runner.preToolUse(CALL);
    expect(decision.status).toBe('deny');
  });

  it('delivers the snake_case payload on stdin', async () => {
    // The script denies with stdin as the reason, so the payload round-trips.
    const runner = runnerFor('pre_tool_use', [
      {
        type: 'command',
        command: scriptCommand(
          `let data = '';
           process.stdin.on('data', chunk => { data += chunk; });
           process.stdin.on('end', () => { console.log(JSON.stringify({ status: 'deny', reason: data })); });`,
        ),
      },
    ]);
    const decision = await runner.preToolUse(CALL);
    if (decision.status !== 'deny' || decision.reason === undefined) {
      throw new Error('expected a deny carrying the payload');
    }
    expect(JSON.parse(decision.reason)).toEqual({
      hook_event_name: 'pre_tool_use',
      session_id: 'session-1',
      turn_id: 'turn-1',
      tool_name: 'do_thing',
      tool_input: { key: 'value' },
    });
  });

  it('settles per fail_mode when a timed-out pipeline leaves descendants holding the stdio pipes', async () => {
    // Regression: 'close' never fires while a pipeline member holds the
    // inherited pipes after the shell is killed; the decision must settle from
    // the timeout itself. Both sides self-terminate in 3s as a leak guard.
    const spin = scriptCommand('setTimeout(() => {}, 3000);');
    const runner = runnerFor('pre_tool_use', [
      {
        type: 'command',
        command: `${spin} | ${scriptCommand('setTimeout(() => {}, 3000);')}`,
        timeout_ms: 300,
        fail_mode: 'closed',
      },
    ]);
    const startedAt = Date.now();
    const decision = await runner.preToolUse(CALL);
    expect(decision.status).toBe('deny');
    expect(Date.now() - startedAt).toBeLessThan(2500);
  });

  it('settles a successful hook whose backgrounded child still holds the pipes', async () => {
    // Regression: exit 0 must resolve via the post-'exit' drain grace even
    // though 'close' is delayed by a grandchild inheriting stdout.
    const pidFile = path.join(tempDir(), 'grandchild.pid');
    const runner = runnerFor('pre_tool_use', [
      {
        type: 'command',
        command: scriptCommand(
          `const child = require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 4000)'], { stdio: ['ignore', 'inherit', 'ignore'] });
           require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
           child.unref();
           console.log(JSON.stringify({ status: 'allow' }));`,
        ),
      },
    ]);
    const startedAt = Date.now();
    try {
      await expect(runner.preToolUse(CALL)).resolves.toEqual({ status: 'allow' });
      expect(Date.now() - startedAt).toBeLessThan(2500);
    } finally {
      // Release the inherited pipe so the jest worker exits cleanly.
      try {
        process.kill(Number(fs.readFileSync(pidFile, 'utf8')), 'SIGKILL');
      } catch {
        // Already gone.
      }
    }
  });

  it('an in-budget exit beats the timeout even while descendants hold the pipes', async () => {
    // Regression: the hook exits with a valid deny well inside its budget, but
    // a grandchild keeps 'close' at bay. With the drain grace pinned far past
    // the timeout, the timeout callback MUST settle from the captured output
    // (deny) rather than misclassify the run as a timeout (fail_mode open
    // would have silently turned the deny into an allow).
    const pidFile = path.join(tempDir(), 'race-grandchild.pid');
    const config = HooksFileSchema.parse({
      version: 1,
      hooks: {
        pre_tool_use: [
          {
            type: 'command',
            command: scriptCommand(
              `const child = require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 4000)'], { stdio: ['ignore', 'inherit', 'ignore'] });
               require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
               child.unref();
               console.log(JSON.stringify({ status: 'deny', reason: 'late but in budget' }));`,
            ),
            timeout_ms: 1500,
            fail_mode: 'open',
          },
        ],
      },
    });
    const runner = new CommandHookRunner({
      config,
      sessionId: 'session-1',
      turnId: 'turn-1',
      logger,
      drainGraceMs: 10_000,
    });
    try {
      await expect(runner.preToolUse(CALL)).resolves.toEqual({ status: 'deny', reason: 'late but in budget' });
    } finally {
      // Release the inherited pipe so the jest worker exits cleanly.
      try {
        process.kill(Number(fs.readFileSync(pidFile, 'utf8')), 'SIGKILL');
      } catch {
        // Already gone.
      }
    }
  });

  it('reaps descendants still holding the pipes once the budget elapses', async () => {
    // The hook itself exits in-budget (allow settles via the drain grace), but
    // its grandchild keeps holding the inherited stdout; at the deadline the
    // whole process group must be reaped anyway.
    const pidFile = path.join(tempDir(), 'straggler.pid');
    const config = HooksFileSchema.parse({
      version: 1,
      hooks: {
        pre_tool_use: [
          {
            type: 'command',
            command: scriptCommand(
              `const child = require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { stdio: ['ignore', 'inherit', 'ignore'] });
               require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
               child.unref();
               console.log(JSON.stringify({ status: 'allow' }));`,
            ),
            timeout_ms: 700,
          },
        ],
      },
    });
    const runner = new CommandHookRunner({
      config,
      sessionId: 'session-1',
      turnId: 'turn-1',
      logger,
      drainGraceMs: 50,
    });
    const pid = await (async () => {
      try {
        await expect(runner.preToolUse(CALL)).resolves.toEqual({ status: 'allow' });
        return Number(fs.readFileSync(pidFile, 'utf8'));
      } catch (error) {
        try {
          process.kill(Number(fs.readFileSync(pidFile, 'utf8')), 'SIGKILL');
        } catch {
          // Already gone.
        }
        throw error;
      }
    })();
    try {
      const deadline = Date.now() + 3_000;
      let isAlive = true;
      while (isAlive && Date.now() < deadline) {
        try {
          process.kill(pid, 0);
          await new Promise(resolve => setTimeout(resolve, 50));
        } catch {
          isAlive = false;
        }
      }
      expect(isAlive).toBe(false);
    } finally {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already reaped — the expected case.
      }
    }
  });

  it('an unserializable payload resolves per fail_mode without running any entry', async () => {
    const marker = path.join(tempDir(), 'ran-despite-bad-payload');
    const markerCommand = scriptCommand(`require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x');`);
    // JSON.stringify throws on BigInt.
    const badCall = { toolName: 'do_thing', toolInput: { big: BigInt(1) } };

    const closedRunner = runnerFor('pre_tool_use', [{ type: 'command', command: markerCommand, fail_mode: 'closed' }]);
    const decision = await closedRunner.preToolUse(badCall);
    expect(decision.status).toBe('deny');

    const openRunner = runnerFor('pre_tool_use', [{ type: 'command', command: markerCommand }]);
    await expect(openRunner.preToolUse(badCall)).resolves.toEqual({ status: 'allow' });
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('a stderr flood cannot evict the stdout decision', async () => {
    const runner = runnerFor('pre_tool_use', [
      {
        type: 'command',
        command: scriptCommand(
          `process.stderr.write('x'.repeat(2 * 1024 * 1024));
           console.log(JSON.stringify({ status: 'deny', reason: 'flood' }));`,
        ),
      },
    ]);
    await expect(runner.preToolUse(CALL)).resolves.toEqual({ status: 'deny', reason: 'flood' });
  });

  it('observational events run every entry even when an earlier one fails or denies', async () => {
    const marker = path.join(tempDir(), 'second-observer-ran');
    const config = HooksFileSchema.parse({
      version: 1,
      hooks: {
        turn_done: [
          { type: 'command', command: scriptCommand('process.exit(2);'), fail_mode: 'closed' },
          {
            type: 'command',
            command: scriptCommand(`require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x');`),
          },
        ],
      },
    });
    const runner = new CommandHookRunner({ config, sessionId: 'session-1', turnId: 'turn-1', logger });
    await runner.turnDone({ status: 'done' });
    expect(fs.existsSync(marker)).toBe(true);
  });

  it('runs entries sequentially and stops at the first deny', async () => {
    const marker = path.join(tempDir(), 'second-ran');
    const runner = runnerFor('pre_tool_use', [
      { type: 'command', command: scriptCommand(`console.log(JSON.stringify({ status: 'deny', reason: 'first' }));`) },
      { type: 'command', command: scriptCommand(`require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x');`) },
    ]);
    await expect(runner.preToolUse(CALL)).resolves.toEqual({ status: 'deny', reason: 'first' });
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('postToolUse and turnDone resolve without a decision', async () => {
    const config = HooksFileSchema.parse({
      version: 1,
      hooks: {
        post_tool_use: [{ type: 'command', command: scriptCommand('process.exit(0);') }],
        turn_done: [{ type: 'command', command: scriptCommand('process.exit(0);') }],
      },
    });
    const runner = new CommandHookRunner({ config, sessionId: 'session-1', turnId: 'turn-1', logger });
    await expect(
      runner.postToolUse({ ...CALL, toolResponse: { content: [{ type: 'text', text: 'ok' }] }, isError: false }),
    ).resolves.toBeUndefined();
    await expect(runner.turnDone({ status: 'done' })).resolves.toBeUndefined();
  });

  it('hasHooksFor reflects configured events only', () => {
    const runner = runnerFor('turn_done', [{ type: 'command', command: 'echo hi' }]);
    expect(runner.hasHooksFor('turn_done')).toBe(true);
    expect(runner.hasHooksFor('pre_tool_use')).toBe(false);
  });
});
