import { context, defaultTextMapGetter } from '@opentelemetry/api';
import { unsuppressTracing, W3CTraceContextPropagator } from '@opentelemetry/core';
import { McpConnectionError } from '../../errors';
import {
  isAuthRequired,
  isCallToolResponseCreateSubAgent,
  isCallToolResponseResult,
  type IToolSet,
} from '../../mcp/IMCPServer';
import { extractErrorLogFields } from '../../util/errorLogFields';
import type { CodeModeErrorSource, CodeModeReply, CodeModeRequest } from './types';

/** Minimal logger surface used by Code Mode (avoids a hard winston dep for PoC binders). */
export interface CodeModeLogger {
  child(bindings: Record<string, unknown>): CodeModeLogger;
  error(message: string, meta?: unknown): void;
}

// Caller-caused failure: retrying won't help.
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

function classifyErrorSource(e: unknown): CodeModeErrorSource {
  if (e instanceof InvalidMCPUsageError) {
    return 'caller';
  }
  if (isHttpClientError(e)) {
    return 'caller';
  }
  if (e instanceof McpConnectionError && e.statusCode >= 400 && e.statusCode < 500) {
    return 'caller';
  }
  return 'internal';
}

// Direct W3C extractor, NOT the global `propagation` API. The gateway-wide propagator
// refuses to restore traceparent unless internal-secret headers are present. Code Mode
// is intra-process trusted, so we bypass that gate and honor the sandbox carrier.
const _w3cExtractor = new W3CTraceContextPropagator();

/**
 * Shared Code Mode policy leaf: tool routing, authz, error `source`. No NATS/UDS.
 */
export class CodeModeDispatcher {
  private readonly toolSets: Map<string, IToolSet>;
  private readonly logger: CodeModeLogger;
  private closed = false;

  constructor(params: { toolSets: readonly IToolSet[]; logger: CodeModeLogger }) {
    this.toolSets = new Map();
    for (const server of params.toolSets) {
      this.toolSets.set(server.name, server);
    }
    this.logger = params.logger.child({ module: 'CodeModeDispatcher' });
  }

  close(): void {
    this.closed = true;
  }

  async dispatch(params: {
    request: CodeModeRequest;
    traceCarrier: Readonly<Record<string, string>>;
  }): Promise<CodeModeReply> {
    if (this.closed) {
      return { ok: false, error: 'Code Mode dispatcher is closed', source: 'transport' };
    }

    const ctx = _w3cExtractor.extract(
      unsuppressTracing(context.active()),
      { ...params.traceCarrier },
      defaultTextMapGetter,
    );

    try {
      const result = await context.with(ctx, () => this.route(params.request));
      return { ok: true, result };
    } catch (e) {
      const source = classifyErrorSource(e);
      const errorMessage = e instanceof Error ? e.message : 'Unknown Code Mode dispatch error';
      this.logger.error(`Code Mode dispatch failed (source=${source})`, extractErrorLogFields(e));
      return { ok: false, error: errorMessage, source };
    }
  }

  private route(request: CodeModeRequest): Promise<unknown> {
    switch (request.op) {
      case 'list_tools':
        return this.handleListTools(request);
      case 'call_tool':
        return this.handleCallTool(request);
      default:
        throw new InvalidMCPUsageError(`Unknown Code Mode operation`);
    }
  }

  private getToolSet(serverName: string): IToolSet {
    const server = this.toolSets.get(serverName);
    if (!server) {
      throw new InvalidMCPUsageError(`MCP server '${serverName}' is not available for this agent`);
    }
    return server;
  }

  private async handleListTools(req: { server: string }): Promise<unknown> {
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
  }): Promise<unknown> {
    const { server, tool, arguments: args } = req;
    const response = await this.getToolSet(server).callTool({ name: tool, arguments: args ?? {} });
    if (isAuthRequired(response)) {
      throw new InvalidMCPUsageError(`MCP server '${server}' requires OAuth; cannot call tool from sandbox`);
    }
    if (isCallToolResponseCreateSubAgent(response)) {
      throw new InvalidMCPUsageError(`Tool '${server}/${tool}' creates a sub-agent and is not callable from sandbox`);
    }
    if (!isCallToolResponseResult(response)) {
      throw new InvalidMCPUsageError(
        `Tool '${server}/${tool}' requires interactive handling and is not callable from sandbox`,
      );
    }
    return response.result;
  }
}
