import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

/**
 * MCP server tool selectors are either a special tag or a literal tool name.
 *
 *   @all          — every tool on the server
 *   @read-only    — readOnlyHint === true
 *   @write        — readOnlyHint === false and not destructive
 *   @destructive   — destructiveHint === true
 */
const TOOL_TAG_ALL = '@all';
const TOOL_TAG_READ_ONLY = '@read-only';
const TOOL_TAG_WRITE = '@write';
const TOOL_TAG_DESTRUCTIVE = '@destructive';

const TOOL_TAGS = [TOOL_TAG_ALL, TOOL_TAG_READ_ONLY, TOOL_TAG_WRITE, TOOL_TAG_DESTRUCTIVE] as const;
type ToolTag = (typeof TOOL_TAGS)[number];

/** Tags allowed on `enable_tools`, `disable_tools`, and `preload_tools`. */
export const TOOLS_SELECTOR_TAGS = [TOOL_TAG_ALL, TOOL_TAG_READ_ONLY] as const;

/** Tags allowed on `require_approval_for_tools`. */
export const REQUIRE_APPROVAL_TOOLS_SELECTOR_TAGS = [TOOL_TAG_ALL, TOOL_TAG_WRITE, TOOL_TAG_DESTRUCTIVE] as const;

export const DEFAULT_ENABLE_TOOLS: string[] = [TOOL_TAG_ALL];
export const DEFAULT_DISABLE_TOOLS: string[] = [];
export const DEFAULT_PRELOAD_TOOLS: string[] = [];
export const DEFAULT_REQUIRE_APPROVAL_FOR_TOOLS: string[] = [TOOL_TAG_WRITE, TOOL_TAG_DESTRUCTIVE];

function isToolTag(selector: string): selector is ToolTag {
  return TOOL_TAGS.includes(selector as ToolTag);
}

function isReadOnly(annotations?: ToolAnnotations): boolean {
  return annotations?.readOnlyHint === true;
}

function isWrite(annotations?: ToolAnnotations): boolean {
  return annotations?.readOnlyHint === false && annotations.destructiveHint !== true;
}

function isDestructive(annotations?: ToolAnnotations): boolean {
  return annotations?.destructiveHint === true;
}

function toolMatchesTag(tag: ToolTag, annotations: ToolAnnotations | undefined): boolean {
  switch (tag) {
    case TOOL_TAG_ALL:
      return true;
    case TOOL_TAG_READ_ONLY:
      return isReadOnly(annotations);
    case TOOL_TAG_WRITE:
      return isWrite(annotations);
    case TOOL_TAG_DESTRUCTIVE:
      return isDestructive(annotations);
  }
}

/** True if the tool matches any selector (tag or literal name). */
export function toolMatchesAnySelector(
  toolName: string,
  annotations: ToolAnnotations | undefined,
  selectors: readonly string[] | undefined,
): boolean {
  if (!selectors?.length) {
    return false;
  }

  for (const selector of selectors) {
    if (isToolTag(selector)) {
      if (toolMatchesTag(selector, annotations)) {
        return true;
      }
    } else if (selector === toolName) {
      return true;
    }
  }
  return false;
}

/**
 * Whether the tool requires human approval before execution.
 * Matches `@write`, `@destructive`, `@all`, or explicit tool names against annotations.
 * Unannotated tools are exempt unless named in `require_approval_for_tools` or covered by `@all`.
 */
export function toolRequiresApproval(
  toolName: string,
  annotations: ToolAnnotations | undefined,
  selectors: readonly string[] | undefined,
): boolean {
  if (!selectors?.length) {
    return false;
  }
  return toolMatchesAnySelector(toolName, annotations, selectors);
}

/** True if the tool is enabled and not disabled. */
export function isToolAllowed(params: {
  toolName: string;
  annotations: ToolAnnotations | undefined;
  enableSelectors: readonly string[];
  disableSelectors: readonly string[];
}): boolean {
  const { toolName, annotations, enableSelectors, disableSelectors } = params;
  if (!toolMatchesAnySelector(toolName, annotations, enableSelectors)) {
    return false;
  }
  if (toolMatchesAnySelector(toolName, annotations, disableSelectors)) {
    return false;
  }
  return true;
}

/** Non-tag names from a selector list (for upfront validation / sandbox allow-lists). */
export function literalToolNames(selectors: readonly string[] | undefined): string[] {
  if (!selectors) {
    return [];
  }
  return selectors.filter(s => !isToolTag(s));
}

export function selectorsIncludeAll(selectors: readonly string[] | undefined): boolean {
  return !!selectors?.includes(TOOL_TAG_ALL);
}
