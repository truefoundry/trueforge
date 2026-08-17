/**
 * Handle-scoped Code Mode UDS transport. Listen/accept live for the Sandbox handle lifetime;
 * one UTF-8 JSON request/reply per connection (peer write-close); no request_id.
 *
 * Sockets live under {@link CodeModeUdsTransportOptions.codeModeSocketParentPath} as ULID names.
 * Parent must be mode 0700 (enforced) so other accounts cannot replace the sock inode before
 * connect; after listen the sock is chmod 0600. Same-UID isolation is still SRT path policy.
 * The caller owns that parent directory's lifetime; this transport unlinks the sock it creates.
 */
import type {
  CodeModeDispatcher,
  CodeModeReply,
  CodeModeRequest,
  CodeModeTransport,
} from '@truefoundry/trueforge-core/core';
import { CodeModeRequestSchema, validateNoPathTraversal } from '@truefoundry/trueforge-core/core';
import { chmodSync, existsSync, realpathSync, statSync } from 'node:fs';
import { chmod, unlink } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { isAbsolute, join, resolve } from 'node:path';
import { ulid } from 'ulid';
import { encodeJsonMessage, JsonMessageReader, MAX_MESSAGE_BYTES } from './frame.js';
import { registerCodeModeSocketPath, unregisterCodeModeSocketPath } from './hostRun.js';

const MAX_CODE_MODE_SOCKET_PARENT_BYTES = 60;
const CODE_MODE_SOCKET_PARENT_MODE = 0o700;
const CODE_MODE_SOCKET_MODE = 0o600;

export interface CodeModeUdsTransportOptions {
  /**
   * Absolute existing directory for Code Mode UDS files (≤60 bytes, mode 0700).
   * Socket path is `join(parent, ulid)`; sock is chmod 0600 after listen.
   */
  codeModeSocketParentPath: string;
  maxMessageBytes?: number | undefined;
  /** Optional: observe inbound protocol failures (oversized / malformed). */
  onProtocolError?: ((message: string) => void) | undefined;
}

/** Validate and normalize parent dir for Code Mode socks; enforce mode 0700. */
export function assertCodeModeSocketParentPath(path: string): string {
  if (!isAbsolute(path)) {
    throw new Error('codeModeSocketParentPath must be an absolute path');
  }
  validateNoPathTraversal(path);
  const resolved = resolve(path);
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error('codeModeSocketParentPath must be an existing directory');
  }
  // Seatbelt / allowUnixSockets match real paths (/private/var/... on macOS).
  const real = realpathSync(resolved);
  const bytes = Buffer.byteLength(real);
  if (bytes > MAX_CODE_MODE_SOCKET_PARENT_BYTES) {
    throw new Error(
      `codeModeSocketParentPath must be at most ${String(MAX_CODE_MODE_SOCKET_PARENT_BYTES)} bytes (got ${String(bytes)})`,
    );
  }
  // Owner-only parent: other accounts cannot rename/replace socks under this dir.
  chmodSync(real, CODE_MODE_SOCKET_PARENT_MODE);
  const mode = statSync(real).mode & 0o777;
  if (mode !== CODE_MODE_SOCKET_PARENT_MODE) {
    throw new Error(`codeModeSocketParentPath must be mode 0700 after chmod (got 0o${mode.toString(8)})`);
  }
  return real;
}

export class CodeModeUdsTransport implements CodeModeTransport {
  private readonly codeModeSocketParentPath: string;
  private readonly maxMessageBytes: number;
  private readonly onProtocolError: ((message: string) => void) | undefined;

  private sessionPromise: Promise<{ env: Record<string, string> }> | undefined;
  private server: Server | undefined;
  private sockPath: string | undefined;
  private dispatcher: CodeModeDispatcher | undefined;
  private cachedEnv: Record<string, string> | undefined;

  constructor(options: CodeModeUdsTransportOptions) {
    this.codeModeSocketParentPath = assertCodeModeSocketParentPath(options.codeModeSocketParentPath);
    this.maxMessageBytes = options.maxMessageBytes ?? MAX_MESSAGE_BYTES;
    this.onProtocolError = options.onProtocolError;
  }

