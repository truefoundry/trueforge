import type { McpToolSelection } from '../../server/types.js';
import { mcpToolAnnotations } from './mcpToolSections.js';

const APPROVAL_TAG_ALL = '@all';
const APPROVAL_TAG_WRITE = '@write';
const APPROVAL_TAG_DESTRUCTIVE = '@destructive';

/** Harness default applied when a mount omits `requireApprovalForTools`. */
export const DEFAULT_APPROVAL_SELECTORS: readonly string[] = [APPROVAL_TAG_WRITE, APPROVAL_TAG_DESTRUCTIVE];

function matchesTag({ tag, tool }: { tag: string; tool: McpToolSelection }): boolean {
  const annotations = mcpToolAnnotations(tool);
  switch (tag) {
    case APPROVAL_TAG_ALL:
      return true;
    case APPROVAL_TAG_DESTRUCTIVE:
      return annotations?.destructiveHint === true;
    case APPROVAL_TAG_WRITE:
      return annotations?.readOnlyHint === false && annotations.destructiveHint !== true;
    default:
      return false;
  }
}

/** Unannotated tools match no tag, so they are gated only by name or `@all`. */
export function toolRequiresApproval({
  tool,
  selectors,
}: {
  tool: McpToolSelection;
  selectors: readonly string[];
}): boolean {
  return selectors.some(selector =>
    selector.startsWith('@') ? matchesTag({ tag: selector, tool }) : selector === tool.name,
  );
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
  if (tool !== undefined) return toolRequiresApproval({ tool, selectors });
  return selectors.includes(APPROVAL_TAG_ALL) || selectors.includes(toolName);
}

export function approvedToolNames({
  tools,
  selectors,
}: {
  tools: readonly McpToolSelection[];
  selectors: readonly string[];
}): Set<string> {
  return new Set(tools.filter(tool => toolRequiresApproval({ tool, selectors })).map(tool => tool.name));
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
  if (tools.length > 0 && tools.every(tool => approved.has(tool.name))) return [APPROVAL_TAG_ALL];
  const selectors = [APPROVAL_TAG_WRITE, APPROVAL_TAG_DESTRUCTIVE].filter(tag =>
    tools.every(tool => !matchesTag({ tag, tool }) || approved.has(tool.name)),
  );
  for (const tool of tools) {
    if (!approved.has(tool.name)) continue;
    if (toolRequiresApproval({ tool, selectors })) continue;
    selectors.push(tool.name);
  }
  return selectors;
}

export function sameSelectors(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every(selector => rightSet.has(selector));
}
