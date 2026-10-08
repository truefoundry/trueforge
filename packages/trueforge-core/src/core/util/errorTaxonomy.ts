/**
 * Canonical vocabulary for session failures. Every user-visible error resolves to one
 * `ErrorCode`, which fixes its source, its retryability, and its base copy.
 */

export const ERROR_SOURCES = ['model', 'control_plane', 'sandbox', 'mcp', 'internal'] as const;

export type ErrorSource = (typeof ERROR_SOURCES)[number];

export const ERROR_CODES = [
  'model_timeout',
  'model_stream_interrupted',
  'model_invalid_request',
  'model_auth_failed',
  'model_rate_limited',
  'model_guardrail_blocked',
  'model_unavailable',
  'control_plane_timeout',
  'control_plane_unavailable',
  'sandbox_timeout',
  'sandbox_busy',
  'sandbox_unavailable',
  'mcp_connect_failed',
  'mcp_transport_lost',
  'mcp_tool_not_allowed',
  'mcp_tool_schema_mismatch',
  'mcp_tool_failed',
  'mcp_guardrail_blocked',
  'turn_iteration_limit',
  'turn_max_tokens',
  'turn_cancelled',
  'internal_error',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorClassification {
  code: ErrorCode;
  source: ErrorSource;
  /** Whether running the same request again has a realistic chance of succeeding. */
  retryable: boolean;
  /** Short user-facing sentence. Never carries a cause chain or transport jargon. */
  title: string;
  /** Raw technical text, for the UI details disclosure and for logs. */
  detail: string;
}

/**
 * Unknown failures are deliberately not retryable: a wrong guess here costs a paid model
 * call, so only codes we positively recognise opt in.
 */
export const CODE_RETRYABLE: Record<ErrorCode, boolean> = {
  model_timeout: true,
  model_stream_interrupted: true,
  model_invalid_request: false,
  model_auth_failed: false,
  model_rate_limited: true,
  model_guardrail_blocked: false,
  model_unavailable: true,
  control_plane_timeout: true,
  control_plane_unavailable: true,
  sandbox_timeout: true,
  sandbox_busy: true,
  sandbox_unavailable: false,
  mcp_connect_failed: true,
  mcp_transport_lost: true,
  mcp_tool_not_allowed: false,
  mcp_tool_schema_mismatch: false,
  mcp_tool_failed: true,
  mcp_guardrail_blocked: false,
  turn_iteration_limit: false,
  turn_max_tokens: false,
  turn_cancelled: true,
  internal_error: false,
};

export const ERROR_COPY: Record<ErrorCode, string> = {
  model_timeout: 'The model provider did not respond in time.',
  model_stream_interrupted: 'The model response was cut off before it finished.',
  model_invalid_request: 'The model rejected the request.',
  model_auth_failed: 'The credentials for this model were rejected.',
  model_rate_limited: 'The model provider is rate limiting this request.',
  model_guardrail_blocked: 'A guardrail blocked this request.',
  model_unavailable: 'The model provider is unavailable.',
  control_plane_timeout: 'TrueFoundry did not respond in time.',
  control_plane_unavailable: 'TrueFoundry could not be reached.',
  sandbox_timeout: 'The sandbox command took too long and was stopped.',
  sandbox_busy: 'The sandbox is still starting up. Try again in a moment.',
  sandbox_unavailable: 'The sandbox is no longer available.',
  mcp_connect_failed: 'Could not connect to the MCP server.',
  mcp_transport_lost: 'Lost the connection to the MCP server.',
  mcp_tool_not_allowed: 'This tool is not allowed on the MCP server.',
  mcp_tool_schema_mismatch: 'The MCP server returned a response that does not match the schema it declared.',
  mcp_tool_failed: 'The MCP server could not run the tool.',
  mcp_guardrail_blocked: 'A guardrail blocked the tool result.',
  turn_iteration_limit: 'The agent reached its step limit for this turn.',
  turn_max_tokens: 'The response reached the maximum length for this model.',
  turn_cancelled: 'The turn was stopped before it finished.',
  internal_error: 'Something went wrong while running this turn.',
};

/**
 * Codes whose upstream text is the actionable part (a rejected parameter, a named tool, a
 * guardrail verdict), so the title keeps it. Everything else upstream is transport noise.
 */
export const CODE_KEEPS_UPSTREAM_TEXT: ReadonlySet<ErrorCode> = new Set([
  'model_invalid_request',
  'model_guardrail_blocked',
  'mcp_tool_not_allowed',
  'mcp_tool_schema_mismatch',
  'mcp_guardrail_blocked',
]);

/**
 * Copy for an unrecognised failure. Classification falls back to `internal_error` rather than
 * guessing a specific code — naming the layer that failed is all we can honestly claim — while
 * the caller's own `source` keeps the message pointed at the right subsystem.
 */
export const UNKNOWN_COPY: Record<ErrorSource, string> = {
  model: 'The model request failed.',
  control_plane: 'The TrueFoundry request failed.',
  sandbox: 'The sandbox request failed.',
  mcp: 'The MCP server request failed.',
  internal: 'Something went wrong while running this turn.',
};
