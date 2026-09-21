import type { CallToolRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from 'winston';
import { McpConnectionError } from '../errors';
import type { MCPServerInitInfo } from '../events/schema';
import type { InternalToolCallInfo } from '../llm/LLMTypes';
import type { AgentTracing } from '../tracing/AgentTracing';
import { NOOP_AGENT_TRACING } from '../tracing/NoopAgentTracing';
import { extractErrorLogFields } from '../util/errorLogFields';
import {
  type AgentToolSchema,
  type AuthRequiredResponse,
  type CallToolResolvedResponse,
  type ListToolsResolvedResponse,
  type MCPAuthRequired,
  type ToolSource,
} from './IMCPServer';
import { paginateWithCursorGuard } from './pagination';
import {
  connectRemoteMcp,
  DEFAULT_MAX_MCP_RESPONSE_BYTES,
  isSessionExpiredError,
  type RemoteMcpConnection,
  type RemoteMcpTransportType,
} from './remoteMcpClient';

/** Redacted url for trace spans: scheme + host + path only, so userinfo/query secrets never leak. */
function redactUrlForTrace(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return '';
  }
}

/** What a headers resolver returns: the headers to send, or a signal that auth is required. */
export type ResolveHeadersResult = { headers: Record<string, string> } | { authRequired: MCPAuthRequired };

/** Static headers, or a resolver (invoked at connect) returning headers or signalling auth-required. */
export type RemoteMcpHeaders = Record<string, string> | (() => Promise<ResolveHeadersResult>);

type ExecuteResult<T> = { result: T; wasInitialized: MCPServerInitInfo | undefined } | AuthRequiredResponse;

/**
 * Connection/session half of a remote MCP server: owns the transport (connects itself from `url` +
 * `headers`), session id, raw tool cache, connect single-flight and session-expiry retry. Policy-free
 * — a per-agent {@link ToolSet} layers policy.
 */
export class RemoteMCP implements ToolSource {
  readonly name: string;
  readonly id: string;
  readonly description?: string | undefined;

  private readonly url: string;
  private readonly headers: RemoteMcpHeaders;
  private readonly signal: AbortSignal;
  private readonly logger: Logger;
  private readonly tracing: AgentTracing;
  private readonly requestTimeoutMs: number;
  private readonly connectTimeoutMs: number;
  private readonly maxResponseBytes: number;
  // Redacted display url for trace spans (derived from url; unused when tracing is a no-op).
  private readonly traceUrl: string;

  private _connection?: RemoteMcpConnection | undefined;
  private isConnected = false;
  private connectPromise: Promise<MCPServerInitInfo | undefined> | undefined;
  // undefined = never connected, string = stateful session id, null = stateless/SSE.
  private sessionId: string | null | undefined;
  private resolvedTransportType?: RemoteMcpTransportType | undefined;
  private cachedTools?: AgentToolSchema[] | undefined;
  private inflight = 0;
  private pendingClose: RemoteMcpConnection | undefined;

  constructor(params: {
    name: string;
    id: string;
    description?: string | undefined;
    url: string;
    headers: RemoteMcpHeaders;
    logger: Logger;
    tracing?: AgentTracing | undefined;
    sessionId?: string | undefined;
    transportType?: RemoteMcpTransportType | undefined;
    requestTimeoutMs: number;
    connectTimeoutMs: number;
    maxResponseBytes?: number | undefined;
    signal: AbortSignal;
  }) {
    this.name = params.name;
    this.id = params.id;
    this.description = params.description;
    this.url = params.url;
    this.headers = params.headers;
    this.signal = params.signal;
    this.sessionId = params.sessionId;
    this.resolvedTransportType = params.transportType;
    this.requestTimeoutMs = params.requestTimeoutMs;
    this.connectTimeoutMs = params.connectTimeoutMs;
    this.maxResponseBytes = params.maxResponseBytes ?? DEFAULT_MAX_MCP_RESPONSE_BYTES;
    this.logger = params.logger;
    this.tracing = params.tracing ?? NOOP_AGENT_TRACING;
    this.traceUrl = redactUrlForTrace(params.url);
  }

  getSessionId(): string | undefined {
    return this.sessionId ?? undefined;
  }

