import type { PartState } from '@assistant-ui/core/react';
import { CONTEXT_COMPACTION_DATA_NAME } from '@truefoundry/trueforge-assistant-ui-runtime';

export type AgentStepPart = {
  type: PartState['type'];
  text?: string;
  name?: string;
  /** Rendered outside the Agent steps group (e.g. answered user questions); not counted. */
  hidden?: boolean;
};

/** Steps after the last hidden part and before the trailing reply share its accordion. */
function hasContiguousAgentSteps(parts: readonly AgentStepPart[], cutIdx: number): boolean {
  for (let i = cutIdx - 1; i >= 0; i--) {
    const part = parts[i];
    if (!part || part.hidden) return false;
    if (isAgentStepPart(part)) return true;
  }
  return false;
}

function isAgentStepPart(part: AgentStepPart): boolean {
  if (part.hidden) return false;
  return (
    part.type === 'tool-call' ||
    part.type === 'reasoning' ||
    (part.type === 'data' && part.name === CONTEXT_COMPACTION_DATA_NAME)
  );
}

export interface AgentStepsSplitResult {
  cutIndex: number;
  hasFinal: boolean;
}

/** Counts per accordion, so groups split by a visible part do not repeat message-wide totals. */
export function countAgentSteps(parts: readonly AgentStepPart[]): { toolCount: number; thinkingCount: number } {
  let toolCount = 0;
  let thinkingCount = 0;
  for (const part of parts) {
    if (part.hidden) continue;
    if (part.type === 'tool-call') {
      toolCount++;
    } else if (part.type === 'reasoning') {
      thinkingCount++;
    }
  }
  return { toolCount, thinkingCount };
}

export function computeAgentStepsSplit(parts: readonly AgentStepPart[], isRunning: boolean): AgentStepsSplitResult {
  const finalTexts: Array<{ index: number; content: string }> = [];
  let cutIdx = parts.length;

  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (!part) continue;

    if (part.type === 'text') {
      const text = part.text ?? '';
      const trimmed = text.trim();

      if (trimmed) {
        finalTexts.unshift({ index: i, content: text });
        cutIdx = i;
      } else {
        cutIdx = i;
      }
    } else {
      break;
    }
  }

  const trailingChars = finalTexts.reduce((sum, t) => sum + t.content.length, 0);

  // Hold the reply inside Agent steps only while a tool, reasoning block, or
  // compaction still shares that accordion. A hidden part (an answered question)
  // renders outside the accordion and splits the group, so earlier steps must not
  // park a later short reply in a second accordion that has no steps of its own.
  const hasAgentStepsBeforeCut = hasContiguousAgentSteps(parts, cutIdx);

  const finalConfirmed = finalTexts.length > 0 && (!isRunning || trailingChars >= 500 || !hasAgentStepsBeforeCut);

  const actualCutIndex = finalConfirmed ? cutIdx : parts.length;

  return {
    cutIndex: actualCutIndex,
    hasFinal: finalConfirmed,
  };
}
