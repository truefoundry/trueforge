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

function isGroupableToolCall(part: ToolishPart): part is ToolishPart & { toolCallId: string } {
  return (
    part.type === 'tool-call' &&
    part.toolCallId != null &&
    (part.toolName == null || !UNGROUPED_TOOL_NAMES.has(part.toolName))
  );
}

/**
 * When the model requests two or more tools in one response, those calls share a key and render as one
 * "N tool calls in parallel" row; a lone call returns null and renders as a plain card. Sub-agent and
 * ask-user calls are never grouped or counted. GroupedParts only merges adjacent parts, so when an ungrouped
 * call sits between calls from the same response, each side is its own run and is counted on its own; the
 * key includes the run's first call id so two runs from one response never share a key.
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
  if (parallelToolGroups == null || !isGroupableToolCall(part)) {
    return null;
  }
  const modelMessageId = parallelToolGroups[part.toolCallId];
  if (modelMessageId == null) {
    return null;
  }
  const index = parts.findIndex(candidate => candidate.toolCallId === part.toolCallId);
  if (index === -1) {
    return null;
  }

  const inRun = (candidate: ToolishPart | undefined): candidate is ToolishPart & { toolCallId: string } =>
    candidate != null && isGroupableToolCall(candidate) && parallelToolGroups[candidate.toolCallId] === modelMessageId;

  let first = index;
  while (inRun(parts[first - 1])) {
    first -= 1;
  }
  let last = index;
  while (inRun(parts[last + 1])) {
    last += 1;
  }
  const firstPart = parts[first];
  if (last - first + 1 < 2 || firstPart?.toolCallId == null) {
    return null;
  }
  return `group-parallel-${modelMessageId}-${firstPart.toolCallId}`;
}

/** GroupedParts hands the render callback a union of groups, leaf parts and indicators; this narrows it to a
 * parallel group so callers can pass it to ToolGroupContainer without a cast. */
export function isParallelToolGroupPart<T extends { type: string }>(
  part: T,
): part is T & { type: `group-parallel-${string}` } {
  return part.type.startsWith('group-parallel-');
}
