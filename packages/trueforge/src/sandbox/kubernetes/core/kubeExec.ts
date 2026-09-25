/** One `pods/exec` round trip: buffered stdout/stderr, an exit code, and a hard timeout. */
import type { Exec, V1Status } from '@kubernetes/client-node';
import { Readable, Writable } from 'node:stream';

/** Pod + container a command runs in. */
export interface PodExecTarget {
  namespace: string;
  podName: string;
  containerName: string;
}

/** Live exec stream; closing it aborts the command. */
export interface PodExecSocket {
  close(): void;
}

/**
 * The exec streaming API as this module needs it. `@kubernetes/client-node` exposes the
 * same capability positionally; the adapter below bridges the client-node implementation.
 */
export interface PodExecClient {
  exec(
    params: PodExecTarget & {
      command: readonly string[];
      stdout: Writable;
      stderr: Writable;
      stdin: Readable | null;
      onStatus: (status: V1Status) => void;
      onClose: () => void;
      onError: (error: Error) => void;
    },
  ): Promise<PodExecSocket>;
}

/** The command never ran to completion — the stream failed, timed out, or the container refused it. */
export class PodExecTransportError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PodExecTransportError';
  }
}

export interface PodExecResult {
  exitCode: number;
  stdout: Buffer;
  /** Decoded as UTF-8: stderr carries diagnostics, never the payload of a download. */
  stderr: string;
}

const EXIT_CODE_CAUSE_REASON = 'ExitCode';
const NON_ZERO_EXIT_REASON = 'NonZeroExitCode';

/**
 * Kubernetes reports the command's exit status on the error channel: `Success` for 0, and a
 * `NonZeroExitCode` failure whose causes carry the number. Any other failure means the command
 * did not run, so it has no exit code.
 */
function exitCodeFromStatus(status: V1Status): number | undefined {
  if (status.status === 'Success') {
    return 0;
  }
  if (status.reason !== NON_ZERO_EXIT_REASON) {
    return undefined;
  }
  const message = status.details?.causes?.find(cause => cause.reason === EXIT_CODE_CAUSE_REASON)?.message;
  if (message === undefined) {
    return undefined;
  }
  const parsed = Number(message);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function describeStatus(status: V1Status): string {
  return status.message ?? status.reason ?? JSON.stringify(status);
}

function collectingSink(chunks: Buffer[]): Writable {
  return new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
      callback();
    },
  });
}

/**
 * Runs one command in a pod. Resolves with the exit code even when it is non-zero; rejects with
 * `PodExecTransportError` when the command never ran or never finished.
 */
export async function runPodExec(params: {
  client: PodExecClient;
  target: PodExecTarget;
  command: readonly string[];
  stdin?: Buffer | undefined;
  timeoutMs: number;
}): Promise<PodExecResult> {
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let status: V1Status | undefined;

  let settle: (outcome: { ok: true } | { ok: false; error: PodExecTransportError }) => void = () => undefined;
  const finished = new Promise<{ ok: true } | { ok: false; error: PodExecTransportError }>(resolve => {
    settle = resolve;
  });

  const timer = setTimeout(() => {
    settle({
      ok: false,
      error: new PodExecTransportError(
        `Sandbox exec ${JSON.stringify(params.command)} timed out after ${String(params.timeoutMs)}ms`,
      ),
    });
  }, params.timeoutMs);

  let socket: PodExecSocket | undefined;
  try {
    socket = await params.client.exec({
      ...params.target,
      command: params.command,
      stdout: collectingSink(stdoutChunks),
      stderr: collectingSink(stderrChunks),
      stdin: params.stdin === undefined ? null : Readable.from([params.stdin]),
      onStatus: next => {
        // The first status is the command's own; anything after it arrives post-settlement.
        status ??= next;
      },
      onClose: () => {
        settle({ ok: true });
      },
      onError: error => {
        settle({
          ok: false,
          error: new PodExecTransportError(`Sandbox exec stream failed: ${error.message}`, { cause: error }),
        });
      },
    });

    const outcome = await finished;
    if (!outcome.ok) {
      throw outcome.error;
    }
    if (status === undefined) {
      throw new PodExecTransportError('Sandbox exec stream closed before reporting an exit status');
    }
    const exitCode = exitCodeFromStatus(status);
    if (exitCode === undefined) {
      throw new PodExecTransportError(`Sandbox exec did not run: ${describeStatus(status)}`);
    }
    return {
      exitCode,
      stdout: Buffer.concat(stdoutChunks),
      stderr: Buffer.concat(stderrChunks).toString('utf8'),
    };
  } finally {
    clearTimeout(timer);
    socket?.close();
  }
}

/** Adapts `@kubernetes/client-node`'s positional exec onto the pod exec port. */
export function toPodExecClient(exec: Exec): PodExecClient {
  return {
    exec: async params => {
      const socket = await exec.exec(
        params.namespace,
        params.podName,
        params.containerName,
        [...params.command],
        params.stdout,
        params.stderr,
        params.stdin,
        false,
        params.onStatus,
      );
      socket.on('close', params.onClose);
      socket.on('error', params.onError);
      // The stream can finish before the listeners above are attached on a very short command.
      if (socket.readyState === socket.CLOSED) {
        params.onClose();
      }
      return {
        close: () => {
          socket.close();
        },
      };
    },
  };
}
