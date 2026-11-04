import type { RegisteredPassthroughEvent } from '../events/PassthroughEvents';
import type { ApprovalDecision, MCPServerInitInfo } from '../events/schema';
import type { InternalEnrichedAssistantMessage, InternalEnrichedToolCall, LLMToolMessage } from '../llm/LLMTypes';
import type { CallToolResponse, MCPAuthRequired } from '../mcp/IMCPServer';
import {
  elapsedSeconds,
  getOperationMetrics,
  type ToolCallOutcome,
  type ToolCallServerClass,
} from '../observability/operationMetrics';
import type { AgentThreadCreateSubAgent } from '../runtime/AgentThread.types';
import { InternalEventType } from '../runtime/AgentThread.types';
import type { SandboxInfo } from '../sandbox/Sandbox';
import type { MappedMCPTool } from './convertMCPServers';
import {
  isApprovalRequiredResponse,
  isAuthRequired,
  isCallToolResponseCreateSubAgent,
  isCallToolResponseResult,
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

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse tool-call `function.arguments`. Fine-grained streaming can leave incomplete JSON;
 * failures are reported as tool errors so the model can retry rather than treating them as
 * generic execution failures.
 */
function parseToolCallArguments(
  rawArguments: string,
): { ok: true; args: Record<string, unknown> } | { ok: false; parseError: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments || '{}');
  } catch (error) {
    return {
      ok: false,
      parseError: error instanceof Error ? error.message : 'JSON parse failed',
    };
  }
  if (!isJsonObject(parsed)) {
    return {
      ok: false,
      parseError: 'Tool call arguments must be a JSON object',
    };
  }
  return { ok: true, args: parsed };
}

/** `isError` is a tool failure. Approval and client-side waits are pauses. A thrown call is `thrown`. */
function toolCallOutcome(response: CallToolResponse): ToolCallOutcome {
  if (isAuthRequired(response)) {
    return 'auth_required';
  }
  if (isApprovalRequiredResponse(response) || isClientSideToolRequiredResponse(response)) {
    return 'paused';
  }
  if (isCallToolResponseResult(response) && response.result.isError === true) {
    return 'tool_error';
  }
  return 'success';
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
    const metrics = getOperationMetrics();
    const startedMs = metrics === undefined ? undefined : performance.now();
    const record = (outcome: ToolCallOutcome, serverClass: ToolCallServerClass): void => {
      if (metrics === undefined || startedMs === undefined) {
        return;
      }
      metrics.recordToolCall({ serverClass, outcome, durationSeconds: elapsedSeconds(startedMs) });
    };

    const toolInfo = toolMapping.get(toolCall.function.name);
    if (!toolInfo) {
      record('unknown_tool', 'unknown');
      return {
        toolCall,
        toolInfo,
        response: toolResultResponse({ text: `Tool ${toolCall.function.name} not found in tool mapping` }),
        failure: true,
        completedAt: new Date().toISOString(),
      };
    }

    const serverClass = toolInfo.toolSet.serverClass;
    const parsedArgs = parseToolCallArguments(toolCall.function.arguments);
    if (!parsedArgs.ok) {
      record('tool_error', serverClass);
      return {
        toolCall,
        toolInfo,
        response: toolResultResponse({
          text: JSON.stringify({
            error: 'Failed to parse tool call arguments as JSON',
            parse_error: parsedArgs.parseError,
          }),
          isError: true,
        }),
        failure: true,
        completedAt: new Date().toISOString(),
      };
    }

    try {
      const response = await toolInfo.toolSet.callTool(
        {
          name: toolInfo.originalToolName,
          arguments: parsedArgs.args,
        },
        approvalDecisions.get(toolCall.id),
      );
      record(toolCallOutcome(response), serverClass);
      return { toolCall, toolInfo, response, failure: false, completedAt: new Date().toISOString() };
    } catch (error) {
      record('thrown', serverClass);
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
