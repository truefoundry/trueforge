import { wsconnect, type Msg, type NatsConnection } from '@nats-io/nats-core';
import { context } from '@opentelemetry/api';
import { suppressTracing } from '@opentelemetry/core';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'winston';
import { WebSocket } from 'ws';
import { extractErrorLogFields } from '../../../util/errorLogFields';
import { withTimeout } from '../../../util/promiseUtils';
import { DEFAULT_SANDBOX_NATS_WS_PORT } from '../../constants';
import { sandboxScripts } from '../../sandboxScripts.gen';
import type { CodeModeDispatcher } from '../CodeModeDispatcher';
import type { CodeModeClientInstall, CodeModeTransport } from '../CodeModeTransport';
import { CodeModeRequestSchema, type CodeModeReply, type CodeModeRequest } from '../types';

// `wsconnect` from @nats-io/nats-core relies on a global WebSocket constructor; in Node we
// provide it from `ws`. Same pattern as `src/services/NatsService.ts`.
Object.assign(global, { WebSocket });

const NATS_CONNECT_TIMEOUT_MS = 10_000;
const NATS_CONNECT_RETRIES = 3;
const NATS_CONNECT_BACKOFF_MS = 250;
const NATS_DRAIN_TIMEOUT_MS = 5_000;

const SANDBOX_NATS_SUBJECT_ROOT = 'sandbox.bridge';
const SANDBOX_NATS_MCP_LEAF = 'mcp';

/**
 * NATS Code Mode transport. Session cache + connection-drop invalidate live here
 * (no `whenClosed` on the public interface).
 */
export class CodeModeNatsTransport implements CodeModeTransport {
  private readonly resolveHostUrl: (sandboxId: string) => Promise<string>;
  private readonly sandboxClientNatsUrl: string;
  private readonly logger: Logger;

  private sessionPromise: Promise<{ env: Record<string, string> }> | undefined;
  private nc: NatsConnection | undefined;
  private dispatcher: CodeModeDispatcher | undefined;

  private readonly mcpClientRemotePath: string;
  private readonly mcpClientPathBinSymlink: string | undefined;

  constructor(params: {
    resolveHostUrl: (sandboxId: string) => Promise<string>;
    sandboxClientNatsUrl?: string;
    logger: Logger;
    /** Provider-owned MCP client layout (absolute or cwd-relative). */
    mcpClientInstall: { remotePath: string; pathBinSymlink?: string | undefined };
  }) {
    this.resolveHostUrl = params.resolveHostUrl;
    this.sandboxClientNatsUrl = params.sandboxClientNatsUrl ?? `ws://localhost:${String(DEFAULT_SANDBOX_NATS_WS_PORT)}`;
    this.logger = params.logger.child({ module: 'CodeModeNatsTransport' });
    this.mcpClientRemotePath = params.mcpClientInstall.remotePath;
    this.mcpClientPathBinSymlink = params.mcpClientInstall.pathBinSymlink;
  }

  getClientInstall(): CodeModeClientInstall {
    return {
      content: sandboxScripts.mcpClient,
      remotePath: this.mcpClientRemotePath,
      ...(this.mcpClientPathBinSymlink === undefined ? {} : { pathBinSymlink: this.mcpClientPathBinSymlink }),
    };
  }

  start(params: {
    codeModeDispatcher: CodeModeDispatcher;
    sandboxId: string;
    requestTimeoutSeconds: number;
  }): Promise<{ env: Record<string, string> }> {
    this.dispatcher = params.codeModeDispatcher;
    this.sessionPromise ??= this.connectSession(params).catch((e: unknown) => {
      this.sessionPromise = undefined;
      throw e;
    });
    return this.sessionPromise;
  }

  async stop(): Promise<void> {
    const pending = this.sessionPromise;
    this.sessionPromise = undefined;
    if (pending !== undefined) {
      try {
        await pending;
      } catch {
        // Connect failed; nothing to drain.
      }
    }
    const nc = this.nc;
    this.nc = undefined;
    if (nc === undefined) {
      return;
    }
    try {
      await withTimeout(nc.drain(), NATS_DRAIN_TIMEOUT_MS);
    } catch (e) {
      this.logger.warn('Code Mode NATS drain failed/timed out; forcing close', extractErrorLogFields(e));
      await nc.close().catch(() => {
        /* no-op */
      });
    }
  }

