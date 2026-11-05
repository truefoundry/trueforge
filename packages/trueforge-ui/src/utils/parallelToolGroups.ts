import type { ParallelToolGroups } from '@truefoundry/trueforge-assistant-ui-runtime';

import { SUB_AGENT_TOOL_NAME } from './toolCallParsing.js';

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
 * "N tool calls in parallel" row; a lone call returns null and renders as a plain card. Sub-agents are
 * skipped because they keep their own expandable card.
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
  if (part.toolName === SUB_AGENT_TOOL_NAME) {
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
    if (candidate.toolName === SUB_AGENT_TOOL_NAME) {
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

export function isParallelToolGroupPart(part: { type: string }): boolean {
  return part.type.startsWith('group-parallel-');
}
