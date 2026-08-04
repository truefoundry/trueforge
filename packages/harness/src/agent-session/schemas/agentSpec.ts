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
    max_tokens: z.number().optional(),
    temperature: z.number().optional(),
    top_p: z.number().optional(),
    top_k: z.number().optional(),
    parallel_tool_calls: z.boolean().optional(),
    reasoning_effort: z.string().optional(),
  })
  .loose() // this ensures extra model params are allowed
  .openapi('ModelParams');

/** Same shape as server `parseModelFqn`: exactly one slash, non-empty provider and model. */
function isModelFqn(name: string): boolean {
  const slash = name.indexOf('/');
  if (slash <= 0 || slash === name.length - 1) {
    return false;
  }
  return !name.includes('/', slash + 1);
}

const ModelSpecSchema = z
  .object({
    name: z
      .string()
      .min(1, 'model.name must not be empty')
      .refine(isModelFqn, { message: 'model.name must be a fully qualified "provider/model"' }),
    params: ModelParamsSchema.optional(),
  })
  .openapi('AgentSpecModel');

// --- MCP servers ---

// Literal tool name (not a tag).
const LiteralToolSelectorSchema = z
  .string()
  .min(1)
  .refine(s => !s.startsWith('@'), { message: 'Invalid tool selector tag' });

// enable_tools / disable_tools / preload_tools: @all, @read-only, or a literal name.
const EnableToolSelectorSchema = z.union([z.enum(TOOLS_SELECTOR_TAGS), LiteralToolSelectorSchema]);

// require_approval_for_tools: @all, @write, @destructive, or a literal name.
const RequireApprovalToolSelectorSchema = z.union([
  z.enum(REQUIRE_APPROVAL_TOOLS_SELECTOR_TAGS),
  LiteralToolSelectorSchema,
]);

// `preload` defaults to false; use `preload_tools` to eagerly load specific tools when not fully preloading.
// Auth headers are not part of the spec — they come from the configured MCP server store.
const MCPServerRequestSchema = z
  .object({
    name: z.string().min(1, 'mcp_servers[].name must not be empty'),
    // Which tools to enable. Default: all tools.
    enable_tools: z.array(EnableToolSelectorSchema).default(DEFAULT_ENABLE_TOOLS),
    // Which tools to disable (subtracted from enable_tools). Default: none.
    disable_tools: z.array(EnableToolSelectorSchema).default(DEFAULT_DISABLE_TOOLS),
    // When the server is not fully preloaded (`preload: false`), which tools to
    // still preload into context. A non-empty list implies `preload: false`.
    preload_tools: z.array(EnableToolSelectorSchema).default(DEFAULT_PRELOAD_TOOLS),
    // Tools that require human approval before execution. Default: @write + @destructive.
    require_approval_for_tools: z.array(RequireApprovalToolSelectorSchema).default(DEFAULT_REQUIRE_APPROVAL_FOR_TOOLS),
    // Whether this server's tools are preloaded into context. Default: false.
    // When false, tools are discovered lazily and only `preload_tools` stay eager.
    preload: z.boolean().optional().default(false),
  })
  .openapi('MCPServer');

// --- Runtime config ---

const CompactionSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  compaction_threshold_tokens: z.number().int().positive().optional(),
});

const LargeToolResponseSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  individual_tool_response_token_threshold: z
    .number()
    .int()
    .positive()
    .optional()
    .default(DEFAULT_INDIVIDUAL_TOOL_TOKEN_THRESHOLD),
  total_tool_response_token_threshold: z
    .number()
    .int()
    .positive()
    .optional()
    .default(DEFAULT_TOTAL_TOOL_TOKEN_THRESHOLD),
  preview_number_of_characters: z.number().int().positive().optional().default(DEFAULT_PREVIEW_NUMBER_OF_CHARACTERS),
});

const BASIC_AUTH_USERNAME_PATTERN = /^\S+$/;

/** True when any hostname segment contains `*` (e.g. `*.github.com`). */
function hostContainsWildcard(host: string): boolean {
  return host.split('.').some(segment => segment.includes('*'));
}

