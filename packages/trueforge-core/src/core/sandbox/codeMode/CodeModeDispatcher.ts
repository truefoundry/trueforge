import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { context, defaultTextMapGetter } from '@opentelemetry/api';
import { unsuppressTracing, W3CTraceContextPropagator } from '@opentelemetry/core';
import { randomUUID } from 'node:crypto';
import { McpConnectionError } from '../../errors';
import {
  isApprovalRequiredResponse,
  isAuthRequired,
  isCallToolResponseCreateSubAgent,
  isCallToolResponseResult,
  type IToolSet,
} from '../../mcp/IMCPServer';
import { DEFAULT_REQUIRE_APPROVAL_FOR_TOOLS, toolRequiresApproval } from '../../mcp/toolSelectors';
import { extractErrorLogFields } from '../../util/errorLogFields';
import type { CodeModeApprovalPending, CodeModeErrorSource, CodeModeReply, CodeModeRequest } from './types';

/** Minimal logger surface used by Code Mode (avoids a hard winston dep for PoC binders). */
export interface CodeModeLogger {
  child(bindings: Record<string, unknown>): CodeModeLogger;
  error(message: string, meta?: unknown): void;
}

// Caller-caused failure: retrying won't help.
class InvalidMCPUsageError extends Error {
  override readonly name = 'InvalidMCPUsageError';
}

/** The call needs a user decision, but nothing can collect one yet. Classified `internal`. */
class CodeModeApprovalUnavailableError extends Error {
  override readonly name = 'CodeModeApprovalUnavailableError';
}

/** A gated call waiting on a decision. `settled` is null until the outcome is known. */
interface PendingApproval {
  settled: { ok: true; result: CallToolResult } | { ok: false; error: Error } | null;
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
  private readonly approvalsEnabled: boolean;
  private readonly awaiting = new Map<string, PendingApproval>();
  private readonly logger: CodeModeLogger;
  private closed = false;

  constructor(params: { toolSets: readonly IToolSet[]; approvalsEnabled: boolean; logger: CodeModeLogger }) {
    this.toolSets = new Map();
    for (const server of params.toolSets) {
      this.toolSets.set(server.name, server);
    }
    this.approvalsEnabled = params.approvalsEnabled;
    this.logger = params.logger.child({ module: 'CodeModeDispatcher' });
  }

  close(): void {
    this.closed = true;
    this.awaiting.clear();
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
      this.logger.error(`Code Mode dispatch failed (source=${source})`, {
        ...extractErrorLogFields(e),
        ...(source === 'internal' ? { reportable_error: { error: e, extra: { source } } } : {}),
      });
      return { ok: false, error: errorMessage, source };
    }
  }

  private route(request: CodeModeRequest): Promise<unknown> {
    switch (request.op) {
      case 'list_tools':
        return this.handleListTools(request);
      case 'call_tool':
        return this.handleCallTool(request);
      case 'await_approval':
        return this.handleAwaitApproval(request);
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
    const toolSet = this.getToolSet(server);
    if (!this.approvalsEnabled) {
      await this.assertAllowedWithoutApprovals(toolSet, tool);
    }
    const response = await toolSet.callTool({ name: tool, arguments: args ?? {} });
    if (isAuthRequired(response)) {
      throw new InvalidMCPUsageError(`MCP server '${server}' requires OAuth; cannot call tool from sandbox`);
    }
    if (isCallToolResponseCreateSubAgent(response)) {
      throw new InvalidMCPUsageError(`Tool '${server}/${tool}' creates a sub-agent and is not callable from sandbox`);
    }
    if (this.approvalsEnabled && isApprovalRequiredResponse(response)) {
      return this.openApproval({ server, tool });
    }
    if (!isCallToolResponseResult(response)) {
      throw new InvalidMCPUsageError(
        `Tool '${server}/${tool}' requires interactive handling and is not callable from sandbox`,
      );
    }
    return response.result;
  }

  /**
   * Stands in for the deleted sandbox-side check while approvals are off: refuse whatever the
   * default selectors would gate, even for an agent that narrowed `require_approval_for_tools`.
   * Deleted together with the flag.
   */
  private async assertAllowedWithoutApprovals(toolSet: IToolSet, tool: string): Promise<void> {
    const listed = await toolSet.listTools();
    if (isAuthRequired(listed)) {
      // The call below reports the OAuth requirement with the message the script expects.
      return;
    }
    const annotations = listed.result.tools.find(t => t.name === tool)?.annotations;
    if (toolRequiresApproval(tool, annotations, DEFAULT_REQUIRE_APPROVAL_FOR_TOOLS)) {
      throw new InvalidMCPUsageError(
        `Tool '${tool}' on MCP server '${toolSet.name}' is destructive and cannot be called in Code Mode; ` +
          `call it directly so it can go through the user approval flow`,
      );
    }
  }

  /**
   * Hand the script a ticket to poll instead of a result. Nothing can collect a decision yet,
   * so the entry is created already rejected; a broker will later supply that outcome instead.
   */
  private openApproval(params: { server: string; tool: string }): CodeModeApprovalPending {
    const approvalId = randomUUID();
    this.awaiting.set(approvalId, {
      settled: {
        ok: false,
        error: new CodeModeApprovalUnavailableError(
          `Tool '${params.server}/${params.tool}' needs approval, which is not available yet`,
        ),
      },
    });
    return { approval_pending: { approval_id: approvalId } };
  }

  private handleAwaitApproval(req: { approval_id: string }): Promise<unknown> {
    const pending = this.awaiting.get(req.approval_id);
    if (pending === undefined) {
      return Promise.reject(new InvalidMCPUsageError(`Unknown approval '${req.approval_id}'`));
    }
    if (pending.settled === null) {
      return Promise.resolve({ approval_pending: { approval_id: req.approval_id } });
    }
    this.awaiting.delete(req.approval_id);
    return pending.settled.ok ? Promise.resolve(pending.settled.result) : Promise.reject(pending.settled.error);
  }
}
