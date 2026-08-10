// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ToolApprovalBar, type ApprovalOption } from '@/atoms/ToolApprovalBar.js';

const reasonOption: ApprovalOption = {
  id: 'deny-with-reason',
  label: 'Deny',
  requiresReason: true,
  grants: ['filesystem:read'],
  confirm: {
    title: 'Explain the denial',
    description: 'The agent will receive this reason.',
  },
};

describe('ToolApprovalBar', () => {
  it('submits immediate approve and deny options', () => {
    const onSelect = vi.fn();
    render(
      <ToolApprovalBar
        toolName="shell"
        approveOptions={[{ id: 'allow-once', label: 'Allow once', variant: 'primary' }]}
        denyOptions={[{ id: 'reject', label: 'Reject', variant: 'destructive' }]}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(onSelect).toHaveBeenNthCalledWith(1, 'allow-once');
    expect(onSelect).toHaveBeenNthCalledWith(2, 'reject');
  });

  it('drives the controlled denial-reason workflow and error state', () => {
    const onDenyOptionChange = vi.fn();
    const onDenialReasonChange = vi.fn();
    const onReasonSubmit = vi.fn();
    const { rerender } = render(
      <ToolApprovalBar
        toolName="filesystem"
        denyOptions={[reasonOption]}
        onSelect={() => {}}
        onDenyOptionChange={onDenyOptionChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(onDenyOptionChange).toHaveBeenCalledWith('deny-with-reason');

    rerender(
      <ToolApprovalBar
        toolName="filesystem"
        denyOptions={[reasonOption]}
        selectedDenyOption={reasonOption}
        denialReason="unsafe"
        showReasonError
        onSelect={() => {}}
        onDenyOptionChange={onDenyOptionChange}
        onDenialReasonChange={onDenialReasonChange}
        onReasonSubmit={onReasonSubmit}
      />,
    );

    expect(screen.getByText('Explain the denial')).toBeInTheDocument();
    expect(screen.getByText('filesystem:read')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Reason is required');
    const reasonInput = screen.getByRole('textbox', { name: 'Reason for denial' });
    expect(reasonInput).toHaveAttribute('aria-invalid', 'true');
    expect(reasonInput).toHaveClass('h-8');
    expect(screen.getByRole('button', { name: 'Submit' })).toHaveClass('h-8');

    fireEvent.change(reasonInput, { target: { value: 'new reason' } });
    expect(onDenialReasonChange).toHaveBeenCalledWith('new reason');
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onReasonSubmit).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onDenyOptionChange).toHaveBeenLastCalledWith(null);
  });

  it('locks disabled interactions and hides controls in read-only mode', () => {
    const onSelect = vi.fn();
    const { rerender } = render(<ToolApprovalBar toolName="shell" onSelect={onSelect} disabled />);

    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onSelect).not.toHaveBeenCalled();

    rerender(<ToolApprovalBar toolName="shell" onSelect={onSelect} readOnly />);
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deny' })).not.toBeInTheDocument();
    expect(screen.getByText('Tool Approval Required for')).toBeInTheDocument();
  });

  it('renders approved and denied decisions with an optional reason', () => {
    const { rerender } = render(
      <ToolApprovalBar toolName="shell" onSelect={() => {}} status={{ type: 'approved' }} dataTestPrefix="tool" />,
    );
    expect(screen.getByText('Tool Approved')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();

    rerender(
      <ToolApprovalBar
        toolName="shell"
        onSelect={() => {}}
        status={{ type: 'denied', reason: 'Policy blocked it' }}
        dataTestPrefix="tool"
      />,
    );
    expect(screen.getByText('Tool Approval Denied')).toBeInTheDocument();
    expect(screen.getByText('Reason: Policy blocked it')).toBeInTheDocument();
  });
});
