import { wsconnect, type Msg, type NatsConnection } from '@nats-io/nats-core';
import { context, defaultTextMapGetter } from '@opentelemetry/api';
import { suppressTracing, unsuppressTracing, W3CTraceContextPropagator } from '@opentelemetry/core';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'winston';
import { WebSocket } from 'ws';
import { McpConnectionError } from '../errors';
import {
  isAuthRequired,
  isCallToolResponseCreateSubAgent,
  isCallToolResponseResult,
  type CallToolResolvedResponse,
  type IToolSet,
  type ListToolsResolvedResponse,
} from '../mcp/IMCPServer';
import { extractErrorLogFields } from '../util/errorLogFields';
import { withTimeout } from '../util/promiseUtils';

// `wsconnect` from @nats-io/nats-core relies on a global WebSocket constructor; in Node we
// provide it from `ws`. Same pattern as `src/services/NatsService.ts`.
Object.assign(global, { WebSocket });

const NATS_CONNECT_TIMEOUT_MS = 10_000;
const NATS_CONNECT_RETRIES = 3;
const NATS_CONNECT_BACKOFF_MS = 250;
// Bound on the graceful drain at teardown; on timeout we fall back to nc.close()
const NATS_DRAIN_TIMEOUT_MS = 5_000;

const SANDBOX_NATS_SUBJECT_ROOT = 'sandbox.bridge';
// Single request/reply subject leaf; the operation is carried in the payload's `op` field so the
// bridge maintains one subscription instead of one per operation.
const SANDBOX_NATS_MCP_LEAF = 'mcp';

type BridgeRequest =
  | { op: 'list_tools'; server: string }
  | { op: 'call_tool'; server: string; tool: string; arguments?: Record<string, unknown> };

// Attributes an application-level failure so the sandbox client can tell who is at fault:
// 'agent' (bad generated code: wrong server/tool/args or an unsupported path), 'gateway' (our
// handler failed), or 'bridge' (a NATS bridge lifecycle condition, e.g. the bridge was closed).
// Pure transport failures never produce an envelope, so they're inferred client-side instead.
type BridgeErrorSource = 'gateway' | 'agent' | 'bridge';

// Envelope returned on `msg.reply`. NATS itself always succeeds; the receiver branches on `ok`.
type BridgeReply<T> = { ok: true; result: T } | { ok: false; error: string; source: BridgeErrorSource };

// Caller-caused failure: retrying won't help, so it's attributed to the agent's code, not us.
class InvalidMCPUsageError extends Error {
  override readonly name = 'InvalidMCPUsageError';
}

function isHttpClientError(error: unknown): error is { status: number } {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return false;
  }
  const { status } = error;
  return typeof status === 'number' && status >= 400 && status < 500;
}

// An InvalidMCPUsageError, a 4xx HTTP-style exception, or a 4xx-hinted McpConnectionError (e.g. a
// disallowed/unknown tool surfaced by an ToolSet) is caller-caused -> 'agent'; anything else is
// our bug -> 'gateway'.
function classifyErrorSource(e: unknown): BridgeErrorSource {
  if (e instanceof InvalidMCPUsageError) return 'agent';
  if (isHttpClientError(e)) return 'agent';
  // ...remote servers with a 4xx McpConnectionError (has `statusCode`, not `status`). Same meaning.
  if (e instanceof McpConnectionError && e.statusCode >= 400 && e.statusCode < 500) return 'agent';
  return 'gateway';
}

// Direct W3C extractor, NOT the global `propagation` API. The gateway-wide propagator
// (SelectivePropagator in src/tracing.ts) refuses to restore traceparent unless the
// internal-secret headers are present — a deliberate guard against external requests
// forging trace parents. The NATS bridge is intra-process trusted (sender + receiver
// share the same Node process and span store), so we bypass that gate here and
// always honor the trace context the sandbox echoes back.
const _w3cExtractor = new W3CTraceContextPropagator();

function extractTraceCarrier(msg: Msg): Record<string, string> {
  const carrier: Record<string, string> = {};
  const traceparent = msg.headers?.get('traceparent');
  const tracestate = msg.headers?.get('tracestate');
  if (traceparent) carrier['traceparent'] = traceparent;
  if (tracestate) carrier['tracestate'] = tracestate;
  return carrier;
}

/**
 * Per-sandbox NATS subscriber. Bridges sandbox-originated MCP tool calls (sent over wss to the
 * sandbox's local nats-server) into the gateway pod's `IToolSet` registry for this agent.
 * The pod that holds the preview URL is the only NATS subscriber, which gives sandbox→gateway
 * traffic pod-affinity for free.
 */
export class SandboxNatsBridge {
  readonly subjectPrefix: string;

  private readonly nc: NatsConnection;
  private readonly toolSets: Map<string, IToolSet>;
  private readonly logger: Logger;
  private closed = false;

  private constructor(nc: NatsConnection, toolSets: Map<string, IToolSet>, subjectPrefix: string, logger: Logger) {
    this.nc = nc;
    this.toolSets = toolSets;
    this.subjectPrefix = subjectPrefix;
    this.logger = logger;
  }

