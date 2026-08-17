import type { CallToolRequest, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { McpConnectionError } from '../errors';
import type { ApprovalDecision } from '../events/schema';
import type { InternalToolCallInfo } from '../llm/LLMTypes';
import {
  isAuthRequired,
  isCallToolResponseResult,
  toolResultResponse,
  type AgentToolSchema,
  type CallToolResponse,
  type IToolSet,
  type ListToolsResponse,
  type ToolSource,
} from './IMCPServer';
import { ToolSelectorPolicy, type ToolSelectorConfig } from './ToolSelectorPolicy';

/**
 * Per-agent {@link IToolSet} view over a shared, policy-free {@link ToolSource}, applying the
 * enable/disable/preload/approval selectors. Many can wrap one source without policy bleed.
 */
export class ToolSet implements IToolSet {
  readonly name: string;
  readonly id: string;
  readonly description?: string | undefined;
  readonly preload: boolean;
  readonly hasPreloadedTools: boolean;

  private readonly source: ToolSource;
  private readonly policy: ToolSelectorPolicy;

  constructor(params: { source: ToolSource; selectors: ToolSelectorConfig; preload: boolean }) {
    this.source = params.source;
    this.name = params.source.name;
    this.id = params.source.id;
    this.description = params.source.description;
    this.policy = new ToolSelectorPolicy({
      selectors: params.selectors,
      preload: params.preload,
    });
    this.preload = this.policy.preload;
    this.hasPreloadedTools = this.policy.hasPreloadedTools;
  }

  getAllowedToolNamesForSandbox(): string[] | undefined {
    return this.policy.allowedNamesForSandbox();
  }

  async listTools(): Promise<ListToolsResponse> {
    const response = await this.source.listTools();
    if (isAuthRequired(response)) {
      return response;
    }

    const tools = response.result.tools;
    const missingTools = this.policy.missingEnableLiterals(tools);
    if (missingTools.length > 0) {
      throw new McpConnectionError(
        `Requested tools not found in MCP server ${this.name}: ${missingTools.join(', ')}`,
        422,
      );
    }

    return {
      result: { tools: this.policy.filterAndAnnotate(tools) },
      wasInitialized: response.wasInitialized,
    };
  }

  async callTool(params: CallToolRequest['params'], decision?: ApprovalDecision): Promise<CallToolResponse> {
    // Prime the source and surface auth-required before the annotation-based allow/approval checks
    // (which would otherwise see missing annotations and wrongly 403).
    const listed = await this.source.listTools();
    if (isAuthRequired(listed)) {
      return listed;
    }
    const annotations = findAnnotations(listed.result.tools, params.name);

    await this.assertToolAllowed(params.name, annotations);

    const tool_info = await this.buildToolCallInfo(params, annotations);
    if (!decision && tool_info.is_approval_required) {
      return { approvalRequired: { tool_info } };
    }

    if (decision?.status === 'deny') {
      const reason = decision.reason ?? 'no reason provided';
      return toolResultResponse({
        text: JSON.stringify({ error: `User denied tool call: ${reason}` }),
        isError: true,
      });
    }

    const response = await this.source.callTool(params, decision);
    // The priming listTools() may have captured the first-connect init; carry it forward since the
    // subsequent callTool sees an already-open connection and reports none.
    if (listed.wasInitialized && isCallToolResponseResult(response) && !response.wasInitialized) {
      return { ...response, wasInitialized: listed.wasInitialized };
    }
    return response;
  }

  async toolCallInfo(
    params: CallToolRequest['params'],
    resolveUnderlyingTool?: boolean,
  ): Promise<InternalToolCallInfo> {
    const annotations = await this.resolveAnnotations(params.name);
    return this.buildToolCallInfo(params, annotations, resolveUnderlyingTool);
  }

  private async assertToolAllowed(toolName: string, annotations: ToolAnnotations | undefined): Promise<void> {
    const allowed = await this.policy.isAllowed(toolName, () => Promise.resolve(annotations));
    if (!allowed) {
      throw new McpConnectionError(`Tool '${toolName}' is not allowed on MCP server ${this.name}`, 403);
    }
  }

  private async buildToolCallInfo(
    params: CallToolRequest['params'],
    annotations: ToolAnnotations | undefined,
    resolveUnderlyingTool?: boolean,
  ): Promise<InternalToolCallInfo> {
    return {
      ...(await this.source.toolCallInfo(params, resolveUnderlyingTool)),
      is_approval_required: this.policy.requiresApproval(params.name, annotations),
    };
  }

  private async resolveAnnotations(toolName: string): Promise<ToolAnnotations | undefined> {
    const listed = await this.source.listTools();
    if (isAuthRequired(listed)) {
      return undefined;
    }
    return findAnnotations(listed.result.tools, toolName);
  }
}

function findAnnotations(tools: AgentToolSchema[], toolName: string): ToolAnnotations | undefined {
  return tools.find(t => t.name === toolName)?.annotations;
}
