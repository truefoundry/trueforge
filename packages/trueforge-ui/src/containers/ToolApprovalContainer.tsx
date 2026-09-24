'use client';

import { useCallback, useMemo, useState } from 'react';
import type { RespondToToolApprovalOptions } from '@truefoundry/trueforge-assistant-ui-runtime';

import type { ApprovalOption } from '../atoms/ToolApprovalBar.js';

import { parseMcpToolArgs } from '@/utils/toolCallParsing.js';
import {
  approvalResponseForChoice,
  TOOL_APPROVAL_CHOICES,
  TOOL_APPROVAL_OPTION_ID,
  type ToolApprovalChoice,
} from '@/utils/toolApprovalOptions.js';
import { useActiveSessionCanManage } from '../hooks/useResourcePermissions.js';
import { useSlot } from '../theme/SlotsProvider.js';

export type ToolApprovalOption = {
  id: string;
  label: string;
  isAllow: boolean;
  grants?: readonly string[];
  confirm?: {
    title?: string;
    description?: string;
  };
};

type ToolApprovalContainerProps = {
  approvalId: string;
  toolName?: string;
  argsText?: string;
  onRespond: (response: RespondToToolApprovalOptions) => Promise<void>;
};

export function ToolApprovalContainer({
  approvalId,
  toolName = '',
  argsText,
  onRespond,
}: ToolApprovalContainerProps) {
  const ToolApprovalBar = useSlot('ToolApprovalBar');
  const canManageSession = useActiveSessionCanManage();
  const { mcpServer, innerToolName } = parseMcpToolArgs(argsText);
  const displayToolName = innerToolName && mcpServer ? `${innerToolName} (${mcpServer})` : toolName;
  const [selectedDenyOptionId, setSelectedDenyOptionId] = useState<string | null>(null);
  const [denialReason, setDenialReason] = useState('');
  const [showReasonError, setShowReasonError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const options = useMemo<ToolApprovalOption[]>(
    () =>
      TOOL_APPROVAL_CHOICES.map(option => ({
        ...option,
        ...(option.id === TOOL_APPROVAL_OPTION_ID.DENY ? { confirm: {} } : {}),
      })),
    [],
  );
  const approveOptions = useMemo<ApprovalOption[]>(
    () =>
      options
        .filter(option => option.isAllow)
        .map((option, index) => ({
          ...option,
          variant: index === 0 ? 'primary' : 'secondary',
          requiresReason: false,
        })),
    [options],
  );
  const denyOptions = useMemo<ApprovalOption[]>(
    () =>
      options
        .filter(option => !option.isAllow)
        .map(option => ({
          ...option,
          variant: 'secondary',
          requiresReason: option.confirm != null,
        })),
    [options],
  );
  const selectedDenyOption = denyOptions.find(option => option.id === selectedDenyOptionId);

  const onDenyOptionChange = useCallback((optionId: string | null) => {
    setSelectedDenyOptionId(optionId);
    setDenialReason('');
    setShowReasonError(false);
  }, []);
  const onDenialReasonChange = useCallback((reason: string) => {
    setDenialReason(reason);
    setShowReasonError(false);
  }, []);
  const submitResponse = useCallback(
    async (option: ToolApprovalChoice, reason?: string): Promise<boolean> => {
      if (!canManageSession || isSubmitting) return false;
      setIsSubmitting(true);
      try {
        await onRespond(
          approvalResponseForChoice({
            approvalId,
            optionId: option.id,
            ...(reason == null ? {} : { reason }),
          }),
        );
        return true;
      } catch {
        return false;
      } finally {
        setIsSubmitting(false);
      }
    },
    [approvalId, canManageSession, isSubmitting, onRespond],
  );
  const onReasonSubmit = useCallback(() => {
    if (!canManageSession || isSubmitting) return;
    const reason = denialReason.trim();
    if (!reason) {
      setShowReasonError(true);
      return;
    }
    const option = TOOL_APPROVAL_CHOICES.find(item => item.id === selectedDenyOptionId);
    if (option != null) {
      void submitResponse(option, reason).then(submitted => {
        if (submitted) onDenyOptionChange(null);
      });
    }
  }, [canManageSession, denialReason, isSubmitting, onDenyOptionChange, selectedDenyOptionId, submitResponse]);

  return (
    <ToolApprovalBar
      toolName={displayToolName}
      approveOptions={approveOptions.length > 0 ? approveOptions : undefined}
      denyOptions={denyOptions.length > 0 ? denyOptions : undefined}
      selectedDenyOption={selectedDenyOption}
      denialReason={denialReason}
      showReasonError={showReasonError}
      disabled={!canManageSession || isSubmitting}
      onSelect={optionId => {
        const option = TOOL_APPROVAL_CHOICES.find(item => item.id === optionId);
        if (option != null) void submitResponse(option);
      }}
      onDenyOptionChange={onDenyOptionChange}
      onDenialReasonChange={onDenialReasonChange}
      onReasonSubmit={onReasonSubmit}
    />
  );
}
