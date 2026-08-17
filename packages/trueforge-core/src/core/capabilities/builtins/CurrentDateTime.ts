import { z } from 'zod';
import { type CallToolResponse, toolResultResponse } from '../../mcp/IMCPServer';
import { defineTool, LocalToolMCP, type ToolDefinition } from '../../mcp/LocalToolMCP';
import type { AgentTracing } from '../../tracing/AgentTracing';
import type { AgentCapability } from '../AgentCapability';

export const CURRENT_DATETIME_SERVER_ID = 'current-datetime';
export const GET_CURRENT_DATETIME_TOOL_NAME = 'get_current_datetime';

const inputSchema = z.object({}).strict();

export class CurrentDateTime extends LocalToolMCP {
  readonly name = CURRENT_DATETIME_SERVER_ID;
  readonly displayName = 'CurrentDateTime';

  constructor(tracing: AgentTracing) {
    super({ tracing });
  }

  private tools: ToolDefinition[] = [
    defineTool({
      name: GET_CURRENT_DATETIME_TOOL_NAME,
      description: 'Returns the current datetime in ISO-8601 (UTC) and unix epoch MS format.',
      schema: inputSchema,
      handler: () => Promise.resolve(this.getCurrentDateTime()),
    }),
  ];

  protected getTools(): ToolDefinition[] {
    return this.tools;
  }

  // Date.prototype.toISOString() is spec-guaranteed to return UTC (suffix 'Z').
  // Date.prototype.getTime() returns UTC epoch ms regardless of process timezone.
  private getCurrentDateTime(): CallToolResponse {
    const now = new Date();
    const payload = {
      unixEpochMS: now.getTime(),
      iso: now.toISOString(),
    };
    return toolResultResponse({ text: JSON.stringify(payload) });
  }
}

export function currentDateTime(options: { tracing: AgentTracing }): AgentCapability {
  return {
    systemToolSets: [new CurrentDateTime(options.tracing)],
  };
}
