import type { CallToolRequest, CallToolResult, ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import type { RegisteredPassthroughEvent } from '../events/PassthroughEvents';
import type { AgentInfo, ApprovalDecision, MCPServerAuthInfo, MCPServerInitInfo } from '../events/schema';
import type { InternalToolCallInfo } from '../llm/LLMTypes';
import type { SandboxInfo } from '../sandbox/Sandbox';

export interface MCPAuthRequired {
  servers: MCPServerAuthInfo[];
}

export type ToolSchema = ListToolsResult['tools'][number];

export interface AgentToolSchema extends ToolSchema {
  preload: boolean;
}

export interface AuthRequiredResponse {
  authRequired: MCPAuthRequired;
}

export function isAuthRequired(response: ListToolsResponse | CallToolResponse): response is AuthRequiredResponse {
  return 'authRequired' in response;
}

export interface ListToolsResolvedResponse {
  result: { tools: AgentToolSchema[] };
  wasInitialized: MCPServerInitInfo | undefined;
}

export type ListToolsResponse = ListToolsResolvedResponse | AuthRequiredResponse;

export interface CallToolResolvedResponse {
  result: CallToolResult;
  wasInitialized: MCPServerInitInfo | undefined;
  // Set to true on the call that created the sandbox; emits `sandbox.created` upstream.
  sandboxCreated?: boolean | undefined;
  // Set on every sandbox-backed call; used for tracing.
  sandboxInfo?: SandboxInfo | undefined;
  events?: readonly RegisteredPassthroughEvent[] | undefined;
}

export type CallToolResultResponse = CallToolResolvedResponse | AuthRequiredResponse;

export interface CallToolCreateSubAgentResponse {
  createSubAgent: AgentInfo;
}

export interface ApprovalRequiredResponse {
  approvalRequired: { tool_info: InternalToolCallInfo };
}

export function isApprovalRequiredResponse(response: CallToolResponse): response is ApprovalRequiredResponse {
  return 'approvalRequired' in response;
}

export interface ClientSideToolRequiredResponse {
  clientSideToolRequired: { tool_info: InternalToolCallInfo };
}

export function isClientSideToolRequiredResponse(
  response: CallToolResponse,
): response is ClientSideToolRequiredResponse {
  return 'clientSideToolRequired' in response;
}

export type CallToolResponse =
  CallToolResultResponse | CallToolCreateSubAgentResponse | ApprovalRequiredResponse | ClientSideToolRequiredResponse;

export function isCallToolResponseCreateSubAgent(
  response: CallToolResponse,
): response is CallToolCreateSubAgentResponse {
  return 'createSubAgent' in response;
}

export function isCallToolResponseResult(response: CallToolResponse): response is CallToolResolvedResponse {
  return 'result' in response;
}

type CallToolResultMetadata = Omit<CallToolResolvedResponse, 'result'>;

const EMPTY_METADATA: CallToolResultMetadata = { wasInitialized: undefined };

export function toolResultResponse(params: {
  text: string;
  overrides?: Partial<CallToolResultMetadata> | undefined;
  isError?: boolean | undefined;
}): CallToolResolvedResponse {
  return {
    result: { content: [{ type: 'text', text: params.text }], ...(params.isError && { isError: true }) },
    ...EMPTY_METADATA,
    ...params.overrides,
  };
}

/** Narrow public MCP server contract. Private implementations may expose additional members. */
export interface IToolSet {
  readonly name: string;
  readonly id: string;
  readonly description?: string | undefined;

  // True when every exposed tool is eager. DeferredTool uses the inverse.
  readonly preload: boolean;

  // Outcome-oriented preflight flag: Tool.ts calls listTools() initially when
  // this is true. It does not expose enable/disable/preload selector policy.
  readonly hasPreloadedTools: boolean;

  listTools(): Promise<ListToolsResponse>;

  callTool(params: CallToolRequest['params'], approvalDecision?: ApprovalDecision): Promise<CallToolResponse>;

  toolCallInfo(params: CallToolRequest['params'], resolveUnderlyingTool?: boolean): Promise<InternalToolCallInfo>;

  // Existing synchronous Code Mode allow-list. Optional implementations fall
  // back to the current unrestricted envelope; callTool still enforces policy.
  getAllowedToolNamesForSandbox?(): string[] | undefined;
}

/** Policy-free tool provider; a {@link ToolSet} wraps it to layer per-agent selector policy on top. */
export interface ToolSource {
  readonly name: string;
  readonly id: string;
  readonly description?: string | undefined;

  listTools(): Promise<ListToolsResolvedResponse | AuthRequiredResponse>;

  callTool(params: CallToolRequest['params'], approvalDecision?: ApprovalDecision): Promise<CallToolResponse>;

  toolCallInfo(params: CallToolRequest['params'], resolveUnderlyingTool?: boolean): Promise<InternalToolCallInfo>;
}
