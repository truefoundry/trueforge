import type { CallToolRequest } from '@modelcontextprotocol/sdk/types.js';
import dedent from 'dedent';
import type { Logger } from 'winston';
import { z } from 'zod';
import type { ApprovalDecision } from '../events/schema';
import { InstructionBuilder } from '../InstructionBuilder';
import type { InternalToolCallInfo } from '../llm/LLMTypes';
import {
  type AgentToolSchema,
  type CallToolResponse,
  isApprovalRequiredResponse,
  isAuthRequired,
  isCallToolResponseResult,
  type IToolSet,
  type ListToolsResolvedResponse,
  toolResultResponse,
} from '../mcp/IMCPServer';
import { defineTool, LocalToolMCP, type ToolDefinition } from '../mcp/LocalToolMCP';
import type { AgentTracing } from '../tracing/AgentTracing';
import { extractErrorLogFields } from '../util/errorLogFields';

export const DEFERRED_TOOLS_SERVER_ID = 'deferred-tools';
const DEFERRED_TOOLS_INSTRUCTION = 'deferred-tools-instructions';
export const LIST_TOOLS_NAME = 'list_tools';
export const GET_TOOL_INFO_NAME = 'get_tool_info';
export const GET_TOOL_OUTPUT_SCHEMA_NAME = 'get_tool_output_schema';
const CALL_TOOL_NAME = 'call_tool';
const MAX_DESCRIPTION_LENGTH = 200;

const listToolsSchema = z.object({
  mcp_server: z.string().describe('Name of the MCP server to list tools for.'),
});

const getToolInfoSchema = z.object({
  mcp_server: z.string().describe('Name of the MCP server.'),
  tool_name: z.string().describe('Name of the tool to inspect.'),
});

const getToolOutputSchemaSchema = z.object({
  mcp_server: z.string().describe('Name of the MCP server.'),
  tool_name: z.string().describe('Name of the tool to get output schema for.'),
});

const callToolSchema = z.object({
  mcp_server: z.string().describe('Name of the MCP server.'),
  tool_name: z.string().describe('Name of the tool to call.'),
  input: z.record(z.string(), z.unknown()).default({}).describe('Arguments to pass to the tool.'),
});

interface ResolvedServerTools {
  server: IToolSet;
  tools: AgentToolSchema[];
  metadata: Omit<ListToolsResolvedResponse, 'result'>;
}

function isResolvedServerTools(result: CallToolResponse | ResolvedServerTools): result is ResolvedServerTools {
  return 'tools' in result;
}

export class DeferredTool extends LocalToolMCP {
  readonly name = DEFERRED_TOOLS_SERVER_ID;
  readonly displayName = 'DeferredTools';
  override readonly description = 'Deferred tool loading for user MCP servers';

  private readonly serverMap: Map<string, IToolSet>;
  private readonly tools: ToolDefinition[];
  private readonly logger: Logger;

  constructor(
    servers: readonly IToolSet[],
    options: {
      tracing: AgentTracing;
      logger: Logger;
    },
  ) {
    super({ tracing: options.tracing });
    this.logger = options.logger.child({ module: 'DeferredTool' });
    this.serverMap = new Map(servers.map(s => [s.name, s]));
    this.tools = this.buildTools();
  }

  buildInstruction(builder: InstructionBuilder): void {
    const servers = [...this.serverMap.values()];

    // Membership follows `preload` only (origin/main). Selective `preload_tools` /
    // `hasPreloadedTools` must not hide a server from deferred discovery instructions.
    const deferredServers = servers.filter(s => !s.preload);

    if (deferredServers.length === 0) {
      return;
    }

    const deferredList = deferredServers
      .map(s => (s.description ? `- ${s.name}: "${s.description.slice(0, MAX_DESCRIPTION_LENGTH)}"` : `- ${s.name}`))
      .join('\n');

    builder.addSection(
      DEFERRED_TOOLS_INSTRUCTION,
      dedent`
        The following MCP servers have deferred tool loading. Their tools are NOT pre-loaded.
        ${deferredList}

        The Agent MUST use ${LIST_TOOLS_NAME} and ${GET_TOOL_INFO_NAME} to discover tools before calling them.`,
    );
  }

