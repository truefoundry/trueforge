import type { ParallelToolGroups } from '@truefoundry/trueforge-assistant-ui-runtime';

import { ASK_USER_TOOL_NAME, SUB_AGENT_TOOL_NAME } from './toolCallParsing.js';

// Sub-agents keep their own expandable card, and ask-user prompts render nothing in live chat until answered (the
// composer owns them); grouping either would make the "N tool calls" count disagree with the rows shown.
const UNGROUPED_TOOL_NAMES: ReadonlySet<string> = new Set([SUB_AGENT_TOOL_NAME, ASK_USER_TOOL_NAME]);

type ToolishPart = {
  type: string;
  toolCallId?: string;
  toolName?: string;
};

function isParallelToolGroups(value: unknown): value is ParallelToolGroups {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  for (const key of Object.keys(value)) {
    const modelMessageId = Reflect.get(value, key);
    if (typeof modelMessageId !== 'string' || modelMessageId.length === 0) {
      return false;
    }
  }
  return Object.keys(value).length > 0;
}

/** This runs in a useAuiState selector on every store update; we return the store's own object, not a copy, so the result stays referentially stable and does not re-render. */
export function readParallelToolGroups(custom: unknown): ParallelToolGroups | undefined {
  if (custom == null || typeof custom !== 'object' || Array.isArray(custom)) {
    return undefined;
  }
  const value = Reflect.get(custom, 'parallelToolGroups');
  return isParallelToolGroups(value) ? value : undefined;
}

/**
 * When the model requests two or more tools in one response, those calls share a key and render as one
 * "N tool calls in parallel" row; a lone call returns null and renders as a plain card. Sub-agent and
 * ask-user calls are never grouped or counted.
 */
export function parallelGroupKeyForPart({
  part,
  parts,
  parallelToolGroups,
}: {
  part: ToolishPart;
  parts: readonly ToolishPart[];
  parallelToolGroups: ParallelToolGroups | undefined;
}): `group-parallel-${string}` | null {
  if (part.type !== 'tool-call' || part.toolCallId == null || parallelToolGroups == null) {
    return null;
  }
  if (part.toolName != null && UNGROUPED_TOOL_NAMES.has(part.toolName)) {
    return null;
  }
  const modelMessageId = parallelToolGroups[part.toolCallId];
  if (modelMessageId == null) {
    return null;
  }

  let batchCount = 0;
  for (const candidate of parts) {
    if (candidate.type !== 'tool-call' || candidate.toolCallId == null) {
      continue;
    }
    if (candidate.toolName != null && UNGROUPED_TOOL_NAMES.has(candidate.toolName)) {
      continue;
    }
    if (parallelToolGroups[candidate.toolCallId] === modelMessageId) {
      batchCount += 1;
    }
  }
  if (batchCount < 2) {
    return null;
  }
  return `group-parallel-${modelMessageId}`;
}

/** GroupedParts hands the render callback a union of groups, leaf parts and indicators; this narrows it to a
 * parallel group so callers can pass it to ToolGroupContainer without a cast. */
export function isParallelToolGroupPart<T extends { type: string }>(
  part: T,
): part is T & { type: `group-parallel-${string}` } {
  return part.type.startsWith('group-parallel-');
}
