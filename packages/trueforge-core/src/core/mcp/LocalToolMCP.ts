import type { CallToolRequest, ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { ApprovalDecision } from '../events/schema';
import type { InternalToolCallInfo } from '../llm/LLMTypes';
import type { AgentTracing } from '../tracing/AgentTracing';
import {
  type CallToolResponse,
  isCallToolResponseResult,
  type IToolSet,
  type ListToolsResolvedResponse,
  toolResultResponse,
} from './IMCPServer';

function withValidatedInput<T extends z.ZodType>(
  schema: T,
  fn: (input: z.infer<T>, approvalDecision?: ApprovalDecision) => Promise<CallToolResponse>,
) {
  return async (raw: unknown, approvalDecision?: ApprovalDecision): Promise<CallToolResponse> => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return toolResultResponse({
        text: JSON.stringify({ error: 'Validation failed', details: z.treeifyError(parsed.error) }),
        isError: true,
      });
    }
    return fn(parsed.data, approvalDecision);
  };
}

export type ToolDefinition = ListToolsResult['tools'][number] & {
  execute: (raw: unknown, approvalDecision?: ApprovalDecision) => Promise<CallToolResponse>;
};

type ToolInputSchema = ListToolsResult['tools'][number]['inputSchema'];

export function defineTool<T extends z.ZodType>(config: {
  name: string;
  description: string;
  schema: T;
  // Handlers may opt into the approvalDecision (forwarded by the agent loop after the
  // user approves an approval-gated tool). Handlers that don't declare it ignore it.
  handler: (input: z.infer<T>, approvalDecision?: ApprovalDecision) => Promise<CallToolResponse>;
}): ToolDefinition {
  // Advertise the *input* shape: fields with `.default()` are optional to callers
  // (Zod 4's default `io: "output"` would mark them required after defaults apply).
  const jsonSchema = config.schema.toJSONSchema({ io: 'input' }) as ToolInputSchema;
  return {
    name: config.name,
    description: config.description,
    inputSchema: jsonSchema,
    execute: withValidatedInput(config.schema, config.handler),
  };
}

/**
 * In-process {@link IToolSet} base for local tools: static tool list, allow-all (never filtered or
 * approval-gated), executed in-process within a local trace span. Base for all local/client-side tools.
 */
export abstract class LocalToolMCP implements IToolSet {
  abstract readonly name: string;
  abstract readonly displayName: string;
  readonly description: string = '';
  readonly preload: boolean = true;
  readonly hasPreloadedTools: boolean = true;
  readonly tracingEnabled: boolean = true;

  private readonly tracing: AgentTracing;

  protected constructor(options: { tracing: AgentTracing }) {
    this.tracing = options.tracing;
  }

  get id(): string {
    return this.mcpServerId;
  }

  protected get mcpServerId(): string {
    return this.name;
  }

  protected abstract getTools(): ToolDefinition[];

  listTools(): Promise<ListToolsResolvedResponse> {
    return Promise.resolve({
      result: {
        tools: this.getTools().map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          preload: true,
        })),
      },
      wasInitialized: undefined,
    });
  }

  async callTool(params: CallToolRequest['params'], approvalDecision?: ApprovalDecision): Promise<CallToolResponse> {
    return this.tracing.withLocalToolSpan(
      {
        displayName: this.displayName,
        toolName: params.name,
        input: JSON.stringify(params.arguments),
        enabled: this.tracingEnabled,
      },
      async span => {
        const response = await this.executeTool(params, approvalDecision);
        span.setOutput(JSON.stringify(response));
        if (isCallToolResponseResult(response) && response.sandboxInfo) {
          span.setSandboxId(response.sandboxInfo.sandbox_id);
        }
        return response;
      },
    );
  }

  // Local tools are not approval gated by default.
  // Second arg kept for IToolSet / DeferredTool compatibility (unused here).
  toolCallInfo(params: CallToolRequest['params'], _resolveUnderlyingTool?: boolean): Promise<InternalToolCallInfo> {
    void _resolveUnderlyingTool;
    return Promise.resolve({
      type: 'truefoundry-system',
      mcp_server_id: this.mcpServerId,
      mcp_server_name: this.name,
      original_tool_name: params.name,
      is_approval_required: false,
    });
  }

  private async executeTool(
    params: CallToolRequest['params'],
    approvalDecision?: ApprovalDecision,
  ): Promise<CallToolResponse> {
    const tool = this.getTools().find(t => t.name === params.name);
    if (!tool) {
      return toolResultResponse({ text: JSON.stringify({ error: `Unknown tool: ${params.name}` }), isError: true });
    }
    return tool.execute(params.arguments, approvalDecision);
  }
}