  protected getTools(): ToolDefinition[] {
    return this.tools;
  }

  override async toolCallInfo(
    params: CallToolRequest['params'],
    resolveUnderlyingTool?: boolean,
  ): Promise<InternalToolCallInfo> {
    if (params.name !== CALL_TOOL_NAME) {
      return super.toolCallInfo(params, resolveUnderlyingTool);
    }
    if (resolveUnderlyingTool === false) {
      const base = await super.toolCallInfo(params, resolveUnderlyingTool);
      return { ...base, is_deferred: true };
    }
    const parsed = callToolSchema.safeParse(params.arguments);
    if (!parsed.success) {
      this.logger.warn(`Failed to parse call_tool arguments`, {
        tool: params.name,
        errors: parsed.error.issues,
      });
      return { ...(await super.toolCallInfo(params)), is_deferred: true };
    }
    const server = this.resolveServer(parsed.data.mcp_server);
    if (!server) {
      this.logger.warn(`Server not found for toolCallInfo`, {
        mcpServer: parsed.data.mcp_server,
        toolName: parsed.data.tool_name,
        availableServers: [...this.serverMap.keys()],
      });
      return { ...(await super.toolCallInfo(params)), is_deferred: true };
    }
    const underlying = await server.toolCallInfo({
      name: parsed.data.tool_name,
      arguments: parsed.data.input,
    });
    return { ...underlying, is_deferred: true };
  }

  private resolveServer(name: string): IToolSet | undefined {
    return this.serverMap.get(name);
  }

  private async resolveServerTools(mcpServer: string): Promise<CallToolResponse | ResolvedServerTools> {
    const server = this.resolveServer(mcpServer);
    if (!server) {
      return toolResultResponse({
        text: JSON.stringify({ error: `MCP server '${mcpServer}' not found` }),
        isError: true,
      });
    }

    const listResponse = await server.listTools();
    if (isAuthRequired(listResponse)) {
      return listResponse;
    }
    const { result, ...metadata } = listResponse;
    return { server, tools: result.tools, metadata };
  }

  private buildTools(): ToolDefinition[] {
    return [this.buildListTools(), this.buildGetToolInfo(), this.buildGetToolOutputSchema(), this.buildCallTool()];
  }

  private buildListTools(): ToolDefinition {
    return defineTool({
      name: LIST_TOOLS_NAME,
      description: dedent`
        List tool names available on an MCP server.
        Returns tool names only — use ${GET_TOOL_INFO_NAME} to get full details before calling a tool.`,
      schema: listToolsSchema,
      handler: async (input: { mcp_server: string }) => {
        try {
          const resolved = await this.resolveServerTools(input.mcp_server);
          if (!isResolvedServerTools(resolved)) {
            return resolved;
          }
          const { server, tools, metadata } = resolved;
          return toolResultResponse({
            text: `${server.name}:\n  ${tools.map(t => t.name).join(', ')}`,
            overrides: metadata,
          });
        } catch (error) {
          this.logger.error('list_tools failed', {
            ...extractErrorLogFields(error),
            mcpServer: input.mcp_server,
          });
          return toolResultResponse({
            text: JSON.stringify({ error: `Failed to list tools for '${input.mcp_server}'.` }),
            isError: true,
          });
        }
      },
    });
  }

