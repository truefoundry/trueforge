import type { V1Status } from '@kubernetes/client-node';
import {
  PodExecTransportError,
  runPodExec,
  type PodExecClient,
  type PodExecSocket,
} from '../../../../../src/sandbox/kubernetes/core/kubeExec';

const target = { namespace: 'sandboxes', podName: 'sbx-1', containerName: 'sandbox' };

interface FakeCall {
  command: readonly string[];
  stdinChunks: Buffer[];
}

/**
 * Drives the port the way the real exec stream does: writes to the output sinks,
 * then delivers a status frame, then closes.
 */
function fakeClient(script: {
  stdout?: Buffer | string;
  stderr?: Buffer | string;
  status?: V1Status;
  closeWithoutStatus?: boolean;
  hang?: boolean;
}): { client: PodExecClient; calls: FakeCall[]; closed: () => boolean } {
  const calls: FakeCall[] = [];
  let closed = false;
  const client: PodExecClient = {
    exec: params => {
      const call: FakeCall = { command: params.command, stdinChunks: [] };
      calls.push(call);
      if (params.stdin) {
        params.stdin.on('data', (chunk: Buffer) => call.stdinChunks.push(chunk));
      }
      const socket: PodExecSocket = {
        close: () => {
          closed = true;
        },
      };
      if (script.hang === true) {
        return Promise.resolve(socket);
      }
      setImmediate(() => {
        if (script.stdout !== undefined) {
          params.stdout.write(Buffer.from(script.stdout));
        }
        if (script.stderr !== undefined) {
          params.stderr.write(Buffer.from(script.stderr));
        }
        if (script.closeWithoutStatus !== true && script.status !== undefined) {
          params.onStatus(script.status);
        }
        params.onClose();
      });
      return Promise.resolve(socket);
    },
  };
  return { client, calls, closed: () => closed };
}

const successStatus: V1Status = { status: 'Success' };

function nonZeroExitStatus(code: string): V1Status {
  return {
    status: 'Failure',
    reason: 'NonZeroExitCode',
    message: 'command terminated with non-zero exit code',
    details: { causes: [{ reason: 'ExitCode', message: code }] },
  };
}

describe('runPodExec', () => {
  it('buffers stdout and reports exit code 0 on a Success status', async () => {
    const { client, calls } = fakeClient({ stdout: 'hello\n', status: successStatus });

    const result = await runPodExec({
      client,
      target,
      command: ['sh', '-c', 'echo hello'],
      timeoutMs: 5_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString('utf8')).toBe('hello\n');
    expect(result.stderr).toBe('');
    expect(calls[0]?.command).toEqual(['sh', '-c', 'echo hello']);
  });

  it('extracts a non-zero exit code from the status causes', async () => {
    const { client } = fakeClient({ stderr: 'boom\n', status: nonZeroExitStatus('7') });

    const result = await runPodExec({ client, target, command: ['false'], timeoutMs: 5_000 });

    expect(result.exitCode).toBe(7);
    expect(result.stderr).toBe('boom\n');
  });

  it('keeps stdout binary-clean', async () => {
    const payload = Buffer.from([0x00, 0xff, 0x10, 0x80]);
    const { client } = fakeClient({ stdout: payload, status: successStatus });

    const result = await runPodExec({
      client,
      target,
      command: ['cat', 'blob'],
      timeoutMs: 5_000,
    });

    expect(Buffer.compare(result.stdout, payload)).toBe(0);
  });

  it('streams stdin to the container', async () => {
    const { client, calls } = fakeClient({ status: successStatus });

    await runPodExec({
      client,
      target,
      command: ['sh', '-c', 'cat > out'],
      stdin: Buffer.from('payload'),
      timeoutMs: 5_000,
    });

    expect(Buffer.concat(calls[0]?.stdinChunks ?? []).toString('utf8')).toBe('payload');
  });

  it('rejects with a transport error when the stream closes without a status', async () => {
    const { client } = fakeClient({ closeWithoutStatus: true });

    await expect(runPodExec({ client, target, command: ['true'], timeoutMs: 5_000 })).rejects.toBeInstanceOf(
      PodExecTransportError,
    );
  });

  it('rejects with a transport error on a non-exit-code failure status', async () => {
    const { client } = fakeClient({
      status: { status: 'Failure', reason: 'InternalError', message: 'container not found' },
    });

    await expect(runPodExec({ client, target, command: ['true'], timeoutMs: 5_000 })).rejects.toThrow(
      /container not found/,
    );
  });

  it('closes the socket and rejects when the command outlives the timeout', async () => {
    const { client, closed } = fakeClient({ hang: true });

    await expect(runPodExec({ client, target, command: ['sleep', '600'], timeoutMs: 25 })).rejects.toThrow(
      /timed out/i,
    );
    expect(closed()).toBe(true);
  });

  it('surfaces a socket error as a transport error', async () => {
    const client: PodExecClient = {
      exec: params => {
        setImmediate(() => params.onError(new Error('websocket reset')));
        return Promise.resolve({ close: () => undefined });
      },
    };

    await expect(runPodExec({ client, target, command: ['true'], timeoutMs: 5_000 })).rejects.toThrow(
      /websocket reset/,
    );
  });

  it('passes a null stdin through when no input is supplied', async () => {
    let stdinSeen: unknown = 'unset';
    const client: PodExecClient = {
      exec: params => {
        stdinSeen = params.stdin;
        setImmediate(() => {
          params.onStatus(successStatus);
          params.onClose();
        });
        return Promise.resolve({ close: () => undefined });
      },
    };

    await runPodExec({ client, target, command: ['true'], timeoutMs: 5_000 });

    expect(stdinSeen).toBeNull();
  });

  it('does not treat a late second status as a second settlement', async () => {
    const client: PodExecClient = {
      exec: params => {
        setImmediate(() => {
          params.onStatus(successStatus);
          params.onClose();
          params.onStatus(nonZeroExitStatus('3'));
          params.onError(new Error('after the fact'));
        });
        return Promise.resolve({ close: () => undefined });
      },
    };

    const result = await runPodExec({ client, target, command: ['true'], timeoutMs: 5_000 });

    expect(result.exitCode).toBe(0);
  });
});
