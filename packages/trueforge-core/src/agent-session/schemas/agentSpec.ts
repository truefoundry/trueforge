/** DB AgentSpec wire schema — FQN model names and name-only skill refs. */
import { z } from '@hono/zod-openapi';
import {
  DEFAULT_INDIVIDUAL_TOOL_TOKEN_THRESHOLD,
  DEFAULT_PREVIEW_NUMBER_OF_CHARACTERS,
  DEFAULT_TOTAL_TOOL_TOKEN_THRESHOLD,
} from '../../core/capabilities/builtins/LargeToolResponse';
import { ResponseFormatSchema } from '../../core/llm/responseFormat';
import {
  DEFAULT_DISABLE_TOOLS,
  DEFAULT_ENABLE_TOOLS,
  DEFAULT_PRELOAD_TOOLS,
  DEFAULT_REQUIRE_APPROVAL_FOR_TOOLS,
  REQUIRE_APPROVAL_TOOLS_SELECTOR_TAGS,
  TOOLS_SELECTOR_TAGS,
} from '../../core/mcp/toolSelectors';

export const DEFAULT_AGENT_CONFIG_ITERATION_LIMIT = 100;

// --- Model ---

const ModelParamsSchema = z
  .object({
    max_tokens: z.number().optional().describe('Maximum tokens to generate in the model response.'),
    temperature: z.number().optional().describe('Sampling temperature; higher values increase randomness.'),
    top_p: z.number().optional().describe('Nucleus sampling probability mass.'),
    top_k: z.number().optional().describe('Top-k sampling; keep only the k highest-probability tokens.'),
    parallel_tool_calls: z
      .boolean()
      .optional()
      .describe('Whether the model may emit multiple tool calls in one response.'),
    reasoning_effort: z.string().optional().describe('Provider-specific reasoning effort (e.g. low/medium/high).'),
  })
  .loose() // this ensures extra model params are allowed
  .describe(
    'Model call parameters passed through to the provider. Known keys are documented; extra keys are allowed and forwarded as-is.',
  )
  .openapi('ModelParams');

// Opaque runtime identifier; the hosting server owns naming conventions (e.g. provider/model).
const ModelSchema = z
  .object({
    name: z
      .string()
      .min(1, 'model.name must not be empty')
      .describe('Model FQN: `provider/model`, e.g. `openai/gpt-5.2`.'),
    params: ModelParamsSchema.optional(),
  })
  .openapi('Model');

// --- MCP servers ---

// Literal tool name (not a tag).
const LiteralToolSelectorSchema = z
  .string()
  .min(1)
  .refine(s => !s.startsWith('@'), { message: 'Invalid tool selector tag' });

// enable_tools / disable_tools / preload_tools: @all, @read-only, or a literal name.
const EnableToolSelectorSchema = z
  .union([z.enum(TOOLS_SELECTOR_TAGS), LiteralToolSelectorSchema])
  .openapi('MCPServerToolSelector');

// require_approval_for_tools: @all, @write, @destructive, or a literal name.
const RequireApprovalToolSelectorSchema = z
  .union([z.enum(REQUIRE_APPROVAL_TOOLS_SELECTOR_TAGS), LiteralToolSelectorSchema])
  .openapi('MCPServerApprovalToolSelector');

