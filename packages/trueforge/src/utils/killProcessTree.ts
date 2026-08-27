import type { ChildProcess } from 'node:child_process';

/**
 * Tear down a spawned command and every process in its group. The child must
 * be spawned as a process-group leader (`detached: true` on Unix) for the
 * group kill to reach descendants; on Windows only the direct child can be
 * killed and grandchildren may outlive it.
 */
export function killProcessTree(child: ChildProcess | undefined): void {
  if (!child) {
    return;
  }
  const pid = child.pid;
  if (pid !== undefined && process.platform !== 'win32') {
    try {
      process.kill(-pid, 'SIGKILL');
      return;
    } catch {
      // ESRCH if the group is already gone — fall through.
    }
  }
  if (!child.killed) {
    child.kill('SIGKILL');
  }
}
