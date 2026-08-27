import type { CallToolRequest, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ApprovalDecision } from '../../events/schema';
import type { InternalToolCallInfo } from '../../llm/LLMTypes';
import {
  isCallToolResponseResult,
  toolResultResponse,
  type CallToolResponse,
  type IToolSet,
  type ListToolsResponse,
} from '../../mcp/IMCPServer';
import type { AgentCapability } from '../AgentCapability';

/** One tool-call attempt as a hook sees it. `toolInput` is the raw arguments object (may be absent). */
export interface LifecycleHookToolCall {
  toolName: string;
  toolInput: unknown;
}

/** A resolved tool result as a hook sees it — raw, before any tool-response processor rewrites it. */
export interface LifecycleHookToolResult extends LifecycleHookToolCall {
  toolResponse: CallToolResult;
  isError: boolean;
}

/**
 * Host-side executor for lifecycle hooks. The runtime only interposes; the host
 * owns what a hook *is* (spawned command, HTTP call, …), its timeout, and its
 * failure policy — a runner must resolve rather than throw (map fail-open to
 * `{status: 'allow'}` and fail-closed to `{status: 'deny'}`), because a thrown
 * error is treated as a thread failure, not a hook outcome.
 */
export interface LifecycleHookRunner {
  /** Runs before a tool-call attempt. A deny blocks the call; the model sees the reason. */
  preToolUse(call: LifecycleHookToolCall): Promise<ApprovalDecision>;
  /** Runs after a resolved tool call (including denial results). Observational only. */
  postToolUse(result: LifecycleHookToolResult): Promise<void>;
}

/** Which hook points the host has configured; unconfigured points cost nothing. */
export interface LifecycleHookEvents {
  preToolUse: boolean;
  postToolUse: boolean;
}

/**
 * {@link IToolSet} decorator that interposes the runner on every call:
 *
 * - pre-tool-use fires before every delegate attempt — including the attempt
 *   that pauses for user approval and the re-attempt after the user APPROVES —
 *   and a deny returns an error tool result on the same shape as a user
 *   denial, so the loop continues and the underlying tool never runs. A hook
 *   deny overrides a user approval. A user-DENIED re-dispatch executes nothing
 *   and is not hooked at all.
 * - post-tool-use fires only for executed, resolved results — never for
 *   approval/auth/sub-agent sentinels or user-denied calls.
 *
 * Identity members delegate untouched: thread bookkeeping keys toolsets by name.
 */
class HookedToolSet implements IToolSet {
  private readonly inner: IToolSet;
  private readonly runner: LifecycleHookRunner;
  private readonly events: LifecycleHookEvents;

  constructor(params: { inner: IToolSet; runner: LifecycleHookRunner; events: LifecycleHookEvents }) {
    this.inner = params.inner;
    this.runner = params.runner;
    this.events = params.events;
  }

  get name(): string {
    return this.inner.name;
  }

  get id(): string {
    return this.inner.id;
  }

  get description(): string | undefined {
    return this.inner.description;
  }

  get preload(): boolean {
    return this.inner.preload;
  }

  get hasPreloadedTools(): boolean {
    return this.inner.hasPreloadedTools;
  }

  listTools(): Promise<ListToolsResponse> {
    return this.inner.listTools();
  }

  toolCallInfo(params: CallToolRequest['params'], resolveUnderlyingTool?: boolean): Promise<InternalToolCallInfo> {
    return this.inner.toolCallInfo(params, resolveUnderlyingTool);
  }

  // Undefined falls back to the unrestricted envelope, same as an absent method.
  getAllowedToolNamesForSandbox(): string[] | undefined {
    return this.inner.getAllowedToolNamesForSandbox?.();
  }

  // Keeps identity-based checks (unwrapToolSet) working through the wrapper.
  get unwrapped(): IToolSet {
    return this.inner;
  }

  async callTool(params: CallToolRequest['params'], approvalDecision?: ApprovalDecision): Promise<CallToolResponse> {
    // A user-denied re-dispatch executes nothing — the inner toolset
    // synthesizes the denial result — so hooks neither re-gate it (a hook
    // failure must not rewrite the user's stated denial) nor record it as an
    // execution.
    if (approvalDecision?.status === 'deny') {
      return this.inner.callTool(params, approvalDecision);
    }
    const call: LifecycleHookToolCall = { toolName: params.name, toolInput: params.arguments };
    if (this.events.preToolUse) {
      const decision = await this.runner.preToolUse(call);
      if (decision.status === 'deny') {
        const reason = decision.reason?.trim() ? decision.reason : 'no reason provided';
        return toolResultResponse({
          text: JSON.stringify({ error: `Tool call denied by pre_tool_use hook: ${reason}` }),
          isError: true,
        });
      }
    }
    const response = await this.inner.callTool(params, approvalDecision);
    if (this.events.postToolUse && isCallToolResponseResult(response)) {
      await this.runner.postToolUse({
        ...call,
        toolResponse: response.result,
        isError: response.result.isError === true,
      });
    }
    return response;
  }
}

/**
 * Lifecycle-hooks capability: wraps every toolset on the thread (system meta
 * tools, sandbox, the deferred-tool proxy AND its underlying servers, user MCP
 * servers) with {@link HookedToolSet}, so a deferred call_tool produces two
 * hook events — the meta-invocation and the resolved underlying call with its
 * real identity. With no hook point configured it contributes nothing.
 */
export function lifecycleHooks(input: { runner: LifecycleHookRunner; events: LifecycleHookEvents }): AgentCapability {
  const { runner, events } = input;
  if (!events.preToolUse && !events.postToolUse) {
    return {};
  }
  return {
    toolSetDecorators: [toolSet => new HookedToolSet({ inner: toolSet, runner, events })],
  };
}
