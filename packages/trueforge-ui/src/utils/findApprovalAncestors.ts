import { SUB_AGENT_TOOL_NAME } from './toolCallParsing.js';

type ApprovalRef = {
  id?: string;
  approved?: boolean;
  resolution?: string;
};

type ToolCallPart = {
  type: string;
  toolCallId?: string;
  toolName?: string;
  approval?: ApprovalRef;
  messages?: readonly {
    role: string;
    content: readonly ToolCallPart[];
  }[];
};

type ThreadMessageLike = {
  role: string;
  content: readonly ToolCallPart[];
};

function isPendingApproval(approval: ApprovalRef | undefined, approvalId: string): boolean {
  return approval?.id === approvalId && approval.approved === undefined && approval.resolution === undefined;
}

/**
 * Returns `create_sub_agent` toolCallIds that must be expanded for `approvalId`
 * to mount in the DOM. Empty when the approval is on the root thread.
 */
export function findSubAgentAncestorsForApproval(messages: readonly ThreadMessageLike[], approvalId: string): string[] {
  const path: string[] = [];

  function walk(content: readonly ToolCallPart[], ancestors: readonly string[]): boolean {
    for (const part of content) {
      if (part.type !== 'tool-call') continue;

      if (isPendingApproval(part.approval, approvalId)) {
        path.push(...ancestors);
        return true;
      }

      const nextAncestors =
        part.toolName === SUB_AGENT_TOOL_NAME && part.toolCallId != null && part.toolCallId !== ''
          ? [...ancestors, part.toolCallId]
          : ancestors;

      if (part.messages == null) continue;
      for (const message of part.messages) {
        if (message.role !== 'assistant') continue;
        if (walk(message.content, nextAncestors)) return true;
      }
    }
    return false;
  }

  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    if (walk(message.content, [])) return path;
  }
  return path;
}
