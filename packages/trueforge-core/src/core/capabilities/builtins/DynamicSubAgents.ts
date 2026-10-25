import type { CallToolRequest } from '@modelcontextprotocol/sdk/types.js';
import dedent from 'dedent';
import { z } from 'zod';
import { InstructionBuilder } from '../../InstructionBuilder';
import type { InternalToolCallInfo } from '../../llm/LLMTypes';
import { defineTool, LocalToolMCP, type ToolDefinition } from '../../mcp/LocalToolMCP';
import type { AgentTracing } from '../../tracing/AgentTracing';
import type { AgentCapability } from '../AgentCapability';

export const SUB_AGENT_TOOL_NAME = 'create_sub_agent';
export const SUB_AGENTS_SERVER_ID = 'sub_agents';
export const SUB_AGENTS_REMINDER_TAG = 'sub-agents';

export const SUB_AGENT_IDENTITY =
  'You are the Agent operating as a sub-agent that has been delegated a specific task. The Agent has access to the same tools as the parent agent. The Agent must focus on completing the delegated task and return a concise result. The Agent cannot ask questions to the user.';

export interface ModelSetEntry {
  description: string;
  model_params?: Record<string, unknown> | undefined;
}

export type ModelSetConfig = Record<string, ModelSetEntry>;

export function createDynamicSubAgentLargeToolResponseGuidance(): string {
  return dedent`
    For large unstructured output like web search, documentation lookup, or broad search results,
    the Agent should prefer delegating to a sub-agent and ask it to return only the relevant summary, with citations
    when they improve verification.`;
}

export function buildDynamicSubAgentsInstruction(
  builder: InstructionBuilder,
  params: { sandboxAvailable: boolean },
): void {
  const sandboxGuidance = params.sandboxAvailable
    ? dedent`
      When both sub-agents and sandbox are available, the Agent should always use sandbox code for mechanical data processing.
      The Agent should use sub-agents for tasks that return large unstructured text (e.g. web search, documentation lookup) or
      where multi-step reasoning is needed to process and summarize the results.`
    : '';

  const paragraphs = [
    dedent`The Agent can create sub-agents using the ${SUB_AGENT_TOOL_NAME} tool. Sub-agents are best for tasks that involve one or more tool calls that would fill up the context window or are blocked due to "Large Tool Response",
    or tasks requiring exploration and reasoning that can be clearly delegated.`,
    createDynamicSubAgentLargeToolResponseGuidance(),
    ...(sandboxGuidance ? [sandboxGuidance] : []),
    dedent`The Agent should ask the sub-agent to include references or citations when they would improve reliability or make
    verification easier.`,
  ];

  builder.addSection(SUB_AGENTS_REMINDER_TAG, paragraphs.join('\n\n').trim());
}

export class DynamicSubAgents extends LocalToolMCP {
  readonly name = SUB_AGENTS_SERVER_ID;
  readonly displayName = 'DynamicSubAgents';
  override readonly tracingEnabled = false;
  private tools: ToolDefinition[];

  private getCreateSubAgentDescription(modelSetConfig?: ModelSetConfig): string {
    let modelSetGuidance = '';
    const modelSetModels = modelSetConfig ? Object.keys(modelSetConfig) : [];
    if (modelSetConfig && modelSetModels.length > 0) {
      const modelList = Object.entries(modelSetConfig)
        .map(([key, entry]) => `- [${key}]: ${entry.description}`)
        .join('\n');
      modelSetGuidance = dedent`
        Pick a suitable model for the task being delegated from the following list of models and their descriptions:
        ${modelList}
        `;
    }

    const paragraphs = [
      `Delegate a well-defined task to a sub-agent. The Agent must not delegate the whole work to the sub-agent.`,
      `The sub-agent has access to the same tools and the same sandbox environment as the parent Agent. Files created or modified by either agent are shared and remain available to both.`,
      ...(modelSetGuidance ? [modelSetGuidance] : []),
      `The sub-agent has NO access to the prior conversation or the user's original message. The Agent must provide a clear, self-contained instruction that includes all necessary context, the exact task to perform, any constraints, what outputs are expected, and what work has already been completed so effort is not duplicated.`,
    ];

    return paragraphs.join('\n\n').trim();
  }

  private getCreateSubAgentTool(modelSetConfig?: ModelSetConfig): ToolDefinition {
    const modelKeys = Object.keys(modelSetConfig ?? {});
    if (modelKeys.length > 0) {
      return defineTool({
        name: SUB_AGENT_TOOL_NAME,
        description: this.getCreateSubAgentDescription(modelSetConfig),
        schema: z.object({
          name: z.string().min(1),
          input: z.string().min(1),
          model: z.enum(modelKeys as [string, ...string[]]),
        }),
        handler: input =>
          Promise.resolve({
            createSubAgent: {
              type: 'dynamic',
              name: input.name,
              input: input.input,
              model: input.model,
            },
          }),
      });
    }
    return defineTool({
      name: SUB_AGENT_TOOL_NAME,
      description: this.getCreateSubAgentDescription(modelSetConfig),
      schema: z.object({
        name: z.string().min(1),
        input: z.string().min(1),
      }),
      handler: input =>
        Promise.resolve({
          createSubAgent: {
            type: 'dynamic',
            name: input.name,
            input: input.input,
          },
        }),
    });
  }

  constructor({ modelSetConfig, tracing }: { modelSetConfig?: ModelSetConfig | undefined; tracing: AgentTracing }) {
    super({ tracing });
    this.tools = [this.getCreateSubAgentTool(modelSetConfig)];
  }

  protected getTools(): ToolDefinition[] {
    return this.tools;
  }

  override toolCallInfo(
    params: CallToolRequest['params'],
    _resolveUnderlyingTool?: boolean,
  ): Promise<InternalToolCallInfo> {
    void _resolveUnderlyingTool;
    return Promise.resolve({
      type: 'truefoundry-system',
      mcp_server_id: this.mcpServerId,
      mcp_server_name: this.name,
      original_tool_name: params.name,
      is_approval_required: false,
      is_thread_creation: true,
    });
  }
}

export function dynamicSubAgents(options: {
  modelSetConfig?: ModelSetConfig | undefined;
  sandboxAvailable: boolean;
  tracing: AgentTracing;
}): AgentCapability {
  const toolSet = new DynamicSubAgents({
    modelSetConfig: options.modelSetConfig,
    tracing: options.tracing,
  });
  return {
    systemToolSets: [toolSet],
    instructionBuilders: [
      builder => {
        buildDynamicSubAgentsInstruction(builder, { sandboxAvailable: options.sandboxAvailable });
      },
    ],
  };
}