  private buildGetToolInfo(): ToolDefinition {
    return defineTool({
      name: GET_TOOL_INFO_NAME,
      description: dedent`
        Get description, inputSchema and outputSchema for a specific tool on an MCP server.
        If outputSchema is null, it will NOT be present in ${GET_TOOL_OUTPUT_SCHEMA_NAME} as well.
        The Agent MUST call ${LIST_TOOLS_NAME} first to know which tools are available.`,
      schema: getToolInfoSchema,
      handler: async (input: { mcp_server: string; tool_name: string }) => {
        try {
          const resolved = await this.resolveServerTools(input.mcp_server);
          if (!isResolvedServerTools(resolved)) {
            return resolved;
          }
          const { tools, metadata } = resolved;
          const tool = tools.find(t => t.name === input.tool_name);
          if (!tool) {
            return toolResultResponse({
              text: JSON.stringify({ error: `Tool '${input.tool_name}' not found on server '${input.mcp_server}'` }),
              overrides: metadata,
              isError: true,
            });
          }

          return toolResultResponse({
            text: JSON.stringify({
              description: tool.description,
              inputSchema: tool.inputSchema,
              outputSchema: tool.outputSchema ?? null,
            }),
            overrides: metadata,
          });
        } catch (error) {
          this.logger.error('get_tool_info failed', {
            ...extractErrorLogFields(error),
            mcpServer: input.mcp_server,
            toolName: input.tool_name,
          });
          return toolResultResponse({
            text: JSON.stringify({
              error: `Failed to get tool info: ${error instanceof Error ? error.message : 'unknown'}`,
            }),
            isError: true,
          });
        }
      },
    });
  }

  private buildGetToolOutputSchema(): ToolDefinition {
    return defineTool({
      name: GET_TOOL_OUTPUT_SCHEMA_NAME,
      description: dedent`
        Get the outputSchema for a specific tool on an MCP server.
        The Agent MUST not call ${GET_TOOL_OUTPUT_SCHEMA_NAME} and ${GET_TOOL_INFO_NAME} for the same tool.
        The Agent MUST either call ${GET_TOOL_OUTPUT_SCHEMA_NAME} or ${GET_TOOL_INFO_NAME} before entering Code Mode.
        The Agent must NOT assume the structure of a tool's response from its name or description alone.`,
      schema: getToolOutputSchemaSchema,
      handler: async (input: { mcp_server: string; tool_name: string }) => {
        try {
          const resolved = await this.resolveServerTools(input.mcp_server);
          if (!isResolvedServerTools(resolved)) {
            return resolved;
          }
          const { tools, metadata } = resolved;
          const tool = tools.find(t => t.name === input.tool_name);
          if (!tool) {
            return toolResultResponse({
              text: JSON.stringify({ error: `Tool '${input.tool_name}' not found on server '${input.mcp_server}'` }),
              overrides: metadata,
              isError: true,
            });
          }

          return toolResultResponse({
            text: JSON.stringify({
              outputSchema: tool.outputSchema ?? null,
            }),
            overrides: metadata,
          });
        } catch (error) {
          this.logger.error('get_tool_output_schema failed', {
            ...extractErrorLogFields(error),
            mcpServer: input.mcp_server,
            toolName: input.tool_name,
          });
          return toolResultResponse({
            text: JSON.stringify({
              error: `Failed to get output schema: ${error instanceof Error ? error.message : 'unknown'}`,
            }),
            isError: true,
          });
        }
      },
    });
  }

  private buildCallTool(): ToolDefinition {
    return defineTool({
      name: CALL_TOOL_NAME,
      description: dedent`
        Call a tool on an MCP server.
        The Agent MUST call ${LIST_TOOLS_NAME} and ${GET_TOOL_INFO_NAME} before calling a tool.`,
      schema: callToolSchema,
      handler: async (
        input: { mcp_server: string; tool_name: string; input: Record<string, unknown> },
        approvalDecision?: ApprovalDecision,
      ) => {
        const server = this.resolveServer(input.mcp_server);
        if (!server) {
          return toolResultResponse({
            text: JSON.stringify({ error: `MCP server '${input.mcp_server}' not found` }),
            isError: true,
          });
        }

        try {
          const response = await server.callTool({ name: input.tool_name, arguments: input.input }, approvalDecision);

          if (isAuthRequired(response)) {
            return response;
          }

          if (isApprovalRequiredResponse(response)) {
            return response;
          }

          if (!isCallToolResponseResult(response)) {
            throw new Error('Tool call returned an unexpected sub-agent response');
          }

          return response;
        } catch (error) {
          this.logger.error('call_tool failed', {
            ...extractErrorLogFields(error),
            mcpServer: input.mcp_server,
            toolName: input.tool_name,
          });
          return toolResultResponse({
            text: JSON.stringify({ error: `Tool call failed: ${error instanceof Error ? error.message : 'unknown'}` }),
            isError: true,
          });
        }
      },
    });
  }
}