  // Concurrent callTool/listTools share one transport. Session-expired retry must not close it
  // while a sibling is still using it — close() aborts the sibling with "Connection closed",
  // which is not treated as session-expired, so that call is never retried.
  //
  // Example: A (long) and B share socket S. B gets session-expired.
  //   Detach S (pendingClose), B retries on a new socket, A finishes on S,
  //   last caller closes pendingClose when inflight hits 0.
  //
  // connectAndRun:
  //   conn = this._connection          // capture; op does not re-read this._connection
  //   inflight++
  //   try:    return op(conn)
  //   catch sessionExpired:
  //     detach conn                    // _connection = undefined; do not close if inflight > 0
  //     pendingClose = conn
  //     reconnect and retry once
  //   finally:
  //     inflight--
  //     if inflight == 0: close(pendingClose)
  private async resetConnection(expired?: RemoteMcpConnection): Promise<void> {
    if (expired !== undefined && this._connection !== expired) {
      return;
    }
    this.isConnected = false;
    this.sessionId = undefined;
    this.cachedTools = undefined;
    this.connectPromise = undefined;
    await this.closeAndClearConnection();
  }

  private async closeAndClearConnection(): Promise<void> {
    const connection = this._connection;
    this._connection = undefined;
    if (!connection) {
      return;
    }
    if (this.inflight > 0) {
      // One leftover socket; a second session-expiry while the first is still pending can leak it.
      this.pendingClose = connection;
      return;
    }
    await connection.close().catch(() => {
      /* no-op */
    });
  }

  private async resolveHeaders(): Promise<ResolveHeadersResult> {
    if (typeof this.headers !== 'function') {
      return { headers: this.headers };
    }
    return await this.headers();
  }

  private async executeWithSessionRetry<T>(
    operation: (connection: RemoteMcpConnection) => Promise<T>,
  ): Promise<ExecuteResult<T>> {
    // Auth is re-checked on every operation, not only on the first connect: a registered server's OAuth
    // can be revoked or expire mid-request, and callers must get authRequired rather than a generic
    // upstream failure. When already connected the resolved headers are unused (connect is skipped).
    const headersResult = await this.resolveHeaders();
    if ('authRequired' in headersResult) {
      return { authRequired: headersResult.authRequired };
    }
    return this.connectAndRun(headersResult.headers, operation, true);
  }

  private async connectAndRun<T>(
    headers: Record<string, string>,
    operation: (connection: RemoteMcpConnection) => Promise<T>,
    canRetry: boolean,
  ): Promise<ExecuteResult<T>> {
    let used: RemoteMcpConnection | undefined;
    try {
      const initInfo = await this.connectIfNeeded(headers);
      const connection = this._connection;
      if (!connection) {
        throw new Error(`Remote MCP '${this.name}' not connected - connectIfNeeded() must run first`);
      }
      used = connection;
      this.inflight += 1;
      return { result: await operation(connection), wasInitialized: initInfo };
    } catch (error) {
      if (!(canRetry && isSessionExpiredError(error))) {
        throw error;
      }
      this.logger.info(`Session expired for remote MCP ${this.name}, reinitializing...`);
      await this.resetConnection(used);
    } finally {
      if (used) {
        this.inflight -= 1;
        if (this.inflight === 0 && this.pendingClose) {
          const stale = this.pendingClose;
          this.pendingClose = undefined;
          await stale.close().catch(() => {
            /* no-op */
          });
        }
      }
    }
    return this.connectAndRun(headers, operation, false);
  }

  private async loadTools(connection: RemoteMcpConnection): Promise<{ tools: AgentToolSchema[] }> {
    return this.tracing.withRemoteMcpToolSpan(
      { method: 'tools/list', serverName: this.name, serverId: this.id, serverUrl: this.traceUrl, enabled: true },
      async span => {
        const tools = await paginateWithCursorGuard(
          async cursor => {
            const page = await connection.listTools(cursor);
            return { items: page.tools, nextCursor: page.nextCursor };
          },
          this.name,
          this.logger,
        );
        this.cachedTools = tools.map(t => ({ ...t, preload: true }));
        span.setNumberOfTools(this.cachedTools.length);
        return { tools: this.cachedTools };
      },
    );
  }

