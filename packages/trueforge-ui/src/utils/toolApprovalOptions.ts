import {
  TOOL_APPROVAL_POLICY_ACTION_TYPE,
  type RespondToToolApprovalOptions,
} from '@truefoundry/trueforge-assistant-ui-runtime';

import { parseMcpToolArgs } from './toolCallParsing.js';

export const TOOL_APPROVAL_OPTION_ID = {
  APPROVE_ONCE: 'approve-once',
  APPROVE_SESSION: 'approve-session',
  APPROVE_TEN_MINUTES: 'approve-10-minutes',
  DENY: 'deny',
} as const;

export const TEN_MINUTES_MS = 10 * 60 * 1000;

export interface ToolApprovalChoice {
  id: (typeof TOOL_APPROVAL_OPTION_ID)[keyof typeof TOOL_APPROVAL_OPTION_ID];
  label: string;
  isAllow: boolean;
  requiresReason?: boolean;
}

export const TOOL_APPROVAL_CHOICES: readonly ToolApprovalChoice[] = [
  { id: TOOL_APPROVAL_OPTION_ID.APPROVE_ONCE, label: 'Approve once', isAllow: true },
  {
    id: TOOL_APPROVAL_OPTION_ID.APPROVE_TEN_MINUTES,
    label: 'Approve this tool for next 10 minutes',
    isAllow: true,
  },
  {
    id: TOOL_APPROVAL_OPTION_ID.APPROVE_SESSION,
    label: 'Approve this tool in this session',
    isAllow: true,
  },
  { id: TOOL_APPROVAL_OPTION_ID.DENY, label: 'Deny', isAllow: false, requiresReason: true },
];

const SESSION_POLICY_OPTION_IDS = new Set<ToolApprovalChoice['id']>([
  TOOL_APPROVAL_OPTION_ID.APPROVE_SESSION,
  TOOL_APPROVAL_OPTION_ID.APPROVE_TEN_MINUTES,
]);

// Session / 10-minute allow is a remembered yes. The backend can only store that
// for an MCP tool, keyed by server name + inner tool name from call_tool args.
// Hide those buttons when that pair is missing (shell, sandbox, incomplete args)
// so the user is not offered a sticky allow that cannot be applied.
export function toolSupportsSessionPolicy(argsText?: string): boolean {
  const { mcpServer, innerToolName } = parseMcpToolArgs(argsText);
  return (
    typeof mcpServer === 'string' &&
    mcpServer.length > 0 &&
    typeof innerToolName === 'string' &&
    innerToolName.length > 0
  );
}

export function approvalChoicesForTool(argsText?: string): readonly ToolApprovalChoice[] {
  if (toolSupportsSessionPolicy(argsText)) {
    return TOOL_APPROVAL_CHOICES;
  }
  return TOOL_APPROVAL_CHOICES.filter(choice => !SESSION_POLICY_OPTION_IDS.has(choice.id));
}

export function approvalResponseForChoice({
  approvalId,
  optionId,
  reason,
  now = new Date(),
}: {
  approvalId: string;
  optionId: ToolApprovalChoice['id'];
  reason?: string;
  now?: Date;
}): RespondToToolApprovalOptions {
  switch (optionId) {
    case TOOL_APPROVAL_OPTION_ID.APPROVE_ONCE:
      return { approvalId, approved: true };
    case TOOL_APPROVAL_OPTION_ID.APPROVE_TEN_MINUTES:
      return {
        approvalId,
        approved: true,
        policy: {
          type: TOOL_APPROVAL_POLICY_ACTION_TYPE.ALLOW_SESSION,
          // The backend accepts an absolute expiry; calculate it when selected.
          expireAt: new Date(now.getTime() + TEN_MINUTES_MS).toISOString(),
        },
      };
    case TOOL_APPROVAL_OPTION_ID.APPROVE_SESSION:
      return {
        approvalId,
        approved: true,
        policy: { type: TOOL_APPROVAL_POLICY_ACTION_TYPE.ALLOW_SESSION },
      };
    case TOOL_APPROVAL_OPTION_ID.DENY:
      return { approvalId, approved: false, ...(reason == null ? {} : { reason }) };
  }
}
