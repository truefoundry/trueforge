import type { ToolCall } from './server/index.js';

export function isAskUserQuestionToolCall(toolCall: Pick<ToolCall, 'toolInfo'>): boolean {
  return toolCall.toolInfo?.type === 'trueforge-system' && toolCall.toolInfo.name === 'ask_user_question';
}

export interface AskUserQuestionArgs {
  question?: string;
  options?: string[];
}

export function parseAskUserQuestionArgs(argsText: string | undefined): AskUserQuestionArgs {
  if (!argsText) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(argsText);
    if (!isUnknownRecord(parsed)) {
      return {};
    }
    const rawQuestion = parsed['question'];
    const rawOptions = parsed['options'];
    const question = typeof rawQuestion === 'string' ? rawQuestion : undefined;
    const options = Array.isArray(rawOptions)
      ? rawOptions.filter((item): item is string => typeof item === 'string')
      : undefined;
    return {
      ...(question == null ? {} : { question }),
      ...(options == null ? {} : { options }),
    };
  } catch {
    return {};
  }
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
