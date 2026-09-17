import type { McpToolSelection } from '../../server/types.js';
import { mcpToolSectionId } from './mcpToolSections.js';
import {
  TOOL_TAG_ALL,
  TOOL_TAG_DESTRUCTIVE,
  TOOL_TAG_WRITE,
  toolMatchesSelectors,
  toolMatchesTag,
} from './mcpToolSelectors.js';

/** Harness default applied when a mount omits `requireApprovalForTools`. */
export const DEFAULT_APPROVAL_SELECTORS: readonly string[] = [TOOL_TAG_DESTRUCTIVE];

/** Approval on by default only for destructive tools; Other/read-only stay off until toggled. */
export function defaultApprovalRequiredForTool(tool: McpToolSelection): boolean {
  return mcpToolSectionId(tool) === 'destructive';
}

/**
 * Apply section defaults for tools that were just enabled: destructive → gated, everything else →
 * auto-run. Rebuilds selectors from the full server tool list so class tags stay coherent.
 */
export function approvalSelectorsAfterEnabling({
  tools,
  selectors,
  newlyEnabledNames,
}: {
  tools: readonly McpToolSelection[];
  selectors: readonly string[];
  newlyEnabledNames: readonly string[];
}): string[] {
  if (tools.length === 0 || newlyEnabledNames.length === 0) return [...selectors];
  const approved = approvedToolNames({ tools, selectors });
  for (const name of newlyEnabledNames) {
    const tool = tools.find(item => item.name === name);
    if (tool === undefined) continue;
    if (defaultApprovalRequiredForTool(tool)) approved.add(name);
    else approved.delete(name);
  }
  return approvalSelectorsFor({ tools, approved });
}

/** Approval state for a tool name whose annotations are unknown (tags cannot be resolved). */
export function namedToolRequiresApproval({
  toolName,
  tools,
  selectors,
}: {
  toolName: string;
  tools: readonly McpToolSelection[];
  selectors: readonly string[];
}): boolean {
  const tool = tools.find(item => item.name === toolName);
  if (tool !== undefined) return toolMatchesSelectors({ tool, selectors });
  return selectors.includes(TOOL_TAG_ALL) || selectors.includes(toolName);
}

export function approvedToolNames({
  tools,
  selectors,
}: {
  tools: readonly McpToolSelection[];
  selectors: readonly string[];
}): Set<string> {
  return new Set(tools.filter(tool => toolMatchesSelectors({ tool, selectors })).map(tool => tool.name));
}

/**
 * Narrowest selector list that gates exactly `approved`. Class tags are kept while every tool of
 * that class stays gated, so servers that later add write/destructive tools still gate them.
 */
export function approvalSelectorsFor({
  tools,
  approved,
}: {
  tools: readonly McpToolSelection[];
  approved: ReadonlySet<string>;
}): string[] {
  if (tools.length > 0 && tools.every(tool => approved.has(tool.name))) return [TOOL_TAG_ALL];
  const selectors = [TOOL_TAG_WRITE, TOOL_TAG_DESTRUCTIVE].filter(tag =>
    tools.every(tool => !toolMatchesTag({ tag, tool }) || approved.has(tool.name)),
  );
  for (const tool of tools) {
    if (!approved.has(tool.name)) continue;
    if (toolMatchesSelectors({ tool, selectors })) continue;
    selectors.push(tool.name);
  }
  return selectors;
}

export function sameSelectors(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every(selector => rightSet.has(selector));
}
