import type { CallToolRequest } from '@modelcontextprotocol/sdk/types.js';
import type { InternalToolCallInfo } from '../llm/LLMTypes';
import { NOOP_AGENT_TRACING } from '../tracing/NoopAgentTracing';
import type { CallToolResponse } from './IMCPServer';
import { LocalToolMCP } from './LocalToolMCP';

// NOTE(agent): ClientSideTool is never executed server-side. When the LLM calls a client-side
// tool, deriveAgentExecutionState() detects `is_client_side: true` on the tool_info and
// transitions to `user-input-required` before callTool() is ever reached.
// The callTool() override exists only as a safety net for impossible states.
export abstract class ClientSideTool extends LocalToolMCP {
  // Public so concrete subclasses (AskUserQuestion, …) remain constructable from
  // factories; abstract class still cannot be instantiated directly.
  constructor() {
    super({ tracing: NOOP_AGENT_TRACING });
  }

  override async callTool(params: CallToolRequest['params']): Promise<CallToolResponse> {
    return {
      clientSideToolRequired: {
        tool_info: await this.toolCallInfo(params),
      },
    };
  }

  override toolCallInfo(
    params: CallToolRequest['params'],
    _resolveUnderlyingTool?: boolean,
  ): Promise<InternalToolCallInfo> {
    void _resolveUnderlyingTool;
    return Promise.resolve({
      type: 'truefoundry-system',
      original_tool_name: params.name,
      mcp_server_id: this.mcpServerId,
      mcp_server_name: this.name,
      is_client_side: true,
    });
  }
}
