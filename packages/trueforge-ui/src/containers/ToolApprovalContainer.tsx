'use client';

import { useCallback, useMemo, useState } from 'react';

import type { ApprovalOption } from '../atoms/ToolApprovalBar.js';

import { parseMcpToolArgs } from '@/utils/toolCallParsing.js';
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
  toolName?: string;
  argsText?: string;
  options: ToolApprovalOption[];
  onSelectOption: (optionId: string, reason?: string) => void;
};

export function ToolApprovalContainer({
  toolName = '',
  argsText,
  options,
  onSelectOption,
}: ToolApprovalContainerProps) {
  const ToolApprovalBar = useSlot('ToolApprovalBar');
  const { mcpServer, innerToolName } = parseMcpToolArgs(argsText);
  const displayToolName = innerToolName && mcpServer ? `${innerToolName} (${mcpServer})` : toolName;
  const [selectedDenyOptionId, setSelectedDenyOptionId] = useState<string | null>(null);
  const [denialReason, setDenialReason] = useState('');
  const [showReasonError, setShowReasonError] = useState(false);
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
  const onReasonSubmit = useCallback(() => {
    const reason = denialReason.trim();
    if (!reason) {
      setShowReasonError(true);
      return;
    }
    if (selectedDenyOptionId) {
      onSelectOption(selectedDenyOptionId, reason);
      onDenyOptionChange(null);
    }
  }, [denialReason, onDenyOptionChange, onSelectOption, selectedDenyOptionId]);

  return (
    <ToolApprovalBar
      toolName={displayToolName}
      approveOptions={approveOptions.length > 0 ? approveOptions : undefined}
      denyOptions={denyOptions.length > 0 ? denyOptions : undefined}
      selectedDenyOption={selectedDenyOption}
      denialReason={denialReason}
      showReasonError={showReasonError}
      onSelect={onSelectOption}
      onDenyOptionChange={onDenyOptionChange}
      onDenialReasonChange={onDenialReasonChange}
      onReasonSubmit={onReasonSubmit}
    />
  );
}
