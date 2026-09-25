import {
  TOOL_APPROVAL_POLICY_ACTION_TYPE,
  type RespondToToolApprovalOptions,
} from '@truefoundry/trueforge-assistant-ui-runtime';

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
