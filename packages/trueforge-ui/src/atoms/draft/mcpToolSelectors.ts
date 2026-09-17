import type { McpToolSelection } from '../../server/types.js';
import { mcpToolAnnotations } from './mcpToolSections.js';

export const TOOL_TAG_ALL = '@all';
export const TOOL_TAG_READ_ONLY = '@read-only';
export const TOOL_TAG_WRITE = '@write';
export const TOOL_TAG_DESTRUCTIVE = '@destructive';

/** Harness tag semantics. A tool without annotations matches no tag except `@all`. */
export function toolMatchesTag({ tag, tool }: { tag: string; tool: McpToolSelection }): boolean {
  const annotations = mcpToolAnnotations(tool);
  switch (tag) {
    case TOOL_TAG_ALL:
      return true;
    case TOOL_TAG_READ_ONLY:
      return annotations?.readOnlyHint === true;
    case TOOL_TAG_DESTRUCTIVE:
      return annotations?.destructiveHint === true;
    case TOOL_TAG_WRITE:
      return annotations?.readOnlyHint === false && annotations.destructiveHint !== true;
    default:
      return false;
  }
}

export function toolMatchesSelectors({
  tool,
  selectors,
}: {
  tool: McpToolSelection;
  selectors: readonly string[];
}): boolean {
  return selectors.some(selector =>
    selector.startsWith('@') ? toolMatchesTag({ tag: selector, tool }) : selector === tool.name,
  );
}

/**
 * Tools a mount lets the agent call. `resolved` is false when tags cannot be applied because the
 * server's tool list — and with it the annotations tags match on — is unavailable.
 */
export function selectedToolNames({
  enableSelectors,
  disableSelectors,
  tools,
}: {
  enableSelectors: readonly string[];
  disableSelectors: readonly string[];
  tools: readonly McpToolSelection[];
}): { names: string[]; resolved: boolean } {
  if (tools.length === 0) {
    if ([...enableSelectors, ...disableSelectors].some(selector => selector.startsWith('@'))) {
      return { names: [], resolved: false };
    }
    return { names: enableSelectors.filter(name => !disableSelectors.includes(name)), resolved: true };
  }
  const names = tools
    .filter(
      tool =>
        toolMatchesSelectors({ tool, selectors: enableSelectors }) &&
        !toolMatchesSelectors({ tool, selectors: disableSelectors }),
    )
    .map(tool => tool.name);
  return { names, resolved: true };
}
