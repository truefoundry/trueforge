/**
 * Public agent execution harness.
 * Intentional consumer-facing exports only (production API).
 */

// Runtime
export type { AgentDefinition, ModelParams } from './runtime/AgentDefinition';
export { AgentThread } from './runtime/AgentThread';
export type {
  AgentInfo,
  AgentParent,
  AgentSendInput,
  AgentThreadAppendContext,
  AgentThreadCreateSubAgent,
  AgentThreadEvent,
  AgentThreadExecutionEvent,
  AgentThreadExecutionResult,
  SubAgentCompletionMarker,
} from './runtime/AgentThread.types';
export { AgentThreadOrchestrator } from './runtime/AgentThreadOrchestrator';
export type { CreateDynamicSubAgentThread } from './runtime/CreateDynamicSubAgentThread';
export { isAgentInputUserMessage, isEmptyMessageContent, isFileContentPart } from './runtime/UserInputMessage';
export type { AgentInputUserMessage } from './runtime/UserInputMessage';

// Capability contracts
export type { AgentCapability, CapabilityState, JsonValue } from './capabilities/AgentCapability';
export type {
  AgentContextProcessorOutput,
  AgentThreadExecutionContext,
  PostToolCallAgentContextProcessor,
  PreLLMEphemeralAgentContextProcessor,
} from './capabilities/AgentContextProcessor';

// Built-in factories
export { askUserQuestion } from './capabilities/builtins/AskUserQuestion';
export {
  DEFAULT_CONTEXT_COMPACTION_THRESHOLD_TOKENS,
  contextCompaction,
} from './capabilities/builtins/ContextCompaction';
export { currentDateTime } from './capabilities/builtins/CurrentDateTime';
export { SUB_AGENT_IDENTITY, dynamicSubAgents } from './capabilities/builtins/DynamicSubAgents';
export {
  DEFAULT_INDIVIDUAL_TOOL_TOKEN_THRESHOLD,
  DEFAULT_PREVIEW_NUMBER_OF_CHARACTERS,
  DEFAULT_TOTAL_TOOL_TOKEN_THRESHOLD,
  largeToolResponse,
} from './capabilities/builtins/LargeToolResponse';
export { openUI } from './capabilities/builtins/OpenUI';

// MCP contracts
export type { ApprovalDecision } from './events/schema';
export { ClientSideTool } from './mcp/ClientSideTool';
export { isAuthRequired, toolResultResponse } from './mcp/IMCPServer';
export type {
  AgentToolSchema,
  AuthRequiredResponse,
  CallToolResponse,
  IToolSet,
  ListToolsResponse,
  MCPAuthRequired,
  ToolSource,
} from './mcp/IMCPServer';
export { LocalToolMCP, defineTool } from './mcp/LocalToolMCP';
export type { ToolDefinition } from './mcp/LocalToolMCP';

// Remote MCP server, split into a shared, policy-free connection (`RemoteMCP`) and a per-agent policy
// wrapper (`ToolSet`). `RemoteMCP` connects itself from a `url` + `headers`; the networking helpers
// live in the harness-internal `remoteMcpClient` module.
export { RemoteMCP } from './mcp/RemoteMCP';
export type { RemoteMcpHeaders, ResolveHeadersResult } from './mcp/RemoteMCP';
export type { RemoteMcpConnection, RemoteMcpTransportType } from './mcp/remoteMcpClient';
export type { ToolSelectorConfig } from './mcp/ToolSelectorPolicy';
export {
  DEFAULT_DISABLE_TOOLS,
  DEFAULT_ENABLE_TOOLS,
  DEFAULT_PRELOAD_TOOLS,
  DEFAULT_REQUIRE_APPROVAL_FOR_TOOLS,
  REQUIRE_APPROVAL_TOOLS_SELECTOR_TAGS,
  TOOLS_SELECTOR_TAGS,
} from './mcp/toolSelectors';
export { ToolSet } from './mcp/ToolSet';

// LLM contracts
export type { AgentMetadata, ILLM, LLMCreateParams, LLMCreateParamsStreaming } from './llm/ILLM';
export { ResponseFormatSchema, toOpenAIResponseFormat } from './llm/responseFormat';
export type { ResponseFormat } from './llm/responseFormat';
export { SUPPORTED_REASONING_EFFORTS, VERCEL_AI_PROVIDER_NAMES, VercelAILLM } from './llm/VercelAILLM';
export type { VercelAILLMConfig, VercelAIProviderConfig, VercelAIProviderName } from './llm/VercelAILLM';