// `preload` defaults to false; use `preload_tools` to eagerly load specific tools when not fully preloading.
// Auth headers are not part of the spec — they come from the configured MCP server store.
const MCPServerRequestSchema = z
  .object({
    name: z
      .string()
      .min(1, 'mcp_servers[].name must not be empty')
      .describe('Name of a configured MCP server (Settings → Connectors).'),
    // Which tools to enable. Default: all tools.
    enable_tools: z
      .array(EnableToolSelectorSchema)
      .default(DEFAULT_ENABLE_TOOLS)
      .describe('Tools exposed to the agent: `@all`, `@read-only`, or literal tool names. Default: `["@all"]`.'),
    // Which tools to disable (subtracted from enable_tools). Default: none.
    disable_tools: z
      .array(EnableToolSelectorSchema)
      .default(DEFAULT_DISABLE_TOOLS)
      .describe('Tools subtracted from the enabled set. Default: none.'),
    // When the server is not fully preloaded (`preload: false`), which tools to
    // still preload into context. A non-empty list implies `preload: false`.
    preload_tools: z
      .array(EnableToolSelectorSchema)
      .default(DEFAULT_PRELOAD_TOOLS)
      .describe(
        'Tools loaded eagerly into context while the rest stay deferred. A non-empty list implies `preload: false`.',
      ),
    // Tools that require human approval before execution. Default: @write + @destructive.
    require_approval_for_tools: z
      .array(RequireApprovalToolSelectorSchema)
      .default(DEFAULT_REQUIRE_APPROVAL_FOR_TOOLS)
      .describe(
        'Tools that pause for human approval: `@all`, `@write`, `@destructive`, or literal names. Default: `["@write", "@destructive"]`.',
      ),
    // Whether this server's tools are preloaded into context. Default: false.
    // When false, tools are discovered lazily and only `preload_tools` stay eager.
    preload: z
      .boolean()
      .optional()
      .default(false)
      .describe('When true, load all tool schemas upfront. Default: false (deferred discovery).'),
  })
  .openapi('MCPServer');

// --- Runtime config ---

const InputTokensCompactionTriggerSchema = z
  .object({
    type: z.literal('input_tokens').describe('Trigger compaction when the estimated input reaches a token limit.'),
    value: z.number().int().positive().describe('Estimated input-token count that triggers compaction.'),
  })
  .strict()
  .openapi('InputTokensCompactionTrigger');

const CompactionSettingsSchema = z
  .object({
    enabled: z.boolean().default(true).describe('Summarize older history when context grows too large. Default: true.'),
    trigger: InputTokensCompactionTriggerSchema.optional(),
  })
  .strict()
  .describe('Uses 80% of the model context length when the explicit trigger is omitted, or 50000 tokens if unknown.')
  .openapi('CompactionConfig');

const LargeToolResponseSettingsSchema = z.object({
  enabled: z.boolean().default(true).describe('Offload oversized tool responses to a sandbox file. Default: true.'),
  individual_tool_response_token_threshold: z
    .number()
    .int()
    .positive()
    .optional()
    .default(DEFAULT_INDIVIDUAL_TOOL_TOKEN_THRESHOLD)
    .describe(
      `Token threshold for a single tool response before offloading. Default: ${String(DEFAULT_INDIVIDUAL_TOOL_TOKEN_THRESHOLD)}.`,
    ),
  total_tool_response_token_threshold: z
    .number()
    .int()
    .positive()
    .optional()
    .default(DEFAULT_TOTAL_TOOL_TOKEN_THRESHOLD)
    .describe(
      `Combined tool-response token threshold before offloading. Default: ${String(DEFAULT_TOTAL_TOOL_TOKEN_THRESHOLD)}.`,
    ),
  preview_number_of_characters: z
    .number()
    .int()
    .positive()
    .optional()
    .default(DEFAULT_PREVIEW_NUMBER_OF_CHARACTERS)
    .describe(
      `Characters of preview kept in context after offloading. Default: ${String(DEFAULT_PREVIEW_NUMBER_OF_CHARACTERS)}.`,
    ),
});

const SandboxConfigSchema = z
  .object({
    enabled: z.boolean().describe('Give the agent a sandbox. Required for skills and Code Mode.'),
    file_downloads: z
      .boolean()
      .default(true)
      .describe('Allow downloading agent-produced files via the turn download endpoint. Default: true.'),
  })
  .openapi('SandboxConfig');

const DynamicSubAgentsConfigSchema = z
  .object({
    enabled: z.boolean().default(true).describe('Allow the agent to spawn dynamic subagents. Default: true.'),
  })
  .openapi('DynamicSubAgentsConfig');

const LargeToolResponseConfigSchema = LargeToolResponseSettingsSchema.pick({
  enabled: true,
}).openapi('LargeToolResponseConfig');

