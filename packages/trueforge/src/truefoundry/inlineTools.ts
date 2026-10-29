import { ToolSchema as McpToolSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  ClientSideTool,
  toolResultResponse,
  type AgentCapability,
  type ToolDefinition,
} from '@truefoundry/trueforge-core/core';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

/** Per-turn tool definitions. Not stored, so a resume turn must send the header again. */
export const X_TFG_TOOLS = 'x-tfg-tools';

const MAX_TFG_TOOLS = 16;
const MAX_TFG_TOOLS_HEADER_LENGTH = 16_000;
const InlineToolsHeaderSchema = z.array(McpToolSchema);

/** One MCP tool definition from `x-tfg-tools`. `execute` is attached later and is not part of the header. */
export type InlineTool = z.infer<typeof McpToolSchema>;

/** Main-thread capabilities for one turn. Built before the turn id exists. */
export interface ICapabilitiesStore {
  /** Fresh instances on every call. Empty when this turn mounts no header tools. */
  resolveCapabilities(): AgentCapability[];
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
export function parseTfgTools(raw: string): readonly InlineTool[] {
  if (raw.length > MAX_TFG_TOOLS_HEADER_LENGTH) {
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
  if (decoded.length > MAX_TFG_TOOLS) {
    throw new HTTPException(400, { message: `${X_TFG_TOOLS} lists more than ${String(MAX_TFG_TOOLS)} tools` });
  }

  const parsed = InlineToolsHeaderSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new HTTPException(400, {
      message: tfgToolsSchemaErrorMessage(parsed.error),
      cause: parsed.error,
    });
  }

  const seen = new Set<string>();
  for (const [index, tool] of parsed.data.entries()) {
    if (seen.has(tool.name)) {
      throw new HTTPException(400, {
        message: `${X_TFG_TOOLS}[${String(index)}] name "${tool.name}" is listed more than once`,
      });
    }
    seen.add(tool.name);
  }
  return parsed.data;
}

/**
 * Parse `x-tfg-tools` immediately, so a bad header fails before a turn id exists.
 * No header (a schedule run passes none) mounts nothing.
 */
export function capabilitiesStoreFromHeader(input: {
  header: string | undefined;
  isTrueFoundryMode: boolean;
}): ICapabilitiesStore {
  if (input.header === undefined) {
    return { resolveCapabilities: () => [] };
  }
  assertTfgToolsHeaderAllowed({ isTrueFoundryMode: input.isTrueFoundryMode });
  const tools = parseTfgTools(input.header);
  return {
    resolveCapabilities: () => (tools.length === 0 ? [] : [tfgToolsCapability(tools)]),
  };
}

export function tfgToolsCapability(tools: readonly InlineTool[]): AgentCapability {
  return {
    systemToolSets: [new InlineClientSideTools(tools)],
  };
}

function tfgToolsSchemaErrorMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) {
    return `${X_TFG_TOOLS} must be an array of MCP tool definitions`;
  }
  return `${X_TFG_TOOLS}${tfgToolsIssuePath(issue.path)} ${issue.message}`;
}

function tfgToolsIssuePath(path: readonly PropertyKey[]): string {
  let rendered = '';
  for (const part of path) {
    if (typeof part === 'number') {
      rendered += `[${String(part)}]`;
    } else {
      rendered += `.${String(part)}`;
    }
  }
  return rendered;
}

class InlineClientSideTools extends ClientSideTool {
  readonly name = X_TFG_TOOLS;
  readonly displayName = 'TfgTools';
  override readonly tracingEnabled = false;
  readonly #tools: ToolDefinition[];

  constructor(tools: readonly InlineTool[]) {
    super();
    this.#tools = tools.map(tool => ({
      ...tool,
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
