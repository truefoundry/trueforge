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

const MAX_TOOLS = 16;
const MAX_HEADER_LENGTH = 16_000;

const InlineToolSchema = McpToolSchema;
const InlineToolsHeaderSchema = z.array(InlineToolSchema);

/** One MCP tool definition from `x-tfg-tools`. `execute` is attached later and is not part of the header. */
export type InlineTool = z.infer<typeof InlineToolSchema>;

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

  const parsed = InlineToolsHeaderSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new HTTPException(400, {
      message: schemaErrorMessage(parsed.error),
      cause: parsed.error,
    });
  }

  const seen = new Set<string>();
  for (const [index, tool] of parsed.data.entries()) {
    if (seen.has(tool.name)) {
      throw new HTTPException(400, { message: entryMessage(index, `name "${tool.name}" is listed more than once`) });
    }
    seen.add(tool.name);
  }
  return parsed.data;
}

export function tfgToolsCapability(tools: readonly InlineTool[]): AgentCapability {
  return {
    systemToolSets: [new InlineClientSideTools(tools)],
  };
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

function schemaErrorMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) {
    return `${X_TFG_TOOLS} must be an array of MCP tool definitions`;
  }
  return `${X_TFG_TOOLS}${issuePath(issue.path)} ${issue.message}`;
}

function issuePath(path: readonly PropertyKey[]): string {
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

function entryMessage(index: number, detail: string): string {
  return `${X_TFG_TOOLS}[${String(index)}] ${detail}`;
}