  /** Unfiltered tool list (no policy). The per-agent wrapper applies selectors on top. */
  async listTools(): Promise<ListToolsResolvedResponse | AuthRequiredResponse> {
    if (this.cachedTools) {
      return { result: { tools: this.cachedTools }, wasInitialized: undefined };
    }
    const response = await this.executeWithSessionRetry(connection => this.loadTools(connection));
    if ('authRequired' in response) {
      return response;
    }
    return { result: { tools: response.result.tools }, wasInitialized: response.wasInitialized };
  }

  async callTool(params: CallToolRequest['params']): Promise<CallToolResolvedResponse | AuthRequiredResponse> {
    const response = await this.executeWithSessionRetry(connection =>
      this.tracing.withRemoteMcpToolSpan(
        {
          method: 'tools/call',
          serverName: this.name,
          serverId: this.id,
          serverUrl: this.traceUrl,
          toolName: params.name,
          input: JSON.stringify(params.arguments),
          enabled: true,
        },
        async span => {
          const result = await connection.callTool(params);
          span.setOutput(JSON.stringify(result));
          return result;
        },
      ),
    );
    if ('authRequired' in response) {
      return response;
    }
    return { result: response.result, wasInitialized: response.wasInitialized };
  }

  toolCallInfo(params: CallToolRequest['params'], _resolveUnderlyingTool?: boolean): Promise<InternalToolCallInfo> {
    void _resolveUnderlyingTool;
    return Promise.resolve({
      type: 'mcp',
      original_tool_name: params.name,
      mcp_server_id: this.id,
      mcp_server_name: this.name,
      is_approval_required: false,
    });
  }

  private async connectIfNeeded(headers: Record<string, string>): Promise<MCPServerInitInfo | undefined> {
    if (this.isConnected) {
      return undefined;
    }
    if (this.connectPromise) {
      // Wait for the in-flight connect, but only its originator emits the init metadata.
      await this.connectPromise;
      return undefined;
    }

    const existingSessionId = this.sessionId;
    this.connectPromise = (async (): Promise<MCPServerInitInfo | undefined> => {
      let connection: RemoteMcpConnection | undefined;
      try {
        await this.closeAndClearConnection();
        connection = await this.tracing.withRemoteMcpToolSpan(
          { method: 'initialize', serverName: this.name, serverId: this.id, serverUrl: this.traceUrl, enabled: true },
          async span => {
            const conn = await connectRemoteMcp({
              url: this.url,
              headers,
              sessionId: this.sessionId ?? undefined,
              // Hint from a prior connect
              knownTransportType: this.resolvedTransportType,
              requestTimeoutMs: this.requestTimeoutMs,
              connectTimeoutMs: this.connectTimeoutMs,
              maxResponseBytes: this.maxResponseBytes,
              signal: this.signal,
              onClose: () => {
                if (connection !== undefined && this._connection === connection) {
                  this.isConnected = false;
                }
              },
              onError: error => {
                const fields = extractErrorLogFields(error);
                const msg = `Error on remote MCP transport ${this.name}`;
                if (fields.error.includes('Body Timeout')) {
                  this.logger.warn(msg, fields);
                } else {
                  this.logger.error(msg, fields);
                }
              },
            });
            span.setOutput(JSON.stringify({ transport: conn.transportType, stateful: conn.sessionId !== null }));
            return conn;
          },
        );
      } catch (error) {
        await this.closeAndClearConnection();
        throw this.toConnectError(error);
      }
      this._connection = connection;
      this.resolvedTransportType = connection.transportType;
      this.isConnected = true;
      this.sessionId = connection.sessionId;
      if (existingSessionId === this.sessionId) {
        return undefined;
      }
      return {
        name: this.name,
        id: this.id,
        session_id: this.sessionId ?? undefined,
        transport_type: this.resolvedTransportType,
      };
    })().finally(() => {
      this.connectPromise = undefined;
    });
    return this.connectPromise;
  }

  private toConnectError(error: unknown): McpConnectionError {
    const statusCode = error instanceof McpConnectionError ? error.statusCode : 502;
    const message = error instanceof Error ? error.message : String(error);
    return new McpConnectionError(`Failed to connect to remote MCP server '${this.name}': ${message}`, statusCode, {
      cause: error,
    });
  }
}
