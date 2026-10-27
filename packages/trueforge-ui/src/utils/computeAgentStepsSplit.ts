import type { PartState } from '@assistant-ui/core/react';
import { CONTEXT_COMPACTION_DATA_NAME } from '@truefoundry/trueforge-assistant-ui-runtime';

export type AgentStepPart = {
  type: PartState['type'];
  text?: string;
  name?: string;
};

function isAgentStepPart(part: AgentStepPart): boolean {
  return (
    part.type === 'tool-call' ||
    part.type === 'reasoning' ||
    (part.type === 'data' && part.name === CONTEXT_COMPACTION_DATA_NAME)
  );
}

export interface AgentStepsSplitResult {
  cutIndex: number;
  hasFinal: boolean;
  toolCount: number;
  thinkingCount: number;
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

  // Only apply the 500-char holdback when there are actual agent steps (tool calls,
  // reasoning, or context compaction) before the text. For pure-text responses the
  // text is always the final answer and must stream directly, not be hidden inside
  // the "Agent steps" accordion.
  const hasAgentStepsBeforeCut = parts.slice(0, cutIdx).some(isAgentStepPart);

  const finalConfirmed = finalTexts.length > 0 && (!isRunning || trailingChars >= 500 || !hasAgentStepsBeforeCut);

  const actualCutIndex = finalConfirmed ? cutIdx : parts.length;

  let toolCount = 0;
  let thinkingCount = 0;
  for (let i = 0; i < actualCutIndex; i++) {
    const part = parts[i];
    if (!part) continue;

    if (part.type === 'tool-call') {
      toolCount++;
    } else if (part.type === 'reasoning') {
      thinkingCount++;
    }
  }

  return {
    cutIndex: actualCutIndex,
    hasFinal: finalConfirmed,
    toolCount,
    thinkingCount,
  };
}