// Event contracts
export {
  ActionRequiredEventSchema,
  AgentInputUserMessageSchema,
  EventIdSchema,
  EventType,
  MCPAuthRequiredEventSchema,
  MCPInitializeEventSchema,
  ModelMessageDeltaEventSchema,
  ModelMessageEventSchema,
  SandboxCreatedEventSchema,
  ThreadCreatedEventSchema,
  ThreadDoneEventSchema,
  ThreadOverwriteContextEventSchema,
  ToolApprovalRequiredEventSchema,
  ToolResponseEventSchema,
  ToolResponseRequiredEventSchema,
  UserToolApprovalMessageSchema,
  UserToolResponseMessageSchema,
  newEventId,
} from './events/schema';
export type {
  AgentOutputEvent,
  MCPAuthRequiredEvent,
  MCPServerAuthInfo,
  MCPServerInitInfo,
  ThreadDoneEvent,
  ThreadOverwriteContextEvent,
} from './events/schema';
export { CompletionUsageSchema } from './llm/LLMTypes';
export type { CompletionUsage } from './llm/LLMTypes';
export { InternalEventType } from './runtime/AgentThread.types';
export type { AgentThreadSendBatch, ContextMessage } from './runtime/AgentThread.types';
export { AgentThreadMetricsSchema } from './runtime/metrics';
export type { AgentThreadMetrics } from './runtime/metrics';

// Tracing
export type {
  AgentExecutionTrace,
  AgentLocalToolTrace,
  AgentRemoteMcpToolTrace,
  AgentTracing,
} from './tracing/AgentTracing';

// Errors / utils
export { AgentHarnessError, McpConnectionError, McpDcrConfigurationError } from './errors';
export { describeUnknownError, extractErrorLogFields } from './util/errorLogFields';
export { PromiseTimeoutError, withTimeout } from './util/promiseUtils';

// Sandbox (concrete implementation; provider details exported for composition)
export { CodeModeDispatcher } from './sandbox/codeMode/CodeModeDispatcher';
export type { CodeModeLogger } from './sandbox/codeMode/CodeModeDispatcher';
export type { CodeModeClientInstall, CodeModeTransport } from './sandbox/codeMode/CodeModeTransport';
export { CodeModeErrorSourceSchema, CodeModeReplySchema, CodeModeRequestSchema } from './sandbox/codeMode/types';
export type { CodeModeErrorSource, CodeModeReply, CodeModeRequest } from './sandbox/codeMode/types';
export { DaytonaSandboxProvider } from './sandbox/provider/DaytonaProvider';
export type { DaytonaSandboxProviderOptions } from './sandbox/provider/DaytonaProvider';
export { absolutizeRelativeExecEnv } from './sandbox/provider/execEnv';
export { ensureExecSuccess, shellEscape } from './sandbox/provider/Provider';
export type {
  ExecErrorResult,
  ExecResult,
  ExecSuccessResult,
  SandboxBuild,
  SandboxBuildMetadata,
  SandboxBuildStatus,
  SandboxExecParams,
  SandboxInit,
  SandboxProvider,
} from './sandbox/provider/Provider';
export { TFYSandboxProvider } from './sandbox/provider/TFYSandboxProvider';
export { SKILL_DOWNLOAD_TIMEOUT_SECONDS, Sandbox, buildWriteAndRunScriptCommand } from './sandbox/Sandbox';
export type { SandboxInfo } from './sandbox/Sandbox';
export {
  SandboxError,
  SandboxFileNotFoundError,
  SandboxFileTooLargeError,
  SandboxNotAvailableError,
  SandboxPathIsDirectoryError,
  validateNoPathTraversal,
  validateSandboxOwnedByTenant,
} from './sandbox/SandboxErrors';
export { SANDBOX_IMAGE_URI } from './sandbox/sandboxImage';
export { existingSandboxIdForProvider, formatSandboxId, parseSandboxId, rawSandboxId } from './sandbox/sandboxRef';
export type { SandboxRefParts } from './sandbox/sandboxRef';

// Skills: the ISkillMounter seam lets hosts plug in their own skill sources
export { InstructionBuilder } from './InstructionBuilder';
export { SKILLS_PREAMBLE, SkillMounter, getSkillPath, renderSkillPromptBody } from './sandbox/skills';
export type { GitSkill, ISkillMounter } from './sandbox/skills';
