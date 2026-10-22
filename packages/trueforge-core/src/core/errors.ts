/** User-visible label for a model-provider failure. */
export const MODEL_ERROR_PREFIX = '[Model Error]';

/** User-visible label for an MCP connection or transport failure. */
export const MCP_ERROR_PREFIX = '[MCP Error]';

function hasErrorPrefix({ prefix, message }: { prefix: string; message: string }): boolean {
  return message.startsWith(prefix);
}

/**
 * Remove leading source labels, in the given order, so an outer wrapper can add context and then apply one label.
 * A label is removed only when the current text starts with it. Text that matches none of them is returned unchanged.
 */
export function stripErrorPrefix({ prefix, message }: { prefix: string | readonly string[]; message: string }): string {
  const prefixes = typeof prefix === 'string' ? [prefix] : prefix;
  return prefixes.reduce((current, item) => {
    if (!hasErrorPrefix({ prefix: item, message: current })) {
      return current;
    }
    return current.slice(item.length).trim();
  }, message);
}

/**
 * Add a source label when it is not already the start of the message.
 * A second wrap keeps the existing label instead of stacking another copy.
 */
export function applyErrorPrefix({ prefix, message }: { prefix: string; message: string }): string {
  if (hasErrorPrefix({ prefix, message })) {
    return message;
  }
  return `${prefix} ${message}`;
}

/**
 * Model-provider failure. The message starts with `[Model Error]` once, and `cause` keeps the upstream error.
 */
export class ModelProviderError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(applyErrorPrefix({ prefix: MODEL_ERROR_PREFIX, message }), options);
    this.name = 'ModelProviderError';
  }
}

export type AgentHarnessErrorCode =
  | 'invalid_file_input'
  | 'invalid_send_input'
  | 'agent_sandbox_required'
  | 'tool_name_collision'
  | 'mcp_connection_failed'
  | 'capability_state_error';

export class AgentHarnessError extends Error {
  constructor(
    readonly code: AgentHarnessErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AgentHarnessError';
  }
}

export class InvalidFileInputError extends AgentHarnessError {
  constructor(message: string, options?: ErrorOptions) {
    super('invalid_file_input', message, options);
    this.name = 'InvalidFileInputError';
  }
}

export class InvalidAgentSendInputError extends AgentHarnessError {
  constructor(message: string, options?: ErrorOptions) {
    super('invalid_send_input', message, options);
    this.name = 'InvalidAgentSendInputError';
  }
}

export class AgentSandboxRequiredError extends AgentHarnessError {
  constructor(message: string, options?: ErrorOptions) {
    super('agent_sandbox_required', message, options);
    this.name = 'AgentSandboxRequiredError';
  }
}

export class ToolNameCollisionError extends AgentHarnessError {
  constructor(message: string, options?: ErrorOptions) {
    super('tool_name_collision', message, options);
    this.name = 'ToolNameCollisionError';
  }
}

/**
 * A remote MCP connection or tool call failed. Harness code can't throw the gateway's HTTPException,
 * so it throws this instead and carries `statusCode` (401 auth, 403 tool, 400 malformed value,
 * 422 well-formed but unprocessable, 502 transport) that the boundary turns back into an HTTP status.
 */
export class McpConnectionError extends AgentHarnessError {
  constructor(
    message: string,
    readonly statusCode: number,
    options?: ErrorOptions,
  ) {
    super('mcp_connection_failed', applyErrorPrefix({ prefix: MCP_ERROR_PREFIX, message }), options);
    this.name = 'McpConnectionError';
  }
}

/**
 * An MCP server's `auth.type: dcr` is unsatisfiable by configuration, not by a transient fault
 */
export class McpDcrConfigurationError extends McpConnectionError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 422, options);
    this.name = 'McpDcrConfigurationError';
  }
}
