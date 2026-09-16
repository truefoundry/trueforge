import type { McpToolSelection } from '../../server/types.js';

export type McpToolSectionId = 'read-only' | 'others' | 'destructive';

export type McpToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
};

export function mcpToolAnnotations(tool: McpToolSelection): McpToolAnnotations | undefined {
  const raw = Reflect.get(tool, 'annotations');
  if (typeof raw !== 'object' || raw === null) return undefined;
  const readOnlyHint = Reflect.get(raw, 'readOnlyHint');
  const destructiveHint = Reflect.get(raw, 'destructiveHint');
  const annotations: McpToolAnnotations = {
    ...(typeof readOnlyHint === 'boolean' ? { readOnlyHint } : {}),
    ...(typeof destructiveHint === 'boolean' ? { destructiveHint } : {}),
  };
  return Object.keys(annotations).length > 0 ? annotations : undefined;
}

export function mcpToolSectionId(tool: McpToolSelection): McpToolSectionId {
  const annotations = mcpToolAnnotations(tool);
  if (annotations?.readOnlyHint === true) return 'read-only';
  if (annotations?.destructiveHint === true) return 'destructive';
  return 'others';
}

export type McpToolKind = 'read' | 'write' | 'destructive';

/** Undefined when the server ships no usable hints, so callers can omit the label. */
export function mcpToolKind(tool: McpToolSelection): McpToolKind | undefined {
  const annotations = mcpToolAnnotations(tool);
  if (annotations?.readOnlyHint === true) return 'read';
  if (annotations?.destructiveHint === true) return 'destructive';
  if (annotations?.readOnlyHint === false) return 'write';
  return undefined;
}

export const MCP_TOOL_SECTION_ORDER: readonly McpToolSectionId[] = ['read-only', 'others', 'destructive'];

export const MCP_TOOL_SECTION_LABELS: Record<McpToolSectionId, string> = {
  'read-only': 'Read-only Actions',
  others: 'Other Actions',
  destructive: 'Destructive Actions',
};

export const MCP_TOOL_SECTION_ENABLE_ALL_LABELS: Record<McpToolSectionId, string> = {
  'read-only': 'Enable all read-only tools',
  others: 'Enable all other tools',
  destructive: 'Enable all destructive tools',
};

export function partitionMcpToolsBySection(
  tools: readonly McpToolSelection[],
): Record<McpToolSectionId, McpToolSelection[]> {
  const sections: Record<McpToolSectionId, McpToolSelection[]> = {
    'read-only': [],
    others: [],
    destructive: [],
  };
  for (const tool of tools) {
    sections[mcpToolSectionId(tool)].push(tool);
  }
  return sections;
}