const SandboxAuthInjectMatchSchema = z.object({
  hosts: z
    .array(
      z
        .string()
        .min(1)
        .refine(host => !hostContainsWildcard(host), {
          message: 'Hosts must be exact hostnames without wildcards',
        }),
    )
    .min(1),
});

const SandboxBasicAuthDataSchema = z.object({
  type: z.literal('basic'),
  username: z.string().regex(BASIC_AUTH_USERNAME_PATTERN, 'Username must be non-empty and contain no whitespace'),
  password: z.string().min(1),
});

const SandboxGitAuthInjectSchema = z.object({
  type: z.literal('git'),
  match: SandboxAuthInjectMatchSchema,
  auth_data: SandboxBasicAuthDataSchema,
});

const SandboxNetworkPolicySchema = z
  .object({
    auth_inject: z
      .array(SandboxGitAuthInjectSchema)
      .max(1, 'At most one auth inject rule is supported (type: git)')
      .optional(),
  })
  .openapi('SandboxNetworkPolicy');

const SandboxConfigSchema = z
  .object({
    enabled: z.boolean(),
    file_downloads: z.boolean().default(true),
    network_policy: SandboxNetworkPolicySchema.optional(),
  })
  .openapi('SandboxConfig');

const DynamicSubAgentsConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
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
    enabled: z.boolean().default(true),
  })
  .openapi('GenerativeUIConfig');

const AskUserQuestionsConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
  })
  .openapi('AskUserQuestionsConfig');

export const RuntimeConfigSchema = z
  .object({
    iteration_limit: z.number().int().positive().max(1024).default(DEFAULT_AGENT_CONFIG_ITERATION_LIMIT),
    sandbox: SandboxConfigSchema.optional(),
    dynamic_sub_agents: DynamicSubAgentsConfigSchema.optional(),
    context_management: ContextManagementConfigSchema.optional().default(() => ({
      compaction: { enabled: true },
      large_tool_response: { enabled: true },
    })),
    generative_ui: GenerativeUIConfigSchema.optional(),
    ask_user_questions: AskUserQuestionsConfigSchema.optional(),
  })
  .openapi('RuntimeConfig');

// --- Skills ---
// Name-only refs; DB sessions expand mount fields from ISkillStore at turn time.

const SKILL_NAME_REGEX = /^[A-Za-z0-9._-]+$/;

/** Name-only skill selection; mount fields come from the skill store. */
const SkillNameRefSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(SKILL_NAME_REGEX, 'Name may only contain letters, numbers, ".", "_", and "-"')
      .refine(v => v !== '.' && v !== '..', 'Name must not be "." or ".."')
      .refine(v => !v.startsWith('.tfy-'), 'Name must not use the reserved ".tfy-" prefix')
      .describe('Name for the skill, used as directory name in sandbox.'),
  })
  .strict()
  .openapi('SkillNameRef');

// --- Response format / messages ---

const AgentSpecUserMessageSchema = z
  .object({
    type: z.literal('user.message'),
    content: z
      .string()
      .min(1, 'User message content must not be empty')
      .refine(content => content.trim().length > 0, 'User message content must not be empty'),
  })
  .openapi('AgentSpecUserMessage');

// --- Agent spec ---

export const AgentSpecSchema = z
  .object({
    model: ModelSpecSchema,
    instructions: z.string().optional(),
    messages: z.array(AgentSpecUserMessageSchema).optional(),
    mcp_servers: z.array(MCPServerRequestSchema).optional(),
    response_format: ResponseFormatSchema.optional(),
    skills: z.array(SkillNameRefSchema).optional(),
    config: RuntimeConfigSchema.optional(),
    variables: z.record(z.string(), z.string()).optional(),
  })
  .describe('Agent Definition')
  .openapi('AgentSpec');

export type AgentSpec = z.infer<typeof AgentSpecSchema>;
export type SkillNameRef = z.infer<typeof SkillNameRefSchema>;