  private async connectSession(params: {
    sandboxId: string;
    requestTimeoutSeconds: number;
  }): Promise<{ env: Record<string, string> }> {
    const url = await this.resolveHostUrl(params.sandboxId);
    const subjectPrefix = `${SANDBOX_NATS_SUBJECT_ROOT}.${randomUUID()}`;
    let lastErr: unknown;
    let nc: NatsConnection | undefined;
    for (let attempt = 1; attempt <= NATS_CONNECT_RETRIES; attempt++) {
      try {
        nc = await context.with(suppressTracing(context.active()), () =>
          wsconnect({ servers: [url], timeout: NATS_CONNECT_TIMEOUT_MS }),
        );
        this.logger.info(`Connected to sandbox NATS (attempt ${String(attempt)})`, { subjectPrefix });
        break;
      } catch (e) {
        lastErr = e;
        this.logger.warn(`Code Mode NATS connect attempt ${String(attempt)} failed`, extractErrorLogFields(e));
        if (attempt < NATS_CONNECT_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, NATS_CONNECT_BACKOFF_MS));
        }
      }
    }
    if (nc === undefined) {
      throw lastErr instanceof Error ? lastErr : new Error('Code Mode NATS connect failed');
    }

    this.nc = nc;
    this.subscribe(nc, subjectPrefix);

    const cachedPromise = this.sessionPromise;
    void nc.closed().then(() => {
      if (this.sessionPromise === cachedPromise) {
        this.sessionPromise = undefined;
        this.nc = undefined;
        this.logger.info('Code Mode NATS connection closed; session invalidated', {
          sandboxId: params.sandboxId,
        });
      }
    });

    return {
      env: {
        TFY_NATS_URL: this.sandboxClientNatsUrl,
        TFY_NATS_SUBJECT_PREFIX: subjectPrefix,
        TFY_CM_REQUEST_TIMEOUT_SECONDS: String(params.requestTimeoutSeconds),
      },
    };
  }

  private subscribe(nc: NatsConnection, subjectPrefix: string): void {
    nc.subscribe(`${subjectPrefix}.${SANDBOX_NATS_MCP_LEAF}`, {
      callback: (err, msg) => {
        void this.handleMessage(err, msg);
      },
    });
  }

  private async handleMessage(err: Error | null, msg: Msg): Promise<void> {
    if (err) {
      this.logger.error('Code Mode NATS subscription error', extractErrorLogFields(err));
      return;
    }
    if (!msg.reply) {
      this.logger.warn(`Code Mode NATS request on '${msg.subject}' has no reply subject; dropping`);
      return;
    }

    const dispatcher = this.dispatcher;
    if (dispatcher === undefined) {
      try {
        msg.respond(this.encode({ ok: false, error: 'Code Mode dispatcher is not configured', source: 'internal' }));
      } catch (e) {
        this.logger.warn(`Failed to send dispatcher-missing reply on '${msg.subject}'`, extractErrorLogFields(e));
      }
      return;
    }

    const carrier: Record<string, string> = {};
    const traceparent = msg.headers?.get('traceparent');
    const tracestate = msg.headers?.get('tracestate');
    if (traceparent) {
      carrier['traceparent'] = traceparent;
    }
    if (tracestate) {
      carrier['tracestate'] = tracestate;
    }

    let request: CodeModeRequest;
    try {
      request = this.decode(msg);
    } catch (e) {
      this.logger.error(`Failed to decode Code Mode NATS request on '${msg.subject}'`, extractErrorLogFields(e));
      try {
        msg.respond(this.encode({ ok: false, error: 'Malformed Code Mode request', source: 'caller' }));
      } catch (respondErr) {
        this.logger.warn(`Failed to send decode-error reply on '${msg.subject}'`, extractErrorLogFields(respondErr));
      }
      return;
    }

    const reply = await dispatcher.dispatch({ request, traceCarrier: carrier });
    try {
      msg.respond(this.encode(reply));
    } catch (e) {
      this.logger.error('Failed to publish Code Mode NATS reply', extractErrorLogFields(e));
    }
  }

  private encode(reply: CodeModeReply): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(reply));
  }

  private decode(msg: Msg): CodeModeRequest {
    const raw: unknown = JSON.parse(new TextDecoder().decode(msg.data));
    return CodeModeRequestSchema.parse(raw);
  }
}
