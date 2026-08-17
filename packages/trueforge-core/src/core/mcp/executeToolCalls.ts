import type { RegisteredPassthroughEvent } from '../events/PassthroughEvents';
import type { ApprovalDecision, MCPServerInitInfo } from '../events/schema';
import type { InternalEnrichedAssistantMessage, InternalEnrichedToolCall, LLMToolMessage } from '../llm/LLMTypes';
import type { MCPAuthRequired } from '../mcp/IMCPServer';
import type { AgentThreadCreateSubAgent } from '../runtime/AgentThread.types';
import { InternalEventType } from '../runtime/AgentThread.types';
import type { SandboxInfo } from '../sandbox/Sandbox';
import type { MappedMCPTool } from './convertMCPServers';
import {
  isApprovalRequiredResponse,
  isAuthRequired,
  isCallToolResponseCreateSubAgent,
  isClientSideToolRequiredResponse,
  toolResultResponse,
} from './IMCPServer';

export interface ToolCallResult {
  message: LLMToolMessage;
  // Absent only for unknown-tool calls (LLM hallucinated a name not in toolMapping):
  // there is no backing MCP server. Downstream consumers (e.g. LargeToolResponse)
  // gate on `failure: false` before reading `info`, so the absence is naturally
  // short-circuited on the success path.
  info?: MappedMCPTool | undefined;
  failure: boolean;
  isStructuredContent: boolean;
  completedAt: string;
}

export interface ExecuteToolCallsResult {
  toolCallResults: ToolCallResult[];
  initializationInfo: MCPServerInitInfo[];
  createThreadEvents: AgentThreadCreateSubAgent[];
  sandboxCreated: SandboxInfo | undefined;
  authRequirementInfo: MCPAuthRequired[];
  approvalRequiredToolCalls: InternalEnrichedToolCall[];
  clientSideToolCalls: InternalEnrichedToolCall[];
  events: RegisteredPassthroughEvent[];
}

export async function executeToolCalls({
  assistantMessage,
  toolMapping,
  threadId,
  approvalDecisions,
}: {
  assistantMessage: InternalEnrichedAssistantMessage;
  toolMapping: Map<string, MappedMCPTool>;
  threadId: string;
  approvalDecisions: Map<string, ApprovalDecision>;
}): Promise<ExecuteToolCallsResult> {
  const toolMessages: ToolCallResult[] = [];
  const initializationInfo: MCPServerInitInfo[] = [];
  const createThreadEvents: AgentThreadCreateSubAgent[] = [];
  const authRequirementInfo: MCPAuthRequired[] = [];
  const approvalRequiredToolCalls: InternalEnrichedToolCall[] = [];
  const clientSideToolCalls: InternalEnrichedToolCall[] = [];
  const passthroughEvents: RegisteredPassthroughEvent[] = [];
  let sandboxCreated: SandboxInfo | undefined;

  if (!assistantMessage.tool_calls) {
    return {
      toolCallResults: toolMessages,
      initializationInfo,
      createThreadEvents,
      sandboxCreated,
      authRequirementInfo,
      approvalRequiredToolCalls,
      clientSideToolCalls,
      events: passthroughEvents,
    };
  }

  const toolCallPromises = assistantMessage.tool_calls.map(async toolCall => {
    const toolInfo = toolMapping.get(toolCall.function.name);
    if (!toolInfo) {
      return {
        toolCall,
        toolInfo,
        response: toolResultResponse({ text: `Tool ${toolCall.function.name} not found in tool mapping` }),
        failure: true,
        completedAt: new Date().toISOString(),
      };
    }

    try {
      const args: Record<string, unknown> = JSON.parse(toolCall.function.arguments || '{}') as Record<string, unknown>;
      const response = await toolInfo.toolSet.callTool(
        {
          name: toolInfo.originalToolName,
          arguments: args,
        },
        approvalDecisions.get(toolCall.id),
      );
      return { toolCall, toolInfo, response, failure: false, completedAt: new Date().toISOString() };
    } catch (error) {
      return {
        toolCall,
        toolInfo,
        response: toolResultResponse({
          text: JSON.stringify({ error: error instanceof Error ? error.message : 'Tool execution failed' }),
          isError: true,
        }),
        failure: true,
        completedAt: new Date().toISOString(),
      };
    }
  });

  const results = await Promise.all(toolCallPromises);
  for (const { toolCall, toolInfo, response, failure, completedAt } of results) {
    if (isCallToolResponseCreateSubAgent(response)) {
      createThreadEvents.push({
        type: InternalEventType.AGENT_CREATE_SUBAGENT,
        thread_id: threadId,
        tool_call_id: toolCall.id,
        agent_info: response.createSubAgent,
      });
      continue;
    }

    if (isAuthRequired(response)) {
      authRequirementInfo.push(response.authRequired);
      // Must still emit a tool result so every tool_call in the assistant message has a
      // matching tool_result in context; otherwise the LLM API rejects the conversation.
      toolMessages.push({
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: 'Waiting for user to authenticate. Please try again 1 time.',
        },
        failure: true,
        info: toolInfo,
        isStructuredContent: false,
        completedAt,
      });
      continue;
    }

    if (isApprovalRequiredResponse(response)) {
      approvalRequiredToolCalls.push(toolCall);
      continue;
    }

    if (isClientSideToolRequiredResponse(response)) {
      clientSideToolCalls.push(toolCall);
      continue;
    }

    const { result, wasInitialized } = response;

    let content: string;
    let isStructuredContent = false;
    if (result.isError) {
      content = JSON.stringify({ error: result.content });
    } else if (result.structuredContent) {
      isStructuredContent = true;
      content = JSON.stringify(result.structuredContent);
    } else if (Array.isArray(result.content)) {
      const textContent = result.content
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .map(c => c.text)
        .join('\n');
      content = textContent || JSON.stringify(result.content);
    } else {
      content = JSON.stringify(result.content);
    }

    toolMessages.push({
      message: { role: 'tool' as const, tool_call_id: toolCall.id, content },
      failure,
      info: toolInfo,
      isStructuredContent,
      completedAt,
    });
    if (wasInitialized) {
      initializationInfo.push(wasInitialized);
    }
    if (response.sandboxCreated && response.sandboxInfo) {
      sandboxCreated = response.sandboxInfo;
    }
    if (response.events?.length) {
      passthroughEvents.push(...response.events);
    }
  }

  return {
    toolCallResults: toolMessages,
    initializationInfo,
    createThreadEvents,
    sandboxCreated,
    authRequirementInfo,
    approvalRequiredToolCalls,
    clientSideToolCalls,
    events: passthroughEvents,
  };
}
