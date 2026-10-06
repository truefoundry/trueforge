import { TOOL_APPROVAL_POLICY_ACTION_TYPE } from '@truefoundry/trueforge-assistant-ui-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  approvalChoicesForTool,
  approvalResponseForChoice,
  TEN_MINUTES_MS,
  TOOL_APPROVAL_OPTION_ID,
} from '@/utils/toolApprovalOptions.js';

describe('toolApprovalOptions', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('maps approve once without a policy', () => {
    expect(
      approvalResponseForChoice({
        approvalId: 'approval-1',
        optionId: TOOL_APPROVAL_OPTION_ID.APPROVE_ONCE,
      }),
    ).toEqual({ approvalId: 'approval-1', approved: true });
  });

  it('maps the ten-minute option to an expiring session policy', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T12:00:00.000Z'));

    expect(
      approvalResponseForChoice({
        approvalId: 'approval-1',
        optionId: TOOL_APPROVAL_OPTION_ID.APPROVE_TEN_MINUTES,
      }),
    ).toEqual({
      approvalId: 'approval-1',
      approved: true,
      policy: {
        type: TOOL_APPROVAL_POLICY_ACTION_TYPE.ALLOW_SESSION,
        expireAt: new Date(Date.now() + TEN_MINUTES_MS).toISOString(),
      },
    });
  });

  it('maps session approval and denial', () => {
    expect(
      approvalResponseForChoice({
        approvalId: 'approval-1',
        optionId: TOOL_APPROVAL_OPTION_ID.APPROVE_SESSION,
      }),
    ).toEqual({
      approvalId: 'approval-1',
      approved: true,
      policy: { type: TOOL_APPROVAL_POLICY_ACTION_TYPE.ALLOW_SESSION },
    });
    expect(
      approvalResponseForChoice({
        approvalId: 'approval-1',
        optionId: TOOL_APPROVAL_OPTION_ID.DENY,
        reason: 'unsafe',
      }),
    ).toEqual({ approvalId: 'approval-1', approved: false, reason: 'unsafe' });
  });

  it('omits session policy choices unless the call is deferred call_tool with an MCP target', () => {
    const onceAndDeny = [TOOL_APPROVAL_OPTION_ID.APPROVE_ONCE, TOOL_APPROVAL_OPTION_ID.DENY];
    const mcpArgs = JSON.stringify({ mcp_server: 'github', tool_name: 'search' });
    expect(approvalChoicesForTool().map(choice => choice.id)).toEqual(onceAndDeny);
    expect(
      approvalChoicesForTool({ toolName: 'shell', argsText: JSON.stringify({ command: 'ls' }) }).map(
        choice => choice.id,
      ),
    ).toEqual(onceAndDeny);
    expect(approvalChoicesForTool({ toolName: 'get_tool_info', argsText: mcpArgs }).map(choice => choice.id)).toEqual(
      onceAndDeny,
    );
    expect(approvalChoicesForTool({ toolName: 'call_tool', argsText: mcpArgs }).map(choice => choice.id)).toEqual([
      TOOL_APPROVAL_OPTION_ID.APPROVE_ONCE,
      TOOL_APPROVAL_OPTION_ID.APPROVE_TEN_MINUTES,
      TOOL_APPROVAL_OPTION_ID.APPROVE_SESSION,
      TOOL_APPROVAL_OPTION_ID.DENY,
    ]);
  });
});
