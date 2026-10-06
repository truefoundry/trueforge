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

const DEFERRED_CALL_TOOL_NAME = 'call_tool';

// Session / 10-minute allow is a remembered yes. Only deferred `call_tool`
// can attach that policy (needs mcp_server + tool_name). Meta-tools like
// get_tool_info reuse those arg names but are not policy targets.
export function toolSupportsSessionPolicy({ toolName, argsText }: { toolName?: string; argsText?: string }): boolean {
  if (toolName !== DEFERRED_CALL_TOOL_NAME) {
    return false;
  }
  const { mcpServer, innerToolName } = parseMcpToolArgs(argsText);
  return (
    typeof mcpServer === 'string' &&
    mcpServer.length > 0 &&
    typeof innerToolName === 'string' &&
    innerToolName.length > 0
  );
}

export function approvalChoicesForTool({
  toolName,
  argsText,
}: {
  toolName?: string;
  argsText?: string;
} = {}): readonly ToolApprovalChoice[] {
  if (toolSupportsSessionPolicy({ toolName, argsText })) {
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
