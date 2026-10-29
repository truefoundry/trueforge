import { ToolSchema as McpToolSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  ClientSideTool,
  toolResultResponse,
  type AgentCapability,
  type ToolDefinition,
} from '@truefoundry/trueforge-core/core';
import { z } from 'zod';

/** Per-turn tool definitions. Not stored, so a resume turn must send the header again. */
export const X_TFG_TOOLS = 'x-tfg-tools';

/** One MCP tool definition from `x-tfg-tools`. `execute` is attached later and is not part of the header. */
export type InlineTool = z.infer<typeof McpToolSchema>;

export function tfgToolsCapability(tools: readonly InlineTool[]): AgentCapability {
  return {
    systemToolSets: [new InlineClientSideTools(tools)],
  };
}

class InlineClientSideTools extends ClientSideTool {
  readonly name = X_TFG_TOOLS;
  readonly displayName = 'TfgTools';
  override readonly tracingEnabled = false;
  readonly #tools: ToolDefinition[];

  constructor(tools: readonly InlineTool[]) {
    super();
    this.#tools = tools.map(tool => ({
      ...tool,
      execute: () =>
        Promise.resolve(
          toolResultResponse({
            text: 'This tool requires client-side execution and cannot be run server-side.',
            isError: true,
          }),
        ),
    }));
  }

  protected getTools(): ToolDefinition[] {
    return this.#tools;
  }
}
