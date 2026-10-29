import {
  ClientSideTool,
  toolResultResponse,
  type AgentCapability,
  type ToolDefinition,
} from '@truefoundry/trueforge-core/core';
import { HTTPException } from 'hono/http-exception';

/** Per-turn tool definitions. Not stored, so a resume turn must send the header again. */
export const X_TFG_TOOLS = 'x-tfg-tools';

const MAX_TOOLS = 16;
const MAX_DESCRIPTION_LENGTH = 4_000;
const MAX_HEADER_LENGTH = 16_000;
const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

export interface TfgToolParameters {
  type: 'object';
  properties?: Record<string, object>;
  required?: string[];
  [key: string]: unknown;
}

export interface TfgToolDefinition {
  name: string;
  description: string;
  parameters: TfgToolParameters;
}

/** Reject the header outside TrueFoundry mode before parsing, so a bad payload does not hide the mode error. */
export function assertTfgToolsHeaderAllowed(input: { isTrueFoundryMode: boolean }): void {
  if (!input.isTrueFoundryMode) {
    throw new HTTPException(400, { message: `${X_TFG_TOOLS} requires TrueFoundry mode` });
  }
}

/**
 * Tool definitions from `x-tfg-tools` for this turn. Not stored, so a resume must send the header again.
 * Rejects a bad value rather than mounting a partial list.
 */
export function parseTfgTools(raw: string): readonly TfgToolDefinition[] {
  if (raw.length > MAX_HEADER_LENGTH) {
    throw new HTTPException(400, { message: `${X_TFG_TOOLS} is too large` });
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch (error) {
    throw new HTTPException(400, { message: `${X_TFG_TOOLS} must be a JSON array`, cause: error });
  }
  if (!Array.isArray(decoded)) {
    throw new HTTPException(400, { message: `${X_TFG_TOOLS} must be a JSON array of tool definitions` });
  }
  if (decoded.length > MAX_TOOLS) {
    throw new HTTPException(400, { message: `${X_TFG_TOOLS} lists more than ${String(MAX_TOOLS)} tools` });
  }

  const tools: TfgToolDefinition[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < decoded.length; index++) {
    const tool = parseToolDefinition(decoded[index], index);
    if (seen.has(tool.name)) {
      throw new HTTPException(400, { message: entryMessage(index, `name "${tool.name}" is listed more than once`) });
    }
    seen.add(tool.name);
    tools.push(tool);
  }
  return tools;
}

export function tfgToolsCapability(tools: readonly TfgToolDefinition[]): AgentCapability {
  return {
    systemToolSets: [new InlineClientSideTools(tools)],
  };
}

class InlineClientSideTools extends ClientSideTool {
  readonly name = X_TFG_TOOLS;
  readonly displayName = 'TfgTools';
  override readonly tracingEnabled = false;
  readonly #tools: ToolDefinition[];

  constructor(tools: readonly TfgToolDefinition[]) {
    super();
    this.#tools = tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters,
      execute: () =>
        Promise.resolve(
          toolResultResponse({
            text: 'This tool requires client-side execution and cannot be run server-side.',
            isError: true,
          }),
        ),
    }));
  }

  protected getTools(): ToolDefinition[] {
    return this.#tools;
  }
}

function parseToolDefinition(value: unknown, index: number): TfgToolDefinition {
  if (!isPlainObject(value)) {
    throw new HTTPException(400, { message: entryMessage(index, 'must be an object') });
  }
  const name = value['name'];
  if (typeof name !== 'string' || !TOOL_NAME_PATTERN.test(name)) {
    throw new HTTPException(400, {
      message: entryMessage(index, 'name must be 1-64 characters of letters, numbers, "_" or "-"'),
    });
  }
  const description = value['description'];
  if (typeof description !== 'string') {
    throw new HTTPException(400, { message: entryMessage(index, 'description must be a non-empty string') });
  }
  const trimmedDescription = description.trim();
  if (trimmedDescription.length === 0) {
    throw new HTTPException(400, { message: entryMessage(index, 'description must be a non-empty string') });
  }
  if (trimmedDescription.length > MAX_DESCRIPTION_LENGTH) {
    throw new HTTPException(400, {
      message: entryMessage(index, `description must be at most ${String(MAX_DESCRIPTION_LENGTH)} characters`),
    });
  }
  return {
    name,
    description: trimmedDescription,
    parameters: parseParameters(value['parameters'], index),
  };
}

function parseParameters(value: unknown, index: number): TfgToolParameters {
  if (!isPlainObject(value) || value['type'] !== 'object') {
    throw new HTTPException(400, { message: entryMessage(index, 'parameters must be a JSON object schema') });
  }
  const parameters: TfgToolParameters = { type: 'object' };
  const properties = value['properties'];
  if (properties !== undefined) {
    if (!isPropertyMap(properties)) {
      throw new HTTPException(400, { message: entryMessage(index, 'parameters.properties must be an object') });
    }
    parameters.properties = properties;
  }
  const required = value['required'];
  if (required !== undefined) {
    if (!isStringArray(required)) {
      throw new HTTPException(400, {
        message: entryMessage(index, 'parameters.required must be an array of strings'),
      });
    }
    parameters.required = required;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'type' || key === 'properties' || key === 'required') {
      continue;
    }
    parameters[key] = entry;
  }
  return parameters;
}

function entryMessage(index: number, detail: string): string {
  return `${X_TFG_TOOLS}[${String(index)}] ${detail}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPropertyMap(value: unknown): value is Record<string, object> {
  if (!isPlainObject(value)) {
    return false;
  }
  return Object.values(value).every(entry => isPlainObject(entry));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string');
}