  static async connect(params: {
    url: string;
    toolSets: Map<string, IToolSet>;
    logger: Logger;
  }): Promise<SandboxNatsBridge> {
    const subjectPrefix = `${SANDBOX_NATS_SUBJECT_ROOT}.${randomUUID()}`;
    const logger = params.logger.child({ module: 'SandboxNatsBridge' });
    let lastErr: unknown;
    for (let attempt = 1; attempt <= NATS_CONNECT_RETRIES; attempt++) {
      try {
        const nc = await context.with(suppressTracing(context.active()), () =>
          wsconnect({ servers: [params.url], timeout: NATS_CONNECT_TIMEOUT_MS }),
        );
        logger.info(`Connected to sandbox NATS (attempt ${String(attempt)})`, { subjectPrefix });
        const bridge = new SandboxNatsBridge(nc, params.toolSets, subjectPrefix, logger);
        bridge.subscribe();
        return bridge;
      } catch (e) {
        lastErr = e;
        logger.warn(`Sandbox NATS connect attempt ${String(attempt)} failed`, extractErrorLogFields(e));
        if (attempt < NATS_CONNECT_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, NATS_CONNECT_BACKOFF_MS));
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Sandbox NATS connect failed');
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      // drain() resolves once pending replies are flushed and the connection closes.
      await withTimeout(this.nc.drain(), NATS_DRAIN_TIMEOUT_MS);
    } catch (e) {
      // drain rejected or timed out, nc.close() terminates all pending requests and subscriptions on the connection.
      this.logger.warn('Sandbox NATS drain failed/timed out; forcing close', extractErrorLogFields(e));
      await this.nc.close().catch(() => {
        /* no-op */
      });
    }
  }

  async whenClosed(): Promise<void> {
    await this.nc.closed();
  }

  private subscribe(): void {
    this.nc.subscribe(`${this.subjectPrefix}.${SANDBOX_NATS_MCP_LEAF}`, {
      callback: (err, msg) => {
        this.handle(err, msg, m => this.route(m));
      },
    });
  }

  private route(msg: Msg): Promise<unknown> {
    const req = this.decode(msg);
    switch (req.op) {
      case 'list_tools':
        return this.handleListTools(req);
      case 'call_tool':
        return this.handleCallTool(req);
      default:
        throw new InvalidMCPUsageError(`Unknown sandbox bridge operation`);
    }
  }

  private handle(err: Error | null, msg: Msg, handler: (msg: Msg) => Promise<unknown>): void {
    if (err) {
      this.logger.error('Sandbox NATS subscription error', extractErrorLogFields(err));
      return;
    }
    if (!msg.reply) {
      this.logger.warn(`Sandbox NATS request on '${msg.subject}' has no reply subject; dropping`);
      return;
    }

    // Resume the originating Sandbox: exec span from the per-request traceparent header so
    // downstream MCP spans nest correctly (falls through to the current context if absent).
    // unsuppressTracing is required: connect() runs under suppressTracing (to drop the
    // WS-upgrade span) and nats-core's receive loop reuses that suppressed context, which would
    // otherwise make propagation.inject no-op and leak a stale traceparent.
    const ctx = _w3cExtractor.extract(
      unsuppressTracing(context.active()),
      extractTraceCarrier(msg),
      defaultTextMapGetter,
    );
    context.with(ctx, () => void this.dispatch(msg, handler));
  }

  private async dispatch(msg: Msg, handler: (msg: Msg) => Promise<unknown>): Promise<void> {
    if (this.closed) {
      this.logger.warn(`Sandbox NATS bridge is closed; rejecting request on '${msg.subject}'`);
      try {
        msg.respond(this.encode({ ok: false, error: 'Sandbox NATS bridge is closed', source: 'bridge' }));
      } catch (e) {
        this.logger.warn(`Failed to send bridge-closed reply on '${msg.subject}'`, extractErrorLogFields(e));
      }
      return;
    }
    let reply: BridgeReply<unknown>;
    try {
      reply = { ok: true, result: await handler(msg) };
    } catch (e) {
      const source = classifyErrorSource(e);
      const errorMessage = e instanceof Error ? e.message : 'Unknown sandbox bridge error';
      this.logger.error(
        `Sandbox NATS dispatch failed on '${msg.subject}' (source=${source})`,
        extractErrorLogFields(e),
      );
      reply = { ok: false, error: errorMessage, source };
    }
    try {
      msg.respond(this.encode(reply));
    } catch (e) {
      this.logger.error('Failed to publish sandbox NATS reply', extractErrorLogFields(e));
    }
  }

  private encode(reply: BridgeReply<unknown>): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(reply));
  }

  private decode(msg: Msg): BridgeRequest {
    return JSON.parse(new TextDecoder().decode(msg.data)) as BridgeRequest;
  }

  private getToolSet(serverName: string): IToolSet {
    const server = this.toolSets.get(serverName);
    if (!server) {
      throw new InvalidMCPUsageError(`MCP server '${serverName}' is not available for this agent`);
    }
    return server;
  }

  private async handleListTools(req: { server: string }): Promise<ListToolsResolvedResponse['result']> {
    const { server } = req;
    const mcp = this.getToolSet(server);
    const response = await mcp.listTools();
    if (isAuthRequired(response)) {
      throw new InvalidMCPUsageError(`MCP server '${server}' requires OAuth; cannot list tools from sandbox`);
    }
    return response.result;
  }

  private async handleCallTool(req: {
    server: string;
    tool: string;
    arguments?: Record<string, unknown> | undefined;
  }): Promise<CallToolResolvedResponse['result']> {
    const { server, tool, arguments: args } = req;
    const response = await this.getToolSet(server).callTool({ name: tool, arguments: args ?? {} });
    if (isAuthRequired(response)) {
      throw new InvalidMCPUsageError(`MCP server '${server}' requires OAuth; cannot call tool from sandbox`);
    }
    if (isCallToolResponseCreateSubAgent(response)) {
      throw new InvalidMCPUsageError(`Tool '${server}/${tool}' creates a sub-agent and is not callable from sandbox`);
    }
    if (!isCallToolResponseResult(response)) {
      // Approval / client-side-tool paths are intentionally out of scope currently.
      throw new InvalidMCPUsageError(
        `Tool '${server}/${tool}' requires interactive handling and is not callable from sandbox`,
      );
    }
    return response.result;
  }
}
