'use client';

import { Icon } from '../icons/Icon.js';
import { StepIconBox } from './agent-chat/StepIconBox.js';
import { cn } from './lib/cn.js';
import { Button } from './primitives/Button.js';

export type ApprovalOption = {
  id: string;
  label: string;
  variant?: 'primary' | 'secondary' | 'destructive';
  requiresReason?: boolean;
  grants?: readonly string[];
  confirm?: {
    title?: string;
    description?: string;
  };
};

export type ToolApprovalBarProps = {
  toolName: string;
  approveOptions?: ApprovalOption[];
  denyOptions?: ApprovalOption[];
  onSelect: (optionId: string, reason?: string) => void;
  status?: {
    type: 'approved' | 'denied';
    label?: string;
    reason?: string;
  };
  selectedDenyOption?: ApprovalOption;
  denialReason?: string;
  showReasonError?: boolean;
  onDenyOptionChange?: (optionId: string | null) => void;
  onDenialReasonChange?: (reason: string) => void;
  onReasonSubmit?: () => void;
  disabled?: boolean;
  readOnly?: boolean;
  showLineBelow?: boolean;
  dataTestPrefix?: string;
  className?: string;
};

const DEFAULT_APPROVE_OPTIONS: ApprovalOption[] = [{ id: 'approve', label: 'Approve', variant: 'primary' }];

const DEFAULT_DENY_OPTIONS: ApprovalOption[] = [
  { id: 'deny', label: 'Deny', variant: 'secondary', requiresReason: true },
];

function optionVariant(option: ApprovalOption): 'default' | 'secondary' | 'destructive' {
  if (option.variant === 'destructive') return 'destructive';
  if (option.variant === 'secondary') return 'secondary';
  return 'default';
}

export function ToolApprovalBar({
  toolName,
  approveOptions = DEFAULT_APPROVE_OPTIONS,
  denyOptions = DEFAULT_DENY_OPTIONS,
  onSelect,
  status,
  selectedDenyOption,
  denialReason = '',
  showReasonError = false,
  onDenyOptionChange,
  onDenialReasonChange,
  onReasonSubmit,
  disabled = false,
  readOnly = false,
  showLineBelow = false,
  dataTestPrefix,
  className,
}: ToolApprovalBarProps) {
  const isDecided = !!status;
  const isApproved = status?.type === 'approved';
  const isDenied = status?.type === 'denied';
  const interactionsLocked = disabled && !isDecided;

  const headingText = isApproved ? 'Tool Approved' : isDenied ? 'Tool Approval Denied' : 'Tool Approval Required for';

  return (
    <div
      className={cn('aui-tool-approval-bar', className)}
      data-testid={dataTestPrefix ? `${dataTestPrefix}-approval` : undefined}
    >
      <div className="flex gap-2">
        <div className={cn('flex shrink-0 flex-col items-center', !showLineBelow && 'pb-1')}>
          <div className="min-h-[0.75rem] w-px flex-1 bg-border" />
          <StepIconBox icon="wrench" variant="muted" iconSize="0.875em" className="my-1" />
          {showLineBelow && <div className="min-h-[0.75rem] w-px flex-1 bg-border" />}
        </div>

        <div className="mt-2 flex flex-1 items-center justify-between">
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex flex-wrap items-center gap-1 font-sans text-xs font-medium leading-4 text-text-primary">
                {headingText}
                <span className="rounded bg-secondary-bg px-1.5 py-0.5 text-xs text-text-secondary">{toolName}</span>
              </span>
              {isDecided && (
                <Icon
                  name={isDenied ? 'circle-xmark' : 'circle-check'}
                  size="0.875em"
                  className={cn('shrink-0', isDenied ? 'text-failure-bg' : 'text-success-bg')}
                />
              )}
            </div>
            {!isDecided && !readOnly && selectedDenyOption && (
              <Button
                size="sm"
                variant="secondary"
                disabled={interactionsLocked}
                onClick={() => onDenyOptionChange?.(null)}
              >
                Back
              </Button>
            )}
          </div>
          {!isDecided && !readOnly && !selectedDenyOption && (
            <div className="flex gap-2">
              {approveOptions.map(option => (
                <Button
                  key={option.id}
                  size="sm"
                  variant={optionVariant(option)}
                  disabled={interactionsLocked}
                  onClick={() => onSelect(option.id)}
                >
                  {option.variant === 'primary' && <Icon name="check" size="0.75rem" />}
                  {option.label}
                </Button>
              ))}
              {denyOptions.map(option => (
                <Button
                  key={option.id}
                  size="sm"
                  variant={optionVariant(option)}
                  disabled={interactionsLocked}
                  onClick={() => {
                    if (option.requiresReason) {
                      onDenyOptionChange?.(option.id);
                    } else {
                      onSelect(option.id);
                    }
                  }}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>

      {!isDecided && !readOnly && selectedDenyOption && (
        <div className="flex flex-col gap-1 pl-8 pt-3">
          {(selectedDenyOption.confirm?.title || selectedDenyOption.confirm?.description) && (
            <div className="flex flex-col gap-0.5">
              {selectedDenyOption.confirm.title && (
                <span className="text-xs font-medium text-text-primary">{selectedDenyOption.confirm.title}</span>
              )}
              {selectedDenyOption.confirm.description && (
                <span className="text-xs text-text-secondary">{selectedDenyOption.confirm.description}</span>
              )}
            </div>
          )}
          {selectedDenyOption.grants && selectedDenyOption.grants.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-xs text-text-secondary">Grants:</span>
              {selectedDenyOption.grants.map(grant => (
                <span key={grant} className="rounded bg-secondary-bg px-1.5 py-0.5 text-xs text-text-secondary">
                  {grant}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              placeholder="Enter reason for denial"
              aria-label="Reason for denial"
              aria-invalid={showReasonError || undefined}
              aria-describedby={showReasonError ? 'aui-denial-reason-error' : undefined}
              value={denialReason}
              disabled={interactionsLocked}
              onChange={e => onDenialReasonChange?.(e.target.value)}
              className={cn(
                'h-8 flex-1 rounded border border-input-border bg-primary-bg px-2 text-xs text-text-primary',
                'focus:outline-none focus:ring-1 focus:ring-focus-ring',
              )}
            />
            <Button size="sm" disabled={interactionsLocked} onClick={onReasonSubmit}>
              Submit
            </Button>
          </div>
          {showReasonError && (
            <span id="aui-denial-reason-error" className="text-xs text-failure-bg" role="alert">
              Reason is required
            </span>
          )}
        </div>
      )}

      {isDecided && status?.reason && (
        <div className="pl-8 pt-2">
          <span className="text-xs text-text-secondary">Reason: {status.reason}</span>
        </div>
      )}
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ToolApprovalBar: typeof ToolApprovalBar;
  }
}