  start(params: {
    codeModeDispatcher: CodeModeDispatcher;
    sandboxId: string;
    requestTimeoutSeconds: number;
  }): Promise<{ env: Record<string, string> }> {
    this.dispatcher = params.codeModeDispatcher;
    this.sessionPromise ??= this.listenSession(params).catch((e: unknown) => {
      this.sessionPromise = undefined;
      this.cachedEnv = undefined;
      throw e;
    });
    return this.sessionPromise;
  }

  async stop(): Promise<void> {
    const pending = this.sessionPromise;
    this.sessionPromise = undefined;
    this.cachedEnv = undefined;
    if (pending !== undefined) {
      try {
        await pending;
      } catch {
        // Listen failed; nothing to close.
      }
    }
    const server = this.server;
    const sockPath = this.sockPath;
    this.server = undefined;
    this.sockPath = undefined;
    if (server !== undefined) {
      await new Promise<void>(resolveClose => {
        server.close(() => {
          resolveClose();
        });
      });
    }
    if (sockPath !== undefined) {
      unregisterCodeModeSocketPath(sockPath);
      await unlink(sockPath).catch(() => undefined);
    }
  }

  private async listenSession(params: { requestTimeoutSeconds: number }): Promise<{ env: Record<string, string> }> {
    if (this.server !== undefined && this.cachedEnv !== undefined) {
      return { env: this.cachedEnv };
    }

    // Re-check: caller owns the parent dir and may have removed it after construct.
    assertCodeModeSocketParentPath(this.codeModeSocketParentPath);

    const sockPath = join(this.codeModeSocketParentPath, ulid().toLowerCase());
    await unlink(sockPath).catch(() => undefined);
    registerCodeModeSocketPath(sockPath);
    const server = createServer({ allowHalfOpen: true });
    try {
      await new Promise<void>((resolveListen, reject) => {
        server.once('error', reject);
        server.listen(sockPath, () => {
          server.off('error', reject);
          resolveListen();
        });
      });
      // Narrow the listen→chmod window; 0700 parent already blocks other accounts from replace.
      await chmod(sockPath, CODE_MODE_SOCKET_MODE);
    } catch (error) {
      unregisterCodeModeSocketPath(sockPath);
      server.close();
      await unlink(sockPath).catch(() => undefined);
      throw error;
    }

    this.server = server;
    this.sockPath = sockPath;
    server.on('connection', socket => {
      this.handleConnection(socket);
    });

    const env = {
      TFY_MCP_SOCK: sockPath,
      TFY_CM_REQUEST_TIMEOUT_SECONDS: String(params.requestTimeoutSeconds),
    };
    this.cachedEnv = env;
    return { env };
  }

  private handleConnection(socket: Socket): void {
    const reader = new JsonMessageReader({ maxBytes: this.maxMessageBytes });
    let settled = false;

    socket.on('error', () => undefined);

    // Oversized / malformed frames only tear down this connection (and notify
    // onProtocolError). Transport is handle-scoped and does not kill the process group.
    const fail = (message: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      this.onProtocolError?.(message);
      socket.destroy();
    };

    socket.on('data', (chunk: Buffer) => {
      try {
        reader.push(chunk);
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    });

    socket.on('end', () => {
      if (settled) {
        return;
      }
      settled = true;
      void this.dispatchConnection(socket, reader).catch((error: unknown) => {
        this.onProtocolError?.(error instanceof Error ? error.message : String(error));
        socket.destroy();
      });
    });
  }

  private async dispatchConnection(socket: Socket, reader: JsonMessageReader): Promise<void> {
    let request: CodeModeRequest;
    try {
      const parsed = CodeModeRequestSchema.safeParse(reader.finish());
      if (!parsed.success) {
        const reply: CodeModeReply = {
          ok: false,
          error: 'Malformed Code Mode request',
          source: 'caller',
        };
        socket.write(encodeJsonMessage(reply));
        socket.end();
        return;
      }
      request = parsed.data;
    } catch (error) {
      this.onProtocolError?.(error instanceof Error ? error.message : String(error));
      socket.destroy();
      return;
    }

    const dispatcher = this.dispatcher;
    if (dispatcher === undefined) {
      const reply: CodeModeReply = {
        ok: false,
        error: 'Code Mode dispatcher is not configured',
        source: 'internal',
      };
      socket.write(encodeJsonMessage(reply));
      socket.end();
      return;
    }

    const reply = await dispatcher.dispatch({ request, traceCarrier: {} });
    try {
      socket.write(encodeJsonMessage(reply));
    } finally {
      socket.end();
    }
  }
}
