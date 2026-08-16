import { ToolNameCollisionError } from '../errors';

const VALID_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_TOOL_NAME_LENGTH = 64;
export const MAX_DUP_SUFFIX = 50;

function sanitizeToolName(toolName: string): string {
  if (VALID_TOOL_NAME_PATTERN.test(toolName)) {
    return toolName;
  }
  return toolName.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function getUniqueSanitizedToolName(
  toolName: string,
  existingNames: Set<string>,
): { name: string; hadCollision: boolean } {
  const sanitized = sanitizeToolName(toolName);
  const truncated = sanitized.substring(0, MAX_TOOL_NAME_LENGTH);

  if (!existingNames.has(truncated)) {
    return { name: truncated, hadCollision: false };
  }

  const nameBase = sanitized.substring(0, MAX_TOOL_NAME_LENGTH - 2);
  for (let suffix = 1; suffix <= MAX_DUP_SUFFIX; suffix++) {
    const candidate = `${nameBase}${String(suffix)}`;
    if (!existingNames.has(candidate)) {
      return { name: candidate, hadCollision: true };
    }
  }

  throw new ToolNameCollisionError(
    `Tool name collision limit exceeded for "${toolName}": more than ${String(MAX_DUP_SUFFIX)} duplicates across MCP servers`,
  );
}
