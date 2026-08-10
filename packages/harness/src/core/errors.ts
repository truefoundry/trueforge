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
    super('mcp_connection_failed', message, options);
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