const ContextManagementConfigSchema = z
  .object({
    compaction: CompactionSettingsSchema.default(() => ({ enabled: true })),
    large_tool_response: LargeToolResponseConfigSchema.default(() => ({ enabled: true })),
  })
  .openapi('ContextManagementConfig');

const GenerativeUIConfigSchema = z
  .object({
    enabled: z.boolean().default(true).describe('Enable Generative UI (OpenUI blocks). Default: true.'),
  })
  .openapi('GenerativeUIConfig');

const AskUserQuestionsConfigSchema = z
  .object({
    enabled: z.boolean().default(true).describe('Enable the `ask_user_question` tool. Default: true.'),
  })
  .openapi('AskUserQuestionsConfig');

export const RuntimeConfigSchema = z
  .object({
    iteration_limit: z
      .number()
      .int()
      .positive()
      .max(1024)
      .default(DEFAULT_AGENT_CONFIG_ITERATION_LIMIT)
      .describe(
        `Max agent-loop iterations per turn (1–1024). Default: ${String(DEFAULT_AGENT_CONFIG_ITERATION_LIMIT)}.`,
      ),
    sandbox: SandboxConfigSchema.default(() => ({ enabled: false, file_downloads: true })),
    dynamic_sub_agents: DynamicSubAgentsConfigSchema.default(() => ({ enabled: true })),
    context_management: ContextManagementConfigSchema.default(() => ({
      compaction: { enabled: true },
      large_tool_response: { enabled: true },
    })),
    generative_ui: GenerativeUIConfigSchema.default(() => ({ enabled: true })),
    ask_user_questions: AskUserQuestionsConfigSchema.default(() => ({ enabled: true })),
  })
  .openapi('RuntimeConfig');

// --- Skills ---
// Name-only refs; DB sessions expand mount fields from ISkillStore at turn time.

const SKILL_NAME_REGEX = /^[A-Za-z0-9._-]+$/;

/** Name-only skill selection; mount fields come from the skill store. */
const SkillSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(SKILL_NAME_REGEX, 'Name may only contain letters, numbers, ".", "_", and "-"')
      .refine(v => v !== '.' && v !== '..', 'Name must not be "." or ".."')
      .refine(v => !v.startsWith('.tfy-'), 'Name must not use the reserved ".tfy-" prefix')
      .describe('Name of a configured skill (also used as the skill directory name in the sandbox).'),
  })
  .strict()
  .openapi('Skill');

// --- Initial messages (string-only; turn UserMessage also allows file parts) ---

const InitialUserMessageSchema = z
  .object({
    type: z.literal('user.message').describe('Initial message type.'),
    content: z
      .string()
      .min(1, 'User message content must not be empty')
      .refine(content => content.trim().length > 0, 'User message content must not be empty')
      .describe('Initial user message content injected at the start of every session.'),
  })
  .openapi('InitialUserMessage');

// --- Agent spec ---

export const AgentSpecSchema = z
  .object({
    model: ModelSchema,
    instructions: z
      .string()
      .optional()
      .describe("Optional system prompt — the agent's role, behavior, and constraints."),
    messages: z
      .array(InitialUserMessageSchema)
      .optional()
      .describe('Optional initial user messages injected at the start of every session.'),
    mcp_servers: z
      .array(MCPServerRequestSchema)
      .optional()
      .describe('Optional MCP servers attached by configured name.'),
    response_format: ResponseFormatSchema.optional(),
    skills: z
      .array(SkillSchema)
      .optional()
      .describe('Optional name-only skill references. Requires `config.sandbox.enabled: true`.'),
    // Factory must parse so nested RuntimeConfig field defaults materialize.
    config: RuntimeConfigSchema.default(() => RuntimeConfigSchema.parse({})),
  })
  .describe('Complete agent definition used inline on a session or saved as a named agent.')
  .openapi('AgentSpec');

export type AgentSpec = z.infer<typeof AgentSpecSchema>;
export type Skill = z.infer<typeof SkillSchema>;
export type InitialUserMessage = z.infer<typeof InitialUserMessageSchema>;
