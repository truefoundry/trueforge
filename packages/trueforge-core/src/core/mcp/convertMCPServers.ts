import type { ChatCompletionTool } from 'openai/resources/chat';
import type { MCPServerInitInfo } from '../events/schema';
import type { MCPAuthRequired } from '../mcp/IMCPServer';
import { type IToolSet, isAuthRequired } from './IMCPServer';
import { getUniqueSanitizedToolName } from './toolNames';

export interface MappedMCPTool {
  toolSet: IToolSet;
  originalToolName: string;
}

export interface ConvertToolsResult {
  tools: ChatCompletionTool[];
  toolMapping: Map<string, MappedMCPTool>;
}

export interface ConvertMCPServersToToolsResult {
  convertedTools: ConvertToolsResult;
  initializationInfo: MCPServerInitInfo[];
  authRequirementInfo: MCPAuthRequired[];
}

export async function convertMCPServersToTools(params: {
  tfyManagedServers: IToolSet[];
  userServers: IToolSet[];
}): Promise<ConvertMCPServersToToolsResult> {
  const { tfyManagedServers, userServers } = params;
  const tools: ChatCompletionTool[] = [];
  const toolMapping = new Map<string, MappedMCPTool>();
  const initializationInfo: MCPServerInitInfo[] = [];
  const authRequirementInfo: MCPAuthRequired[] = [];
  const registeredNames = new Set<string>();

  // Skip non-preloaded servers that have no preloaded tools, to avoid unnecessary listTools() calls and OAuth triggers.
  // Non-preloaded servers with some preloaded tools are kept so those tools can be registered.
  const filteredUserServers = userServers.filter(s => s.preload || s.hasPreloadedTools);

  // TFY-managed servers first so they claim their original tool names before user servers.
  const sortedTfyServers = [...tfyManagedServers].sort((a, b) => (a.name > b.name ? 1 : -1));
  const sortedUserServers = [...filteredUserServers].sort((a, b) => (a.name > b.name ? 1 : -1));
  const allServers = [...sortedTfyServers, ...sortedUserServers];

  const listResults = await Promise.all(
    allServers.map(async server => ({ serverName: server.name, response: await server.listTools() })),
  );

  for (let i = 0; i < allServers.length; i++) {
    const listResult = listResults[i];
    if (!listResult) {
      continue;
    }
    const { serverName, response: listResponse } = listResult;
    if (isAuthRequired(listResponse)) {
      authRequirementInfo.push(listResponse.authRequired);
      continue;
    }
    const { result: mcpTools, wasInitialized } = listResponse;
    if (wasInitialized) {
      initializationInfo.push(wasInitialized);
    }

    const toolSet = allServers[i];
    if (toolSet === undefined) {
      throw new Error(`Unreachable: missing tool set at index ${String(i)}`);
    }
    const sortedTools = [...mcpTools.tools].sort((a, b) => (a.name > b.name ? 1 : -1));
    for (const mcpTool of sortedTools) {
      if (!mcpTool.preload) {
        continue;
      }
      const { name: toolName } = getUniqueSanitizedToolName(mcpTool.name, registeredNames);
      registeredNames.add(toolName);
      const description = `mcp server: ${serverName}\n${mcpTool.description ?? ''}`;
      tools.push({
        type: 'function',
        function: {
          name: toolName,
          description: description,
          parameters: {
            type: 'object',
            properties: mcpTool.inputSchema.properties ?? {},
            required: mcpTool.inputSchema.required ?? [],
          },
        },
      });

      toolMapping.set(toolName, {
        toolSet,
        originalToolName: mcpTool.name,
      });
    }
  }

  return { convertedTools: { tools, toolMapping }, initializationInfo, authRequirementInfo };
}
